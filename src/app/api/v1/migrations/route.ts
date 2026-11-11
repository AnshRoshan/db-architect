import { NextResponse } from "next/server";
import { db } from "@/db";
import { desc, eq } from "drizzle-orm";
import { migrationPlans } from "@/db/schema";
import { getScanDetail } from "@/lib/scan";
import { diffModels, generateMigration, validateMigration, scriptHash } from "@/lib/diff-migrate";
import { SchemaModel, Engine } from "@/lib/schema-model";
import { audit } from "@/lib/server";
import { apiError, requireProject, requireScan, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ migrations: [] });
    await requireProject(projectId, "read");
    const rows = await db.select().from(migrationPlans).where(eq(migrationPlans.projectId, projectId)).orderBy(desc(migrationPlans.createdAt)).limit(30);
    return NextResponse.json({ migrations: rows });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const rows = await db.select().from(migrationPlans).where(eq(migrationPlans.id, String(body.migrationId ?? ""))).limit(1);
    if (!rows.length) return NextResponse.json({ error: "Migration not found" }, { status: 404 });
    const access = await requireProject(rows[0].projectId, "write");
    const upScript = String(body.upScript ?? rows[0].upScript).slice(0, 500000);
    const downScript = String(body.downScript ?? rows[0].downScript).slice(0, 500000);
    const validation = validateMigration(upScript, rows[0].engine);
    const [migration] = await db.update(migrationPlans).set({ upScript, downScript, validation: validation as unknown as Record<string, unknown>, scriptHash: scriptHash(upScript) }).where(eq(migrationPlans.id, rows[0].id)).returning();
    await audit(access.project.id, user.email, "migration.edit_validate", "migration", rows[0].id, { valid: validation.ok, hash: migration.scriptHash });
    return NextResponse.json({ migration });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const projectId = String(body.projectId ?? "");
    await requireProject(projectId, "write");
    await requireScan(String(body.sourceScanId ?? ""), "read");
    await requireScan(String(body.targetScanId ?? ""), "read");
    const a = await getScanDetail(String(body.sourceScanId ?? ""));
    const b = await getScanDetail(String(body.targetScanId ?? ""));
    if (!a?.version || !b?.version) return NextResponse.json({ error: "Both scans must exist" }, { status: 404 });
    const sm = a.version.model as unknown as SchemaModel;
    const tm = b.version.model as unknown as SchemaModel;
    const engine: Engine = (body.engine as Engine) ?? tm.engine ?? sm.engine;
    if (sm.engine === "redis" || tm.engine === "redis" || engine === "redis") return NextResponse.json({ error: "Migrations are generated for relational and document schemas. Redis key models can be compared in the Explorer, but not migrated." }, { status: 400 });
    const diff = diffModels(sm, tm);
    const gen = generateMigration(engine, diff, sm, tm);
    const validation = validateMigration(gen.up, engine);
    const [row] = await db
      .insert(migrationPlans)
      .values({
        projectId,
        sourceScanId: String(body.sourceScanId),
        targetScanId: String(body.targetScanId),
        engine,
        diff: diff as unknown as Record<string, unknown>,
        upScript: gen.up,
        downScript: gen.down,
        risks: gen.risks,
        validation: validation as unknown as Record<string, unknown>,
        scriptHash: scriptHash(gen.up),
      })
      .returning();
    await audit(projectId, user.email, "migration.generate", "migration", row.id, { engine, changes: diff.changes.length });
    return NextResponse.json({ migration: row, diff }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
