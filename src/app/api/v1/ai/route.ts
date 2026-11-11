import { NextResponse } from "next/server";
import { getScanDetail } from "@/lib/scan";
import { askFrontierArchitect, AI_MODELS, AI_SUGGESTED_PROMPTS } from "@/lib/ai";
import { SchemaModel } from "@/lib/schema-model";
import { Finding } from "@/lib/analysis";
import { apiError, requireScan, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    models: Object.values(AI_MODELS),
    suggested: AI_SUGGESTED_PROMPTS,
    defaultModel: "architect", provider: process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_MODEL ? process.env.ANTHROPIC_MODEL : process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL ? process.env.OPENAI_MODEL : "built-in",
  });
}

export async function POST(req: Request) {
  try {
    await requireUser();
    const body = await req.json();
    const question = String(body.question ?? "").slice(0, 3000);
    if (!question) return NextResponse.json({ error: "question required" }, { status: 400 });

    const modelType = String(body.modelType ?? "architect");
    await requireScan(String(body.scanId ?? ""), "read");
    const d = await getScanDetail(String(body.scanId ?? ""));
    if (!d?.version) return NextResponse.json({ error: "scanId must reference an analyzed scan" }, { status: 404 });

    const model = d.version.model as unknown as SchemaModel;
    const findings = (d.findings as unknown as Finding[]).map((f) => ({
      ruleId: (f as unknown as { rule_id?: string }).rule_id ?? (f as unknown as { ruleId?: string }).ruleId ?? "UNKNOWN",
      category: (f as unknown as { category: Finding["category"] }).category ?? "structure",
      severity: (f as unknown as { severity: Finding["severity"] }).severity ?? "info",
      title: (f as unknown as { title: string }).title ?? "",
      object: (f as unknown as { object?: string }).object ?? (f as unknown as { objectName?: string }).objectName ?? (f as unknown as { object_name?: string }).object_name ?? "",
      evidence: (f as unknown as { evidence: Record<string, unknown> }).evidence ?? {},
      explanation: (f as unknown as { explanation: string }).explanation ?? "",
      recommendation: (f as unknown as { recommendation: string }).recommendation ?? "",
      confidence: (f as unknown as { confidence: number }).confidence ?? 50,
      requiresWorkload: Boolean((f as unknown as { requires_workload?: boolean }).requires_workload ?? (f as unknown as { requiresWorkload?: boolean }).requiresWorkload),
      limitations: (f as unknown as { limitations: string[] }).limitations ?? [],
      evidenceLevel: (f as unknown as { evidence_level?: Finding["evidenceLevel"] }).evidence_level ?? "schema",
    }));

    const result = await askFrontierArchitect(question, model, findings, modelType);
    return NextResponse.json({
      answer: result.answer,
      citations: result.citations,
      model: result.model,
      grounded: true,
    });
  } catch (e) {
    return apiError(e);
  }
}
