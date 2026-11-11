import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { analysisFindings, analysisRuns, databaseConnections, schemaScans, schemaVersions } from "@/db/schema";
import { apiError, requireProject, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(req.url);
    const access = await requireProject(searchParams.get("projectId") ?? "", "read");
    const projectId = access.project.id;
    const [connections, scans] = await Promise.all([
      db.select({ id: databaseConnections.id, status: databaseConnections.status }).from(databaseConnections).where(eq(databaseConnections.projectId, projectId)),
      db.select().from(schemaScans).where(eq(schemaScans.projectId, projectId)).orderBy(desc(schemaScans.createdAt)).limit(30),
    ]);
    const latest = scans.find((s) => ["completed", "partial"].includes(s.status)) ?? scans[0] ?? null;
    let findingsBySeverity: Record<string, number> = {};
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
    return NextResponse.json({
      project: { ...access.project, role: access.role },
      organization: access.organization,
      stats: {
        connections: connections.length,
        healthyConnections: connections.filter((c) => c.status === "healthy").length,
        scans: scans.length,
        entities: stats.entities ?? 0,
        fields: stats.fields ?? 0,
        indexes: stats.indexes ?? 0,
        relationships: stats.relationships ?? 0,
        findings: Object.values(findingsBySeverity).reduce((a, b) => a + b, 0),
        designScore: stats.designScore ?? null,
        analysisDurationMs,
        bySeverity: findingsBySeverity,
      },
      recentScans: scans,
      latestScanId: latest?.id ?? null,
      latestVersion,
    });
  } catch (e) {
    return apiError(e);
  }
}
