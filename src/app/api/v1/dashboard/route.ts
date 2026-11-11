import { NextResponse } from "next/server";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { analysisFindings, analysisRuns, databaseConnections, dataFlows, dataStores, schemaScans, schemaVersions } from "@/db/schema";
import { apiError, requireProject, requireUser } from "@/lib/auth";
import { backfillStores } from "@/lib/scan";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(req.url);
    const access = await requireProject(searchParams.get("projectId") ?? "", "read");
    const projectId = access.project.id;
    await backfillStores(projectId);
    const [connections, scans, stores, flows, versions] = await Promise.all([
      db.select({ id: databaseConnections.id, status: databaseConnections.status }).from(databaseConnections).where(eq(databaseConnections.projectId, projectId)),
      db.select().from(schemaScans).where(eq(schemaScans.projectId, projectId)).orderBy(desc(schemaScans.createdAt)).limit(60),
      db.select().from(dataStores).where(eq(dataStores.projectId, projectId)).orderBy(asc(dataStores.createdAt)),
      db.select({ id: dataFlows.id }).from(dataFlows).where(eq(dataFlows.projectId, projectId)),
      db.select({ scanId: schemaVersions.scanId, version: schemaVersions.version, label: schemaVersions.label }).from(schemaVersions).where(eq(schemaVersions.projectId, projectId)),
    ]);
    const usable = (s: (typeof scans)[number]) => s.status === "completed" || s.status === "partial";
    const latest = scans.find(usable) ?? scans[0] ?? null;
    const findingsBySeverity: Record<string, number> = {};
    let latestVersion: { version: number; label: string | null } | null = null;
    let analysisDurationMs = 0;
    if (latest) {
      const [version] = await db.select({ version: schemaVersions.version, label: schemaVersions.label }).from(schemaVersions).where(eq(schemaVersions.scanId, latest.id)).limit(1);
      latestVersion = version ?? null;
      const [run] = await db.select().from(analysisRuns).where(eq(analysisRuns.scanId, latest.id)).limit(1);
      analysisDurationMs = run?.durationMs ?? 0;
      if (run) {
        const findings = await db.select({ severity: analysisFindings.severity, status: analysisFindings.status }).from(analysisFindings).where(eq(analysisFindings.analysisId, run.id));
        for (const finding of findings) {
          if (finding.status === "dismissed") continue;
          findingsBySeverity[finding.severity] = (findingsBySeverity[finding.severity] ?? 0) + 1;
        }
      }
    }
    const stats = (latest?.stats ?? {}) as Record<string, number>;
    const storeById = new Map(stores.map((s) => [s.id, s]));
    const versionByScan = new Map(versions.map((v) => [v.scanId, v]));
    // every datastore with the health of its most recent version
    const storeCards = stores.map((s) => {
      const own = scans.filter((x) => x.dataStoreId === s.id);
      const current = own.find(usable) ?? null;
      const st = (current?.stats ?? {}) as Record<string, number>;
      return { id: s.id, name: s.name, engine: s.engine, role: s.role, scanId: current?.id ?? null, versions: own.length, entities: st.entities ?? 0, namespaces: st.namespaces ?? 0, findings: st.findings ?? 0, designScore: st.designScore ?? null };
    });
    return NextResponse.json({
      project: { ...access.project, role: access.role },
      organization: access.organization,
      stats: {
        connections: connections.length,
        healthyConnections: connections.filter((c) => c.status === "healthy").length,
        scans: scans.length,
        stores: stores.length,
        flows: flows.length,
        engines: new Set(stores.map((s) => s.engine)).size,
        entities: stats.entities ?? 0,
        fields: stats.fields ?? 0,
        indexes: stats.indexes ?? 0,
        relationships: stats.relationships ?? 0,
        namespaces: stats.namespaces ?? 0,
        findings: Object.values(findingsBySeverity).reduce((a, b) => a + b, 0),
        designScore: stats.designScore ?? null,
        analysisDurationMs,
        bySeverity: findingsBySeverity,
      },
      stores: storeCards,
      recentScans: scans.map((s) => ({
        ...s,
        label: versionByScan.get(s.id)?.label ?? null,
        version: versionByScan.get(s.id)?.version ?? null,
        storeName: s.dataStoreId ? storeById.get(s.dataStoreId)?.name ?? null : null,
        storeRole: s.dataStoreId ? storeById.get(s.dataStoreId)?.role ?? null : null,
      })),
      latestScanId: latest?.id ?? null,
      latestVersion,
    });
  } catch (e) {
    return apiError(e);
  }
}
