import { randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationMembers, organizations, projects, schemaScans, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { ensureSchema } from "@/lib/bootstrap";
import { parseSqlDdl } from "@/lib/dsl";
import { FIXTURE_ECOMMERCE_SQL } from "@/lib/fixtures";
import { persistScan } from "@/lib/scan";

const DEMO_EMAIL = "demo@dbarchitect.local";

/**
 * Guaranteed sandbox entry point. Creates (or reuses) a demo identity with its
 * own workspace and a fully analyzed sample schema so the product is never
 * blocked by credential problems.
 */
export async function ensureDemoWorkspace(): Promise<{ user: { id: string; email: string; name: string }; projectId: string }> {
  await ensureSchema();
  let [demoUser] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
  if (!demoUser) {
    [demoUser] = await db
      .insert(users)
      .values({ email: DEMO_EMAIL, name: "Demo Architect", passwordHash: hashPassword(randomBytes(24).toString("hex")) })
      .returning();
  }
  const memberships = await db.select().from(organizationMembers).where(eq(organizationMembers.userId, demoUser.id)).limit(1);
  let orgId = memberships[0]?.orgId;
  if (!orgId) {
    const [org] = await db.insert(organizations).values({ name: "DB Architect Demo", slug: `demo-${randomBytes(4).toString("hex")}`, plan: "team" }).returning();
    orgId = org.id;
    await db.insert(organizationMembers).values({ orgId, userId: demoUser.id, role: "owner" });
  }
  let [project] = await db.select().from(projects).where(eq(projects.orgId, orgId)).limit(1);
  if (!project) {
    [project] = await db
      .insert(projects)
      .values({ orgId, name: "Commerce platform", description: "Sample PostgreSQL schema used to demonstrate analysis", defaultEngine: "postgres", createdBy: demoUser.id })
      .returning();
  }
  const scans = await db.select({ id: schemaScans.id }).from(schemaScans).where(and(eq(schemaScans.projectId, project.id))).limit(1);
  if (!scans.length) {
    const parsed = parseSqlDdl(FIXTURE_ECOMMERCE_SQL, "commerce_demo");
    await persistScan({
      projectId: project.id,
      engine: "postgres",
      source: "upload",
      label: "E-commerce v1",
      model: parsed.model,
      importWarnings: parsed.warnings,
    });
  }
  return { user: { id: demoUser.id, email: demoUser.email, name: demoUser.name }, projectId: project.id };
}
