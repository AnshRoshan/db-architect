import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { dataFlows, dataStores, redesignBlueprints } from "@/db/schema";
import { apiError, requireProject, requireUser } from "@/lib/auth";
import { FLOW_KINDS, isStoreRole, type StoreInput } from "@/lib/architecture";
import { isEngine, type Engine } from "@/lib/engines";
import { loadProjectContext } from "@/lib/project-context";
import { planRedesign, type RedesignRequirements } from "@/lib/redesign";
import { persistScan } from "@/lib/scan";
import { audit } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(req.url);
    const access = await requireProject(searchParams.get("projectId") ?? "", "read");
    const rows = await db
      .select()
      .from(redesignBlueprints)
      .where(eq(redesignBlueprints.projectId, access.project.id))
      .orderBy(desc(redesignBlueprints.createdAt))
      .limit(30);
    return NextResponse.json({ blueprints: rows });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action ?? "generate");
    const access = await requireProject(String(body.projectId ?? ""), action === "generate" ? "read" : "write");
    const projectId = access.project.id;

    if (action === "delete_blueprint") {
      const id = String(body.blueprintId ?? "");
      if (!UUID.test(id)) return NextResponse.json({ error: "Invalid blueprintId" }, { status: 400 });
      await db.delete(redesignBlueprints).where(and(eq(redesignBlueprints.id, id), eq(redesignBlueprints.projectId, projectId)));
      await audit(projectId, user.email, "redesign.delete", "blueprint", id, {});
      return NextResponse.json({ ok: true });
    }

    const ctx = await loadProjectContext(projectId);
    const storeInputs: StoreInput[] = ctx.stores.map((s) => ({
      id: s.id, name: s.name, engine: s.engine, role: s.role, description: s.description,
      model: s.model, scanId: s.scanId, designScore: s.designScore, findingCount: s.findings.length, versions: s.versions,
    }));
    const reqs = (body.requirements ?? {}) as Partial<RedesignRequirements>;
    const blueprint = planRedesign(storeInputs, ctx.flows, reqs);

    if (action === "generate") {
      return NextResponse.json({ blueprint });
    }

    if (action === "save_blueprint") {
      const name = String(body.name ?? blueprint.verdict.headline).slice(0, 200);
      const [saved] = await db
        .insert(redesignBlueprints)
        .values({
          projectId,
          name,
          kind: "redesign",
          goal: blueprint.requirements.goal,
          requirements: blueprint.requirements as unknown as Record<string, unknown>,
          blueprint: blueprint as unknown as Record<string, unknown>,
          createdBy: user.id,
        })
        .returning();
      await audit(projectId, user.email, "redesign.save", "blueprint", saved.id, { goal: blueprint.requirements.goal, targetEngine: blueprint.verdict.recommendedPrimaryEngine });
      return NextResponse.json({ blueprint, saved }, { status: 201 });
    }

    if (action === "materialize_schema") {
      if (!blueprint.targetModel || !blueprint.targetModel.entities.length) {
        return NextResponse.json({ error: "This blueprint does not contain a target schema model to save (add or import a schema first)." }, { status: 400 });
      }
      const label = String(body.label ?? `Redesign · ${blueprint.verdict.headline}`).slice(0, 200);
      const engine: Engine = isEngine(blueprint.targetModel.engine) ? blueprint.targetModel.engine : "postgres";
      const persisted = await persistScan({
        projectId,
        engine,
        source: "transform",
        label,
        model: blueprint.targetModel,
        importWarnings: blueprint.limitations,
        store: false,
      });
      await audit(projectId, user.email, "redesign.materialize_schema", "scan", persisted.scanId, { engine, label });
      return NextResponse.json({ scanId: persisted.scanId, analysisId: persisted.analysisId, engine }, { status: 201 });
    }

    if (action === "apply_architecture") {
      const existingStores = await db.select().from(dataStores).where(eq(dataStores.projectId, projectId));
      const idByName = new Map(existingStores.map((s) => [s.name.toLowerCase(), s.id]));
      let storesAdded = 0;
      let flowsAdded = 0;

      for (const ts of blueprint.targetStores) {
        if (ts.status !== "new") continue;
        if (idByName.has(ts.name.toLowerCase())) continue;
        const engine = isEngine(ts.engine) ? ts.engine : "postgres";
        const [created] = await db
          .insert(dataStores)
          .values({ projectId, name: ts.name.slice(0, 200), engine, role: isStoreRole(ts.role) ? ts.role : "other", description: ts.rationale.slice(0, 1000) })
          .returning({ id: dataStores.id });
        idByName.set(ts.name.toLowerCase(), created.id);
        storesAdded++;
      }

      const existingFlows = await db.select().from(dataFlows).where(eq(dataFlows.projectId, projectId));
      for (const tf of blueprint.targetFlows) {
        if (!tf.isNew) continue;
        const fromId = idByName.get(tf.from.toLowerCase());
        const toId = idByName.get(tf.to.toLowerCase());
        const kind = FLOW_KINDS.some((k) => k.id === tf.kind) ? tf.kind : "cdc";
        if (!fromId || !toId || fromId === toId) continue;
        if (existingFlows.some((f) => f.fromStoreId === fromId && f.toStoreId === toId && f.kind === kind)) continue;
        await db.insert(dataFlows).values({ projectId, fromStoreId: fromId, toStoreId: toId, kind, description: tf.rationale.slice(0, 500) });
        flowsAdded++;
      }

      await audit(projectId, user.email, "redesign.apply_architecture", "project", projectId, { storesAdded, flowsAdded });
      return NextResponse.json({ ok: true, storesAdded, flowsAdded });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return apiError(e);
  }
}
