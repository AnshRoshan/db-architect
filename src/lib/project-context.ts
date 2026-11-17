import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { analysisFindings, analysisRuns, dataFlows, dataStores, projects, schemaScans, schemaVersions } from "@/db/schema";
import { analyzeArchitecture, type ArchitectureReport, type FlowInput, type StoreInput } from "./architecture";
import type { Finding } from "./analysis";
import { backfillStores } from "./scan";
import type { SchemaModel } from "./schema-model";

export interface LoadedStore {
  id: string;
  name: string;
  engine: string;
  role: string;
  description: string | null;
  scanId: string | null;
  version: number | null;
  label: string | null;
  model: SchemaModel | null;
  findings: Finding[];
  designScore: number | null;
  versions: number;
}

export interface ProjectContext {
  project: { id: string; name: string; description: string | null; defaultEngine: string };
  stores: LoadedStore[];
  flows: FlowInput[];
  architecture: ArchitectureReport;
  scans: {
    id: string;
    engine: string;
    source: string;
    status: string;
    dataStoreId: string | null;
    createdAt: Date;
    label: string | null;
    version: number | null;
    entities: number;
  }[];
}

export function normalizeFindingRow(f: Record<string, unknown>): Finding {
  return {
    ruleId: String(f.ruleId ?? f.rule_id ?? "UNKNOWN"),
    category: (f.category as Finding["category"]) ?? "structure",
    severity: (f.severity as Finding["severity"]) ?? "info",
    title: String(f.title ?? ""),
    object: String(f.object ?? f.objectName ?? f.object_name ?? ""),
    evidence: (f.evidence as Record<string, unknown>) ?? {},
    explanation: String(f.explanation ?? ""),
    recommendation: String(f.recommendation ?? ""),
    confidence: Number(f.confidence ?? 50),
    requiresWorkload: Boolean(f.requiresWorkload ?? f.requires_workload),
    limitations: Array.isArray(f.limitations) ? (f.limitations as string[]) : [],
    evidenceLevel: (f.evidenceLevel ?? f.evidence_level ?? "schema") as Finding["evidenceLevel"],
  };
}

/**
 * Loads the complete multi-datastore context of a project: every datastore, its
 * latest schema model and active findings, all declared flows, and the computed
 * cross-store architecture report.
 */
export async function loadProjectContext(projectId: string): Promise<ProjectContext> {
  await backfillStores(projectId);
  const [projRows, stores, flows, scans, versions] = await Promise.all([
    db.select().from(projects).where(eq(projects.id, projectId)).limit(1),
    db.select().from(dataStores).where(eq(dataStores.projectId, projectId)).orderBy(asc(dataStores.createdAt)),
    db.select().from(dataFlows).where(eq(dataFlows.projectId, projectId)).orderBy(asc(dataFlows.createdAt)),
    db.select().from(schemaScans).where(eq(schemaScans.projectId, projectId)).orderBy(desc(schemaScans.createdAt)).limit(300),
    db.select({ scanId: schemaVersions.scanId, version: schemaVersions.version, label: schemaVersions.label }).from(schemaVersions).where(eq(schemaVersions.projectId, projectId)),
  ]);
  const proj = projRows[0] ?? { id: projectId, name: "Project", description: null, defaultEngine: "postgres" };
  const usable = scans.filter((s) => s.status === "completed" || s.status === "partial");
  const latest = new Map<string, (typeof scans)[number]>();
  for (const s of usable) if (s.dataStoreId && !latest.has(s.dataStoreId)) latest.set(s.dataStoreId, s);

  const latestIds = [...latest.values()].map((s) => s.id);
  const [models, runs] = latestIds.length
    ? await Promise.all([
        db.select({ scanId: schemaVersions.scanId, model: schemaVersions.model }).from(schemaVersions).where(inArray(schemaVersions.scanId, latestIds)),
        db.select({ id: analysisRuns.id, scanId: analysisRuns.scanId }).from(analysisRuns).where(inArray(analysisRuns.scanId, latestIds)),
      ])
    : [[], []];
  const runIds = runs.map((r) => r.id);
  const findingRows = runIds.length
    ? await db.select().from(analysisFindings).where(inArray(analysisFindings.analysisId, runIds))
    : [];

  const modelByScan = new Map(models.map((m) => [m.scanId, m.model as unknown as SchemaModel]));
  const versionByScan = new Map(versions.map((v) => [v.scanId, v]));
  const findingsByScan = new Map<string, Finding[]>();
  for (const row of findingRows) {
    if (row.status === "dismissed" || row.status === "fixed") continue;
    findingsByScan.set(row.scanId, [...(findingsByScan.get(row.scanId) ?? []), normalizeFindingRow(row as unknown as Record<string, unknown>)]);
  }

  const loadedStores: LoadedStore[] = stores.map((s) => {
    const scan = latest.get(s.id);
    const stats = (scan?.stats ?? {}) as Record<string, number>;
    const ver = scan ? versionByScan.get(scan.id) : undefined;
    return {
      id: s.id,
      name: s.name,
      engine: s.engine,
      role: s.role,
      description: s.description,
      scanId: scan?.id ?? null,
      version: ver?.version ?? null,
      label: ver?.label ?? null,
      model: scan ? modelByScan.get(scan.id) ?? null : null,
      findings: scan ? findingsByScan.get(scan.id) ?? [] : [],
      designScore: stats.designScore ?? null,
      versions: usable.filter((x) => x.dataStoreId === s.id).length,
    };
  });

  const flowInputs: FlowInput[] = flows.map((f) => ({
    id: f.id,
    fromStoreId: f.fromStoreId,
    toStoreId: f.toStoreId,
    kind: f.kind,
    description: f.description,
  }));

  const storeInputs: StoreInput[] = loadedStores.map((s) => ({
    id: s.id,
    name: s.name,
    engine: s.engine,
    role: s.role,
    description: s.description,
    model: s.model,
    scanId: s.scanId,
    designScore: s.designScore,
    findingCount: s.findings.length,
    versions: s.versions,
  }));

  const architecture = analyzeArchitecture(storeInputs, flowInputs);

  return {
    project: { id: proj.id, name: proj.name, description: proj.description, defaultEngine: proj.defaultEngine },
    stores: loadedStores,
    flows: flowInputs,
    architecture,
    scans: scans.map((s) => ({
      id: s.id,
      engine: s.engine,
      source: s.source,
      status: s.status,
      dataStoreId: s.dataStoreId,
      createdAt: s.createdAt,
      label: versionByScan.get(s.id)?.label ?? null,
      version: versionByScan.get(s.id)?.version ?? null,
      entities: ((s.stats ?? {}) as Record<string, number>).entities ?? 0,
    })),
  };
}
