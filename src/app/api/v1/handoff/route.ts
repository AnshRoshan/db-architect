import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dataFlows, dataStores, redesignBlueprints } from "@/db/schema";
import { apiError, requireProject, requireScan, requireUser } from "@/lib/auth";
import { FLOW_KINDS, isStoreRole, type StoreInput } from "@/lib/architecture";
import { isEngine, type Engine } from "@/lib/engines";
import { buildHandoffExport, verifyProposal, type HandoffDetail, type HandoffFormat, type HandoffScope, type HandoffTask } from "@/lib/handoff";
import { loadProjectContext } from "@/lib/project-context";
import { getScanDetail, persistScan } from "@/lib/scan";
import type { SchemaModel } from "@/lib/schema-model";
import { audit, safeError } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FORMATS = new Set<HandoffFormat>(["prompt_pack", "skill_md", "claude_md", "cursor_mdc", "agents_md", "context_json"]);
const TASKS = new Set<HandoffTask>(["redesign", "fix_findings", "migrate_engine", "optimize_queries", "security_tenancy", "custom"]);
const DETAILS = new Set<HandoffDetail>(["compact", "standard", "full"]);

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action ?? "export");
    const access = await requireProject(String(body.projectId ?? ""), action === "apply" ? "write" : "read");
    const projectId = access.project.id;
    const ctx = await loadProjectContext(projectId);

    if (action === "export") {
      const format = FORMATS.has(body.format as HandoffFormat) ? (body.format as HandoffFormat) : "prompt_pack";
      const task = TASKS.has(body.task as HandoffTask) ? (body.task as HandoffTask) : "redesign";
      const detail = DETAILS.has(body.detail as HandoffDetail) ? (body.detail as HandoffDetail) : "standard";
      const scope: HandoffScope = body.scope === "store" ? "store" : "system";
      const focusStoreId = typeof body.focusStoreId === "string" ? body.focusStoreId : null;

      const bundle = buildHandoffExport({
        projectName: ctx.project.name,
        projectDescription: ctx.project.description,
        stores: ctx.stores.map((s) => ({
          id: s.id, name: s.name, engine: s.engine, role: s.role, description: s.description,
          model: s.model, findings: s.findings, designScore: s.designScore,
        })),
        flows: ctx.flows,
        architecture: ctx.architecture,
        focusStoreId,
        format,
        task,
        scope,
        detail,
        productRequirements: typeof body.productRequirements === "string" ? body.productRequirements.slice(0, 6000) : undefined,
        targetEngine: typeof body.targetEngine === "string" ? body.targetEngine : undefined,
      });
      await audit(projectId, user.email, "handoff.export", "project", projectId, { format, task, scope, estimatedTokens: bundle.estimatedTokens });
      return NextResponse.json({ bundle });
    }

    // Load optional baseline model for verification/apply
    let baselineModel: SchemaModel | null = null;
    if (typeof body.baselineScanId === "string" && /^[0-9a-f-]{36}$/i.test(body.baselineScanId)) {
      const scanAccess = await requireScan(body.baselineScanId, "read");
      if (scanAccess.project.id === projectId) {
        const d = await getScanDetail(body.baselineScanId);
        baselineModel = (d?.version?.model as unknown as SchemaModel) ?? null;
      }
    } else {
      const primary = ctx.stores.find((s) => s.role === "primary" && s.model) ?? ctx.stores.find((s) => s.model);
      baselineModel = primary?.model ?? null;
    }

    const rawInput = String(body.rawInput ?? "");
    if (!rawInput.trim()) return NextResponse.json({ error: "Paste an AI response or upload a proposal file first." }, { status: 400 });
    if (rawInput.length > 2_500_000) return NextResponse.json({ error: "Proposal exceeds 2.5 MB limit." }, { status: 413 });

    const storeInputs: StoreInput[] = ctx.stores.map((s) => ({
      id: s.id, name: s.name, engine: s.engine, role: s.role, description: s.description,
      model: s.model, scanId: s.scanId, designScore: s.designScore, findingCount: s.findings.length, versions: s.versions,
    }));

    let verified;
    try {
      verified = verifyProposal({ rawInput, baselineModel, projectStores: storeInputs, projectFlows: ctx.flows });
    } catch (e) {
      return NextResponse.json({ error: safeError(e) }, { status: 422 });
    }

    if (action === "verify") {
      return NextResponse.json({ verified });
    }

    if (action === "apply") {
      const saveSchema = body.saveSchema !== false && verified.parsed.model.entities.length > 0;
      const applyArch = Boolean(body.applyArchitecture && verified.parsed.architectureChanges);
      let scanId: string | null = null;
      let storesAdded = 0;
      let flowsAdded = 0;

      if (saveSchema) {
        const engine: Engine = isEngine(verified.parsed.model.engine) ? verified.parsed.model.engine : "postgres";
        const label = String(body.label ?? `AI Proposal · ${verified.parsed.title}`).slice(0, 200);
        const persisted = await persistScan({
          projectId,
          engine,
          source: "transform",
          label,
          model: verified.parsed.model,
          importWarnings: [...verified.parsed.parseWarnings, ...verified.validation.warnings],
          store: false,
        });
        scanId = persisted.scanId;
      }

      if (applyArch && verified.parsed.architectureChanges) {
        const existingStores = await db.select().from(dataStores).where(eq(dataStores.projectId, projectId));
        const idByName = new Map(existingStores.map((s) => [s.name.toLowerCase(), s.id]));
        for (const ps of verified.parsed.architectureChanges.stores ?? []) {
          const existing = existingStores.find((s) => s.name.toLowerCase() === ps.name.toLowerCase());
          if (existing) {
            if (isStoreRole(ps.role) && ps.role !== existing.role) {
              await db.update(dataStores).set({ role: ps.role, updatedAt: new Date() }).where(eq(dataStores.id, existing.id));
            }
          } else {
            const [created] = await db
              .insert(dataStores)
              .values({ projectId, name: ps.name.slice(0, 200), engine: isEngine(ps.engine) ? ps.engine : "postgres", role: isStoreRole(ps.role) ? ps.role : "service", description: ps.description ?? null })
              .returning({ id: dataStores.id });
            idByName.set(ps.name.toLowerCase(), created.id);
            storesAdded++;
          }
        }
        const existingFlows = await db.select().from(dataFlows).where(eq(dataFlows.projectId, projectId));
        for (const pf of verified.parsed.architectureChanges.flows ?? []) {
          const fromId = idByName.get(pf.from.toLowerCase());
          const toId = idByName.get(pf.to.toLowerCase());
          const kind = FLOW_KINDS.some((k) => k.id === pf.kind) ? pf.kind : "cdc";
          if (!fromId || !toId || fromId === toId) continue;
          if (existingFlows.some((f) => f.fromStoreId === fromId && f.toStoreId === toId && f.kind === kind)) continue;
          await db.insert(dataFlows).values({ projectId, fromStoreId: fromId, toStoreId: toId, kind, description: pf.description ?? null });
          flowsAdded++;
        }
      }

      // Record verified proposal in redesign_blueprints so teams have an audit trail
      const [record] = await db
        .insert(redesignBlueprints)
        .values({
          projectId,
          name: verified.parsed.title.slice(0, 200),
          kind: "ai_proposal",
          goal: verified.parsed.sourceKind,
          requirements: { summary: verified.parsed.summary },
          blueprint: {
            title: verified.parsed.title,
            summary: verified.parsed.summary,
            rationale: verified.parsed.rationale,
            scoreDelta: verified.comparison.scoreDelta,
            findingsFixed: verified.comparison.findingsFixed.length,
            regressions: verified.comparison.regressions.length,
          },
          targetScanId: scanId,
          createdBy: user.id,
        })
        .returning({ id: redesignBlueprints.id });

      await audit(projectId, user.email, "handoff.apply", "blueprint", record.id, { scanId, storesAdded, flowsAdded });
      return NextResponse.json({ ok: true, scanId, storesAdded, flowsAdded, blueprintId: record.id }, { status: 201 });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return apiError(e);
  }
}
