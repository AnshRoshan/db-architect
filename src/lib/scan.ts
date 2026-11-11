import { db } from "@/db";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import {
  projects,
  schemaScans,
  schemaVersions,
  analysisRuns,
  analysisFindings,
  diagramLayouts,
  dataStores,
} from "@/db/schema";
import { SchemaModel, modelStats, Engine } from "./schema-model";
import { validateModel } from "./dsl";
import { analyzeModel } from "./analysis";
import { layoutDiagram, renderSvg } from "./diagram";
import { defaultRole, isStoreRole } from "./architecture";

/** Where a scan belongs. `false` keeps it unattached (e.g. a proposed target design). */
export interface StoreHint { dataStoreId?: string | null; name?: string | null; role?: string | null }

/**
 * A project is a system of datastores. Every captured schema is a version of
 * exactly one of them: an explicit choice wins, then the saved connection it
 * came from, then a store with the same engine and database name; otherwise a
 * new store is created with a sensible default role.
 */
export async function resolveDataStore(opts: { projectId: string; engine: string; database: string; connectionId?: string | null; hint?: StoreHint }): Promise<string> {
  const { projectId, engine, hint } = opts;
  const stores = await db.select().from(dataStores).where(eq(dataStores.projectId, projectId)).orderBy(asc(dataStores.createdAt));
  const explicit = hint?.dataStoreId ? stores.find((s) => s.id === hint.dataStoreId) : undefined;
  const wanted = hint?.name?.trim();
  let match = explicit;
  if (!match && wanted) match = stores.find((s) => s.name.toLowerCase() === wanted.toLowerCase());
  if (!match && !wanted && opts.connectionId) match = stores.find((s) => s.connectionId === opts.connectionId);
  if (!match && !wanted) match = stores.find((s) => s.engine === engine && (s.databaseName ?? "") === opts.database && (!opts.connectionId || !s.connectionId));
  if (match) {
    const patch: Partial<typeof dataStores.$inferInsert> = {};
    if (match.engine !== engine) patch.engine = engine;
    if (!match.databaseName) patch.databaseName = opts.database;
    if (opts.connectionId && !match.connectionId) patch.connectionId = opts.connectionId;
    if (isStoreRole(hint?.role) && hint?.role !== match.role && (explicit || wanted)) patch.role = hint.role;
    if (Object.keys(patch).length) await db.update(dataStores).set({ ...patch, updatedAt: new Date() }).where(eq(dataStores.id, match.id));
    return match.id;
  }
  const role = isStoreRole(hint?.role) ? hint.role : defaultRole(engine, stores.map((s) => s.role));
  const [row] = await db
    .insert(dataStores)
    .values({ projectId, name: (wanted || opts.database || `${engine} store`).slice(0, 200), engine, role, databaseName: opts.database, connectionId: opts.connectionId ?? null })
    .returning({ id: dataStores.id });
  return row.id;
}

/** One-time migration for projects created before datastores existed. */
export async function backfillStores(projectId: string): Promise<number> {
  const existing = await db.select({ id: dataStores.id }).from(dataStores).where(eq(dataStores.projectId, projectId)).limit(1);
  if (existing.length) return 0;
  const orphans = await db
    .select({ id: schemaScans.id, engine: schemaScans.engine, source: schemaScans.source, connectionId: schemaScans.connectionId, database: sql<string | null>`${schemaVersions.model}->>'database'` })
    .from(schemaScans)
    .leftJoin(schemaVersions, eq(schemaVersions.scanId, schemaScans.id))
    .where(and(eq(schemaScans.projectId, projectId), isNull(schemaScans.dataStoreId)))
    .orderBy(asc(schemaScans.createdAt))
    .limit(300);
  let attached = 0;
  for (const scan of orphans) {
    if (scan.source === "transform") continue; // proposed designs are not running datastores
    const storeId = await resolveDataStore({ projectId, engine: scan.engine, database: scan.database ?? "imported_db", connectionId: scan.connectionId });
    await db.update(schemaScans).set({ dataStoreId: storeId }).where(eq(schemaScans.id, scan.id));
    attached++;
  }
  return attached;
}

export async function persistScan(opts: {
  projectId: string;
  engine: Engine;
  source: string;
  connectionId?: string | null;
  label?: string;
  model: SchemaModel;
  importWarnings: string[];
  store?: StoreHint | false;
}): Promise<{ scanId: string; analysisId: string; dataStoreId: string | null }> {
  const { projectId, engine, source, model, importWarnings } = opts;
  const now = new Date();
  const dataStoreId = opts.store === false ? null : await resolveDataStore({ projectId, engine, database: model.database, connectionId: opts.connectionId, hint: opts.store });
  // create scan in terminal-ish flow (sync execution with recorded stages)
  const [scan] = await db
    .insert(schemaScans)
    .values({
      projectId,
      connectionId: opts.connectionId ?? null,
      dataStoreId,
      engine,
      source,
      status: "analyzing",
      progress: 60,
      currentStage: "normalizing",
      startedAt: now,
    })
    .returning({ id: schemaScans.id });

  const { errors, warnings } = validateModel(model);
  model.warnings = [...new Set([...importWarnings, ...model.warnings, ...warnings])];
  if (errors.length) model.warnings.push(...errors.map((e) => `ERROR: ${e}`));

  const stats = modelStats(model);
  // version number = count+1
  const existing = await db
    .select({ v: schemaVersions.version })
    .from(schemaVersions)
    .where(eq(schemaVersions.projectId, projectId))
    .orderBy(desc(schemaVersions.version))
    .limit(1);
  const version = (existing[0]?.v ?? 0) + 1;

  await db.insert(schemaVersions).values({
    scanId: scan.id,
    projectId,
    version,
    label: opts.label ?? `${source} v${version}`,
    engine,
    model: model as unknown as Record<string, unknown>,
    warnings: model.warnings,
    entityCount: stats.entities,
    fieldCount: stats.fields,
    indexCount: stats.indexes,
    relationshipCount: stats.relationships,
  });

  const t0 = Date.now();
  const { findings, summary } = analyzeModel(model);
  const [run] = await db
    .insert(analysisRuns)
    .values({
      scanId: scan.id,
      projectId,
      summary: summary as unknown as Record<string, unknown>,
      durationMs: Date.now() - t0,
    })
    .returning({ id: analysisRuns.id });

  if (findings.length) {
    await db.insert(analysisFindings).values(
      findings.map((f) => ({
        analysisId: run.id,
        scanId: scan.id,
        ruleId: f.ruleId,
        category: f.category,
        severity: f.severity,
        title: f.title,
        objectName: f.object,
        evidence: f.evidence,
        explanation: f.explanation,
        recommendation: f.recommendation,
        confidence: f.confidence,
        requiresWorkload: f.requiresWorkload,
        limitations: f.limitations,
        evidenceLevel: f.evidenceLevel,
        status: "open",
      }))
    );
  }

  // diagram (ELK server layout + SVG)
  try {
    const layout = await layoutDiagram(model);
    const svg = renderSvg(model, layout);
    await db.insert(diagramLayouts).values({
      scanId: scan.id,
      name: "default",
      layout: layout as unknown as Record<string, unknown>,
      svg,
    });
  } catch {
    // diagram must never fail a scan
  }

  await db
    .update(schemaScans)
    .set({
      status: errors.length ? "partial" : "completed",
      progress: 100,
      currentStage: errors.length ? "partial" : "completed",
      error: errors.length ? errors.join("; ").slice(0, 1000) : null,
      stats: { ...stats, findings: findings.length, designScore: summary.designScore },
      finishedAt: new Date(),
    })
    .where(eq(schemaScans.id, scan.id));

  return { scanId: scan.id, analysisId: run.id, dataStoreId };
}

export async function getScanDetail(scanId: string) {
  const scans = await db.select().from(schemaScans).where(eq(schemaScans.id, scanId)).limit(1);
  if (!scans.length) return null;
  const scan = scans[0];
  const versions = await db.select().from(schemaVersions).where(eq(schemaVersions.scanId, scanId)).limit(1);
  const runs = await db.select().from(analysisRuns).where(eq(analysisRuns.scanId, scanId)).limit(1);
  const findings = runs.length
    ? await db.select().from(analysisFindings).where(eq(analysisFindings.analysisId, runs[0].id))
    : [];
  const layouts = await db.select().from(diagramLayouts).where(eq(diagramLayouts.scanId, scanId)).limit(1);
  const project = await db.select().from(projects).where(eq(projects.id, scan.projectId)).limit(1);
  const store = scan.dataStoreId ? (await db.select({ id: dataStores.id, name: dataStores.name, role: dataStores.role, engine: dataStores.engine }).from(dataStores).where(eq(dataStores.id, scan.dataStoreId)).limit(1))[0] ?? null : null;
  return { scan, version: versions[0] ?? null, run: runs[0] ?? null, findings, layout: layouts[0] ?? null, project: project[0] ?? null, store };
}
