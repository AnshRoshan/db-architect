import { NextResponse } from "next/server";
import { parseDsl, parseSqlDdl, parseMongoJson } from "@/lib/dsl";
import { persistScan } from "@/lib/scan";
import { audit, safeError } from "@/lib/server";
import { apiError, requireProject, requireUser } from "@/lib/auth";
import { Engine } from "@/lib/schema-model";
import { isEngine } from "@/lib/engines";
import { parseRedisDump } from "@/lib/redis-model";

/** `ecommerce_v2.sql` and `ecommerce.sql` are versions of the same database. */
function databaseFromFilename(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, "").replace(/(\.(sql|ya?ml|json|txt|redis|keys))+$/gi, "");
  const clean = base.replace(/[\s._-]*(v\d+|\(\d+\)|target|proposed|new|final|copy)$/i, "").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return clean || "imported_db";
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 2_500_000;

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const projectId = String(body.projectId ?? "");
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
    await requireProject(projectId, "write");
    const content = String(body.content ?? "");
    if (!content) return NextResponse.json({ error: "content required" }, { status: 400 });
    if (content.length > MAX_BYTES) return NextResponse.json({ error: "File too large (max ~2.5MB)" }, { status: 413 });
    const filename = String(body.filename ?? "schema.sql");
    const label = String(body.label ?? filename).slice(0, 200);

    let parsed;
    const lower = filename.toLowerCase();
    const trimmed = content.trimStart();
    const fallbackDb = databaseFromFilename(filename);
    const looksRedis = body.engine === "redis" || /\.(redis|keys)(\.(json|txt))?$/.test(lower) || /"engine"\s*:\s*"redis"/.test(content.slice(0, 4000)) || /^\{\s*"redis"\s*:/.test(trimmed);
    try {
      if (looksRedis) {
        parsed = parseRedisDump(content, String(body.database ?? fallbackDb));
      } else if (lower.endsWith(".sql") || /^\s*create\s+(table|schema)/i.test(content)) {
        parsed = parseSqlDdl(content, String(body.database ?? fallbackDb), isEngine(body.engine) && body.engine !== "redis" ? body.engine : undefined);
      } else if (lower.endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
        // mongo sample/validator shape must go to the Mongo parser FIRST —
        // the generic DSL would otherwise accept it with empty fields.
        if (/\"sample\"|\"validator\"|\"collections\"/.test(content)) {
          parsed = parseMongoJson(content, String(body.database ?? "mongo_db"));
        } else {
          try {
            parsed = parseDsl(content, filename);
            if (!parsed.model.entities.length) throw new Error("empty");
          } catch {
            parsed = parseMongoJson(content, String(body.database ?? "mongo_db"));
          }
        }
      } else {
        parsed = parseDsl(content, filename);
      }
    } catch (e) {
      return NextResponse.json({ error: `Parse failed: ${safeError(e)}` }, { status: 422 });
    }
    // engine override
    if (isEngine(body.engine) && body.engine !== "redis" && parsed.model.engine !== "redis" && parsed.model.engine !== body.engine && (body.engine === "mongodb") === (parsed.model.engine === "mongodb")) {
      parsed.model.engine = body.engine as Engine;
      for (const e of parsed.model.entities) e.engine = body.engine as Engine;
    }
    parsed.model.database = String(body.database ?? parsed.model.database ?? "imported_db");
    const { scanId, analysisId, dataStoreId } = await persistScan({
      projectId,
      engine: parsed.model.engine,
      source: "upload",
      label,
      model: parsed.model,
      importWarnings: parsed.warnings,
      store: {
        dataStoreId: typeof body.dataStoreId === "string" && /^[0-9a-f-]{36}$/i.test(body.dataStoreId) ? body.dataStoreId : null,
        name: body.storeName ? String(body.storeName).slice(0, 200) : null,
        role: body.storeRole ? String(body.storeRole) : null,
      },
    });
    await audit(projectId, user.email, "schema.import", "scan", scanId, { filename, engine: parsed.model.engine });
    return NextResponse.json({ scanId, analysisId, dataStoreId, engine: parsed.model.engine, namespaces: parsed.model.namespaces.length, entities: parsed.model.entities.length, warnings: parsed.warnings }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
