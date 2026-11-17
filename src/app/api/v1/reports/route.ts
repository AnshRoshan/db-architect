import { NextResponse } from "next/server";
import { getScanDetail } from "@/lib/scan";
import { buildHtmlReport, buildMarkdownReport, buildSystemHtmlReport, buildSystemMarkdownReport } from "@/lib/reports";
import { loadProjectContext, normalizeFindingRow } from "@/lib/project-context";
import { SchemaModel } from "@/lib/schema-model";
import { apiError, requireProject, requireScan } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const scope = (searchParams.get("scope") ?? "scan").toLowerCase();
    const format = (searchParams.get("format") ?? "html").toLowerCase();

    if (scope === "system") {
      const projectId = searchParams.get("projectId") ?? "";
      const access = await requireProject(projectId, "read");
      const ctx = await loadProjectContext(access.project.id);
      if (format === "json") {
        return NextResponse.json({ project: ctx.project, architecture: ctx.architecture, flows: ctx.flows, stores: ctx.stores.map((s) => ({ id: s.id, name: s.name, engine: s.engine, role: s.role, designScore: s.designScore, findingCount: s.findings.length, model: s.model })) });
      }
      if (format === "markdown" || format === "md") {
        const md = buildSystemMarkdownReport(ctx.project.name, ctx.architecture, ctx.flows);
        return new NextResponse(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="db-architect-system-${projectId.slice(0, 8)}.md"` } });
      }
      const html = buildSystemHtmlReport(ctx.project.name, ctx.architecture, ctx.flows);
      return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    const scanId = searchParams.get("scanId");
    if (!scanId) return NextResponse.json({ error: "scanId required" }, { status: 400 });
    await requireScan(scanId, "read");
    const d = await getScanDetail(scanId);
    if (!d?.version) return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    const model = d.version.model as unknown as SchemaModel;
    const findings = (d.findings as unknown as Record<string, unknown>[]).map(normalizeFindingRow);
    const summary = (d.run?.summary as unknown as { entities?: number; findingsBySeverity?: Record<string, number>; designScore?: number; limitations?: string[] }) ?? {};
    const fullSummary = {
      entities: model.entities.length,
      fields: model.entities.reduce((a, e) => a + e.fields.length, 0),
      indexes: model.entities.reduce((a, e) => a + e.indexes.length, 0),
      relationships: model.relationships.length,
      findingsBySeverity: summary.findingsBySeverity ?? {},
      designScore: summary.designScore ?? 80,
      limitations: summary.limitations ?? [],
    };
    const project = (d.project as { name?: string } | null)?.name ?? "Project";
    const meta = { id: scanId, createdAt: String(d.scan.createdAt ?? new Date().toISOString()), engine: String(d.scan.engine) };
    if (format === "markdown" || format === "md") {
      const md = buildMarkdownReport(project, model, findings, fullSummary, meta);
      return new NextResponse(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="db-architect-${scanId.slice(0, 8)}.md"` } });
    }
    if (format === "json") {
      return NextResponse.json({ model, findings, summary: fullSummary, meta });
    }
    const html = buildHtmlReport(project, model, findings, fullSummary, meta, d.layout?.svg ?? "<svg xmlns='http://www.w3.org/2000/svg' width='400' height='120'><text x='16' y='60'>No diagram</text></svg>");
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (e) {
    return apiError(e);
  }
}
