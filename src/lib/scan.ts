import { db } from "@/db";
import { eq, desc } from "drizzle-orm";
import {
  projects,
  schemaScans,
  schemaVersions,
  analysisRuns,
  analysisFindings,
  diagramLayouts,
} from "@/db/schema";
import { SchemaModel, modelStats, Engine } from "./schema-model";
import { validateModel } from "./dsl";
import { analyzeModel } from "./analysis";
import { layoutDiagram, renderSvg } from "./diagram";

export async function persistScan(opts: {
  projectId: string;
  engine: Engine;
  source: string;
  connectionId?: string | null;
  label?: string;
  model: SchemaModel;
  importWarnings: string[];
}): Promise<{ scanId: string; analysisId: string }> {
  const { projectId, engine, source, model, importWarnings } = opts;
  const now = new Date();
  // create scan in terminal-ish flow (sync execution with recorded stages)
  const [scan] = await db
    .insert(schemaScans)
    .values({
      projectId,
      connectionId: opts.connectionId ?? null,
      engine,
      source,
      status: "analyzing",
      progress: 60,
      currentStage: "normalizing",
      startedAt: now,
    })
    .returning({ id: schemaScans.id });

  const { errors, warnings } = validateModel(model);
  model.warnings = [...importWarnings, ...warnings];
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

  const [ver] = await db
    .insert(schemaVersions)
    .values({
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
    })
    .returning({ id: schemaVersions.id });

  void ver;
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

  return { scanId: scan.id, analysisId: run.id };
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
  return { scan, version: versions[0] ?? null, run: runs[0] ?? null, findings, layout: layouts[0] ?? null, project: project[0] ?? null };
}


