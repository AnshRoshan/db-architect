import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { databaseConnections } from "@/db/schema";
import { apiError, requireScan, requireUser } from "@/lib/auth";
import { getAdapter } from "@/lib/connectors";
import { ENGINE_LIST, parseEngine } from "@/lib/engines";
import { persistScan, getScanDetail } from "@/lib/scan";
import { decryptCredentials } from "@/lib/secrets";
import { audit } from "@/lib/server";
import { SchemaModel } from "@/lib/schema-model";
import { maskRows, planTransform, transformRows, Row, TransformPlan } from "@/lib/transform";
import { synthDataset } from "@/lib/synth";
import { pkColumns } from "@/lib/sql-dialects";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({ engines: ENGINE_LIST, note: "Any relational engine ↔ MongoDB, and relational ↔ relational, are supported. Same-engine changes use Diff & Migrate." });
}

async function liveSample(plan: TransformPlan, model: SchemaModel, connectionId: string, projectId: string, limit: number): Promise<Record<string, Row[]>> {
  const rows = await db.select().from(databaseConnections).where(eq(databaseConnections.id, connectionId)).limit(1);
  if (!rows.length || rows[0].projectId !== projectId) throw new Error("Connection not found in this project");
  if (rows[0].status === "revoked") throw new Error("Connection is revoked; rotate credentials first");
  const conn = rows[0];
  if (parseEngine(conn.engine) !== model.engine) throw new Error(`This connection is ${conn.engine}, but the scanned schema is ${model.engine}. Pick a connection to the source database.`);
  const adapter = getAdapter(model.engine);
  const creds = decryptCredentials<Record<string, unknown>>(conn.secretCiphertext);
  const ent = (name: string) => {
    const e = model.entities.find((x) => x.name === name);
    if (!e) throw new Error(`Entity ${name} not found in the scanned schema`);
    return { name: e.name, shortName: e.shortName, namespace: e.namespace };
  };
  const input: Record<string, Row[]> = {};
  const rt = plan.runtime;
  if (rt.kind === "sql_to_sql") {
    for (const t of rt.tables) input[t.source] = await adapter.sample(creds, ent(t.source), limit);
  } else if (rt.kind === "sql_to_mongo") {
    for (const c of rt.collections) {
      const parents = await adapter.sample(creds, ent(c.source), limit);
      input[c.source] = parents;
      for (const em of c.embeds) {
        const values = parents.map((r) => r[em.parentKey]).filter((v) => v != null);
        input[em.source] = values.length ? await adapter.sample(creds, ent(em.source), Math.min(50, limit * 5), { column: em.fk, values }) : [];
      }
      for (const j of c.junctions) {
        const values = parents.map((r) => r[j.parentKey]).filter((v) => v != null);
        input[j.source] = values.length ? await adapter.sample(creds, ent(j.source), Math.min(50, limit * 5), { column: j.fkParent, values }) : [];
      }
    }
  } else {
    for (const r of rt.roots) input[r.source] = await adapter.sample(creds, ent(r.source), limit);
  }
  return input;
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const action = String(body.action ?? "plan");
    const scanId = String(body.scanId ?? "");
    const live = action === "preview" && body.source === "live";
    const access = await requireScan(scanId, live || body.save ? "write" : "read");
    const detail = await getScanDetail(scanId);
    if (!detail?.version) return NextResponse.json({ error: "Scan has no schema version" }, { status: 404 });
    const model = detail.version.model as unknown as SchemaModel;
    if (model.engine === "redis" || body.targetEngine === "redis") return NextResponse.json({ error: "Redis key models describe a keyspace, not a schema — they cannot be a transformation source or target." }, { status: 400 });
    const target = parseEngine(body.targetEngine, model.engine === "mongodb" ? "postgres" : "mongodb");
    let plan: TransformPlan;
    try { plan = planTransform(model, target, body.options ?? {}); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }

    if (action === "plan") {
      let saved: { scanId: string } | null = null;
      if (body.save) {
        const label = String(body.label ?? `${model.engine} → ${target} design`).slice(0, 200);
        const r = await persistScan({ projectId: access.project.id, engine: target, source: "transform", label, model: plan.targetModel, importWarnings: plan.warnings, store: false });
        saved = { scanId: r.scanId };
        await audit(access.project.id, user.email, "transform.save_target", "scan", r.scanId, { from: model.engine, to: target });
      } else await audit(access.project.id, user.email, "transform.plan", "scan", scanId, { from: model.engine, to: target });
      const { runtime, ...rest } = plan;
      void runtime;
      return NextResponse.json({ plan: rest, saved });
    }

    if (action === "preview") {
      const limit = Math.max(1, Math.min(Number(body.limit ?? 4), 10));
      const mask = body.mask !== false;
      let input: Record<string, Row[]>;
      let mode: "synthetic" | "live";
      if (live) {
        if (body.consent !== true) return NextResponse.json({ error: "Live preview reads real rows. Tick the consent box to confirm you are authorized to view them." }, { status: 400 });
        input = await liveSample(plan, model, String(body.connectionId ?? ""), access.project.id, limit);
        mode = "live";
        await audit(access.project.id, user.email, "transform.preview_live", "connection", String(body.connectionId), { entities: plan.sourceTables.length, limit, masked: mask, to: target });
      } else {
        input = synthDataset(model, plan.sourceTables, limit);
        mode = "synthetic";
      }
      if (mask) {
        for (const [name, rows] of Object.entries(input)) {
          const e = model.entities.find((x) => x.name === name);
          const keys = new Set<string>(e ? [...pkColumns(e), ...e.constraints.filter((c) => c.kind === "foreign_key").flatMap((c) => c.columns)] : []);
          input[name] = maskRows(rows, keys);
        }
      }
      const output = transformRows(plan, input);
      return NextResponse.json({ mode, masked: mask, input, output, notes: mode === "live" ? "Rows were read inside a read-only transaction, are shown once and are never stored." : "Synthetic rows derived from the schema — no real data involved." });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return apiError(e);
  }
}
