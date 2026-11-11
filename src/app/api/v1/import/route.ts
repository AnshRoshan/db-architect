import { NextResponse } from "next/server";
import { parseDsl, parseSqlDdl, parseMongoJson } from "@/lib/dsl";
import { persistScan } from "@/lib/scan";
import { audit, safeError } from "@/lib/server";
import { apiError, requireProject, requireUser } from "@/lib/auth";
import { Engine } from "@/lib/schema-model";
import { isEngine } from "@/lib/engines";

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
    try {
      if (lower.endsWith(".sql") || /^\s*create\s+table/i.test(content)) {
        parsed = parseSqlDdl(content, String(body.database ?? "imported_db"), isEngine(body.engine) ? body.engine : undefined);
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
    if (isEngine(body.engine) && parsed.model.engine !== body.engine && (body.engine === "mongodb") === (parsed.model.engine === "mongodb")) {
      parsed.model.engine = body.engine as Engine;
      for (const e of parsed.model.entities) e.engine = body.engine as Engine;
    }
    parsed.model.database = String(body.database ?? parsed.model.database ?? "imported_db");
    const { scanId, analysisId } = await persistScan({
      projectId,
      engine: parsed.model.engine,
      source: "upload",
      label,
      model: parsed.model,
      importWarnings: parsed.warnings,
    });
    await audit(projectId, user.email, "schema.import", "scan", scanId, { filename, engine: parsed.model.engine });
    return NextResponse.json({ scanId, analysisId, engine: parsed.model.engine, warnings: parsed.warnings }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
