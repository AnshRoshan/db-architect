import { randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dataFlows, dataStores, organizationMembers, organizations, projects, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { ensureSchema } from "@/lib/bootstrap";
import { parseMongoJson, parseSqlDdl } from "@/lib/dsl";
import { FIXTURE_COMMERCE_MONGO_JSON, FIXTURE_MULTISCHEMA_SQL, FIXTURE_REDIS_JSON } from "@/lib/fixtures-polyglot";
import { parseRedisDump } from "@/lib/redis-model";
import { persistScan } from "@/lib/scan";

const DEMO_EMAIL = "demo@dbarchitect.local";

/**
 * Seed a complete polyglot system into a project: a multi-schema PostgreSQL
 * core, a MongoDB content store and a Redis cache, with one declared data flow.
 * Idempotent per store name. Returns the scan to open first.
 */
export async function seedPolyglotSystem(projectId: string): Promise<{ scanId: string; created: number }> {
  const existing = await db.select().from(dataStores).where(eq(dataStores.projectId, projectId));
  const has = (name: string) => existing.some((s) => s.name === name);
  let created = 0;

  if (!has("commerce-cache")) {
    const redis = parseRedisDump(FIXTURE_REDIS_JSON, "commerce_cache");
    await persistScan({ projectId, engine: "redis", source: "upload", label: "Redis cache · key sample", model: redis.model, importWarnings: redis.warnings, store: { name: "commerce-cache", role: "cache" } });
    created++;
  }
  if (!has("commerce-content")) {
    const mongo = parseMongoJson(FIXTURE_COMMERCE_MONGO_JSON, "commerce_content");
    await persistScan({ projectId, engine: "mongodb", source: "upload", label: "MongoDB content store", model: mongo.model, importWarnings: mongo.warnings, store: { name: "commerce-content", role: "service" } });
    created++;
  }
  // PostgreSQL last so it is the most recent version and opens by default.
  let scanId = "";
  if (!has("commerce-core")) {
    const pg = parseSqlDdl(FIXTURE_MULTISCHEMA_SQL, "commerce_core", "postgres");
    scanId = (await persistScan({ projectId, engine: "postgres", source: "upload", label: "PostgreSQL core · 8 schemas", model: pg.model, importWarnings: pg.warnings, store: { name: "commerce-core", role: "primary" } })).scanId;
    created++;
  }

  const stores = await db.select().from(dataStores).where(eq(dataStores.projectId, projectId));
  const core = stores.find((s) => s.name === "commerce-core");
  const cache = stores.find((s) => s.name === "commerce-cache");
  if (core && cache) {
    const flow = await db.select({ id: dataFlows.id }).from(dataFlows).where(and(eq(dataFlows.fromStoreId, core.id), eq(dataFlows.toStoreId, cache.id))).limit(1);
    if (!flow.length) await db.insert(dataFlows).values({ projectId, fromStoreId: core.id, toStoreId: cache.id, kind: "cache_aside", description: "Product and profile reads are cached; writes invalidate the key." });
  }
  return { scanId, created };
}

/**
 * Guaranteed sandbox entry point. Creates (or reuses) a demo identity with its
 * own workspace and a fully analyzed polyglot system so the product is never
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
      .values({ orgId, name: "Commerce platform", description: "PostgreSQL (8 schemas) + MongoDB + Redis — a sample polyglot system", defaultEngine: "postgres", createdBy: demoUser.id })
      .returning();
  }
  const stores = await db.select({ id: dataStores.id }).from(dataStores).where(eq(dataStores.projectId, project.id)).limit(1);
  if (!stores.length) await seedPolyglotSystem(project.id);
  return { user: { id: demoUser.id, email: demoUser.email, name: demoUser.name }, projectId: project.id };
}
