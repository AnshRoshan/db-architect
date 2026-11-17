import { NextResponse } from "next/server";
import { getScanDetail } from "@/lib/scan";
import { askFrontierArchitect, AI_MODELS, AI_SUGGESTED_PROMPTS } from "@/lib/ai";
import { loadProjectContext, normalizeFindingRow } from "@/lib/project-context";
import { SchemaModel } from "@/lib/schema-model";
import { apiError, requireScan, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    models: Object.values(AI_MODELS),
    suggested: AI_SUGGESTED_PROMPTS,
    defaultModel: "architect",
    provider: process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_MODEL ? process.env.ANTHROPIC_MODEL : process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL ? process.env.OPENAI_MODEL : "built-in",
  });
}

export async function POST(req: Request) {
  try {
    await requireUser();
    const body = await req.json();
    const question = String(body.question ?? "").slice(0, 3000);
    if (!question) return NextResponse.json({ error: "question required" }, { status: 400 });

    const modelType = String(body.modelType ?? "architect");
    const access = await requireScan(String(body.scanId ?? ""), "read");
    const [d, ctx] = await Promise.all([
      getScanDetail(String(body.scanId ?? "")),
      loadProjectContext(access.project.id).catch(() => null),
    ]);
    if (!d?.version) return NextResponse.json({ error: "scanId must reference an analyzed scan" }, { status: 404 });

    const model = d.version.model as unknown as SchemaModel;
    const findings = (d.findings as unknown as Record<string, unknown>[]).map(normalizeFindingRow);
    const system = ctx ? { architecture: ctx.architecture, flows: ctx.flows } : undefined;

    const result = await askFrontierArchitect(question, model, findings, modelType, system);
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
