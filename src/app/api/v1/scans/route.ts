import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { databaseConnections, schemaScans } from "@/db/schema";
import { apiError, requireProject, requireUser } from "@/lib/auth";
import { getAdapter } from "@/lib/connectors";
import { Engine, engineLabel, namespaceLabel, parseEngine } from "@/lib/engines";
import { sanitizeDbError } from "@/lib/introspection";
import { persistScan } from "@/lib/scan";
import { decryptCredentials } from "@/lib/secrets";
import { audit } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(req.url);
    const access = await requireProject(searchParams.get("projectId") ?? "", "read");
    const rows = await db.select().from(schemaScans).where(eq(schemaScans.projectId, access.project.id)).orderBy(desc(schemaScans.createdAt)).limit(100);
    return NextResponse.json({ scans: rows });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const access = await requireProject(String(body.projectId ?? ""), "write");
    let engine: Engine = parseEngine(body.engine);
    let creds: Record<string, unknown>;
    let connectionId: string | null = null;
    if (body.connectionId) {
      const id = String(body.connectionId);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Connection id is missing or invalid" }, { status: 400 });
      const rows = await db.select().from(databaseConnections).where(eq(databaseConnections.id, id)).limit(1);
      if (!rows.length || rows[0].projectId !== access.project.id) return NextResponse.json({ error: "Connection not found in this project" }, { status: 404 });
      if (rows[0].status === "revoked") return NextResponse.json({ error: "Connection is revoked; rotate credentials first" }, { status: 400 });
      engine = parseEngine(rows[0].engine);
      creds = decryptCredentials<Record<string, unknown>>(rows[0].secretCiphertext);
      connectionId = rows[0].id;
      // Which schemas to scan can be changed per scan without re-entering credentials.
      if (typeof body.schemaSelection === "string") {
        creds.schemaSelection = body.schemaSelection;
        await db.update(databaseConnections).set({ schemaSelection: body.schemaSelection.slice(0, 2000) || "*" }).where(eq(databaseConnections.id, rows[0].id));
      } else if (creds.schemaSelection === undefined) creds.schemaSelection = rows[0].schemaSelection;
    } else {
      const adapter = getAdapter(engine);
      const valid = adapter.validate(body);
      if (!valid.ok) return NextResponse.json({ error: valid.reason }, { status: 400 });
      creds = adapter.credentials(body);
    }
    let model;
    try {
      model = await getAdapter(engine).introspect(creds, { sampleSize: Number(body.sampleSize ?? 200) });
    } catch (e) {
      // connection / permission problems are the caller's to fix — report them plainly
      return NextResponse.json({ error: sanitizeDbError(e) }, { status: 502 });
    }
    const ns = model.namespaces.length;
    const label = `Live ${engineLabel(engine)} scan${ns > 1 ? ` · ${ns} ${namespaceLabel(engine, true)}` : ""}`;
    const { scanId, analysisId, dataStoreId } = await persistScan({
      projectId: access.project.id, engine, source: "introspection", connectionId, label, model, importWarnings: [],
      store: {
        dataStoreId: typeof body.dataStoreId === "string" && /^[0-9a-f-]{36}$/i.test(body.dataStoreId) ? body.dataStoreId : null,
        name: body.storeName ? String(body.storeName).slice(0, 200) : null,
        role: body.storeRole ? String(body.storeRole) : null,
      },
    });
    await audit(access.project.id, user.email, "scan.introspect", "scan", scanId, { engine, connectionId, namespaces: model.namespaces });
    return NextResponse.json({ scanId, analysisId, dataStoreId, engine, namespaces: model.namespaces, entities: model.entities.length, warnings: model.warnings }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
