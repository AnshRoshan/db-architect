import { NextResponse } from "next/server";
import { getScanDetail } from "@/lib/scan";
import { buildHtmlReport, buildMarkdownReport } from "@/lib/reports";
import { SchemaModel } from "@/lib/schema-model";
import { Finding } from "@/lib/analysis";
import { apiError, requireScan } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const scanId = searchParams.get("scanId");
    const format = (searchParams.get("format") ?? "html").toLowerCase();
    if (!scanId) return NextResponse.json({ error: "scanId required" }, { status: 400 });
    await requireScan(scanId, "read");
    const d = await getScanDetail(scanId);
    if (!d?.version) return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    const model = d.version.model as unknown as SchemaModel;
    const findings = (d.findings as unknown as Finding[]).map((f) => ({
      ruleId: (f as unknown as { rule_id?: string }).rule_id ?? (f as unknown as { ruleId?: string }).ruleId ?? "UNKNOWN",
      category: (f as unknown as { category: Finding["category"] }).category,
      severity: (f as unknown as { severity: Finding["severity"] }).severity,
      title: (f as unknown as { title: string }).title,
      object: (f as unknown as { object?: string }).object ?? (f as unknown as { objectName?: string }).objectName ?? (f as unknown as { object_name?: string }).object_name ?? "",
      evidence: (f as unknown as { evidence: Record<string, unknown> }).evidence ?? {},
      explanation: (f as unknown as { explanation: string }).explanation ?? "",
      recommendation: (f as unknown as { recommendation: string }).recommendation ?? "",
      confidence: (f as unknown as { confidence: number }).confidence ?? 50,
      requiresWorkload: (f as unknown as { requires_workload?: boolean; requiresWorkload?: boolean }).requires_workload ?? (f as unknown as { requiresWorkload?: boolean }).requiresWorkload ?? false,
      limitations: (f as unknown as { limitations: string[] }).limitations ?? [],
      evidenceLevel: (f as unknown as { evidence_level?: Finding["evidenceLevel"]; evidenceLevel?: Finding["evidenceLevel"] }).evidence_level ?? (f as unknown as { evidenceLevel?: Finding["evidenceLevel"] }).evidenceLevel ?? "schema",
    }));
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
