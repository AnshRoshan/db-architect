import { NextResponse } from "next/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { dataFlows, dataStores, schemaScans, schemaVersions } from "@/db/schema";
import { apiError, requireProject, requireUser } from "@/lib/auth";
import { analyzeArchitecture, FLOW_KINDS, isStoreRole, type StoreInput } from "@/lib/architecture";
import { isEngine } from "@/lib/engines";
import type { SchemaModel } from "@/lib/schema-model";
import { backfillStores } from "@/lib/scan";
import { seedPolyglotSystem } from "@/lib/demo";
import { audit } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** The whole system for a project: stores, their latest models, declared flows and the cross-store analysis. */
async function loadArchitecture(projectId: string) {
  await backfillStores(projectId);
  const [stores, flows, scans, versions] = await Promise.all([
    db.select().from(dataStores).where(eq(dataStores.projectId, projectId)).orderBy(asc(dataStores.createdAt)),
    db.select().from(dataFlows).where(eq(dataFlows.projectId, projectId)).orderBy(asc(dataFlows.createdAt)),
    db.select().from(schemaScans).where(eq(schemaScans.projectId, projectId)).orderBy(desc(schemaScans.createdAt)).limit(300),
    db.select({ scanId: schemaVersions.scanId, version: schemaVersions.version, label: schemaVersions.label }).from(schemaVersions).where(eq(schemaVersions.projectId, projectId)),
  ]);
  const usable = scans.filter((s) => s.status === "completed" || s.status === "partial");
  const latest = new Map<string, (typeof scans)[number]>();
  for (const s of usable) if (s.dataStoreId && !latest.has(s.dataStoreId)) latest.set(s.dataStoreId, s);
  const latestIds = [...latest.values()].map((s) => s.id);
  const models = latestIds.length ? await db.select({ scanId: schemaVersions.scanId, model: schemaVersions.model }).from(schemaVersions).where(inArray(schemaVersions.scanId, latestIds)) : [];
  const modelByScan = new Map(models.map((m) => [m.scanId, m.model as unknown as SchemaModel]));
  const versionByScan = new Map(versions.map((v) => [v.scanId, v]));

  const inputs: StoreInput[] = stores.map((s) => {
    const scan = latest.get(s.id);
    const stats = (scan?.stats ?? {}) as Record<string, number>;
    return {
      id: s.id, name: s.name, engine: s.engine, role: s.role, description: s.description,
      model: scan ? modelByScan.get(scan.id) ?? null : null, scanId: scan?.id ?? null,
      designScore: stats.designScore ?? null, findingCount: stats.findings ?? null,
      versions: usable.filter((x) => x.dataStoreId === s.id).length,
    };
  });
  const report = analyzeArchitecture(inputs, flows.map((f) => ({ id: f.id, fromStoreId: f.fromStoreId, toStoreId: f.toStoreId, kind: f.kind, description: f.description })));
  return {
    ...report,
    flows: flows.map((f) => ({ id: f.id, fromStoreId: f.fromStoreId, toStoreId: f.toStoreId, kind: f.kind, description: f.description })),
    scans: scans.map((s) => ({
      id: s.id, engine: s.engine, source: s.source, status: s.status, dataStoreId: s.dataStoreId, createdAt: s.createdAt,
      label: versionByScan.get(s.id)?.label ?? null, version: versionByScan.get(s.id)?.version ?? null,
      entities: ((s.stats ?? {}) as Record<string, number>).entities ?? 0,
    })),
  };
}

export async function GET(req: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(req.url);
    const access = await requireProject(searchParams.get("projectId") ?? "", "read");
    return NextResponse.json({ ...(await loadArchitecture(access.project.id)), role: access.role });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const access = await requireProject(String(body.projectId ?? ""), action === "delete_store" ? "admin" : "write");
    const projectId = access.project.id;
    const storeOf = async (id: unknown) => {
      if (typeof id !== "string" || !UUID.test(id)) return null;
      const rows = await db.select().from(dataStores).where(and(eq(dataStores.id, id), eq(dataStores.projectId, projectId))).limit(1);
      return rows[0] ?? null;
    };

    if (action === "create_store") {
      const name = String(body.name ?? "").trim();
      if (name.length < 2) return bad("Give the datastore a name (at least 2 characters).");
      if (!isEngine(body.engine)) return bad("Choose a supported engine.");
      const existing = await db.select({ name: dataStores.name }).from(dataStores).where(eq(dataStores.projectId, projectId));
      if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) return bad(`A datastore named "${name}" already exists in this project.`, 409);
      const [row] = await db.insert(dataStores).values({ projectId, name: name.slice(0, 200), engine: body.engine, role: isStoreRole(body.role) ? body.role : "service", description: body.description ? String(body.description).slice(0, 1000) : null }).returning({ id: dataStores.id });
      await audit(projectId, user.email, "datastore.create", "datastore", row.id, { name, engine: body.engine });
    } else if (action === "update_store") {
      const store = await storeOf(body.storeId);
      if (!store) return bad("Datastore not found in this project.", 404);
      const patch: Partial<typeof dataStores.$inferInsert> = { updatedAt: new Date() };
      if (typeof body.name === "string" && body.name.trim().length >= 2) patch.name = body.name.trim().slice(0, 200);
      if (isStoreRole(body.role)) patch.role = body.role;
      if (typeof body.description === "string") patch.description = body.description.slice(0, 1000) || null;
      await db.update(dataStores).set(patch).where(eq(dataStores.id, store.id));
      await audit(projectId, user.email, "datastore.update", "datastore", store.id, { role: patch.role, name: patch.name });
    } else if (action === "delete_store") {
      const store = await storeOf(body.storeId);
      if (!store) return bad("Datastore not found in this project.", 404);
      await db.delete(dataStores).where(eq(dataStores.id, store.id)); // its versions stay in History, unattached
      await audit(projectId, user.email, "datastore.delete", "datastore", store.id, { name: store.name });
    } else if (action === "assign_scan") {
      const scanId = String(body.scanId ?? "");
      if (!UUID.test(scanId)) return bad("Schema version id is missing or invalid.");
      const store = body.storeId ? await storeOf(body.storeId) : null;
      if (body.storeId && !store) return bad("Datastore not found in this project.", 404);
      const updated = await db.update(schemaScans).set({ dataStoreId: store?.id ?? null }).where(and(eq(schemaScans.id, scanId), eq(schemaScans.projectId, projectId))).returning({ id: schemaScans.id });
      if (!updated.length) return bad("Schema version not found in this project.", 404);
    } else if (action === "create_flow") {
      const [from, to] = await Promise.all([storeOf(body.fromStoreId), storeOf(body.toStoreId)]);
      if (!from || !to) return bad("Choose a source and a target datastore.");
      if (from.id === to.id) return bad("A data flow needs two different datastores.");
      const kind = FLOW_KINDS.some((k) => k.id === body.kind) ? String(body.kind) : "cdc";
      const dup = await db.select({ id: dataFlows.id }).from(dataFlows).where(and(eq(dataFlows.fromStoreId, from.id), eq(dataFlows.toStoreId, to.id), eq(dataFlows.kind, kind))).limit(1);
      if (dup.length) return bad("That data flow is already declared.", 409);
      const [row] = await db.insert(dataFlows).values({ projectId, fromStoreId: from.id, toStoreId: to.id, kind, description: body.description ? String(body.description).slice(0, 500) : null }).returning({ id: dataFlows.id });
      await audit(projectId, user.email, "dataflow.create", "dataflow", row.id, { from: from.name, to: to.name, kind });
    } else if (action === "delete_flow") {
      const flowId = String(body.flowId ?? "");
      if (!UUID.test(flowId)) return bad("Flow id is missing or invalid.");
      await db.delete(dataFlows).where(and(eq(dataFlows.id, flowId), eq(dataFlows.projectId, projectId)));
    } else if (action === "seed_demo") {
      const seeded = await seedPolyglotSystem(projectId);
      await audit(projectId, user.email, "datastore.seed_demo", "project", projectId, { created: seeded.created });
      return NextResponse.json({ ...(await loadArchitecture(projectId)), role: access.role, seededScanId: seeded.scanId || null, created: seeded.created });
    } else {
      return bad("Unknown action.");
    }
    return NextResponse.json({ ...(await loadArchitecture(projectId)), role: access.role });
  } catch (e) {
    return apiError(e);
  }
}
