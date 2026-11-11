import { describe, it, expect } from "vitest";
import { parseMongoJson, parseSqlDdl } from "../src/lib/dsl";
import { analyzeModel } from "../src/lib/analysis";
import { buildRedisModel, keyPattern, parseRedisDump } from "../src/lib/redis-model";
import { analyzeArchitecture, defaultRole, namespaceGraph, type StoreInput } from "../src/lib/architecture";
import { resolveSchemaSelection } from "../src/lib/pg-introspection";
import { mergeModels } from "../src/lib/connectors";
import { detectSqlDialect, isTransformable, TRANSFORMABLE_ENGINES } from "../src/lib/engines";
import { FIXTURE_COMMERCE_MONGO_JSON, FIXTURE_MULTISCHEMA_SQL, FIXTURE_REDIS_JSON } from "../src/lib/fixtures-polyglot";
import { FIXTURE_ECOMMERCE_SQL, FIXTURE_MYSQL_SQL } from "../src/lib/fixtures";

const pg = () => parseSqlDdl(FIXTURE_MULTISCHEMA_SQL, "commerce_core", "postgres").model;
const mongo = () => parseMongoJson(FIXTURE_COMMERCE_MONGO_JSON, "commerce_content").model;
const redis = () => parseRedisDump(FIXTURE_REDIS_JSON, "commerce_cache").model;
const system = (): StoreInput[] => [
  { id: "core", name: "commerce-core", engine: "postgres", role: "primary", model: pg() },
  { id: "content", name: "commerce-content", engine: "mongodb", role: "service", model: mongo() },
  { id: "cache", name: "commerce-cache", engine: "redis", role: "cache", model: redis() },
];
const CACHE_FLOW = [{ id: "f1", fromStoreId: "core", toStoreId: "cache", kind: "cache_aside" }];

describe("one database, many schemas", () => {
  it("parses every schema, not just public", () => {
    const m = pg();
    expect(detectSqlDialect(FIXTURE_MULTISCHEMA_SQL)).toBe("postgres");
    for (const ns of ["public", "auth", "catalog", "sales", "billing", "support", "analytics", "audit"]) expect(m.namespaces).toContain(ns);
    expect(m.entities.length).toBe(20);
    expect(m.entities.find((e) => e.name === "billing.invoices")?.namespace).toBe("billing");
  });

  it("keeps cross-schema foreign keys, including ones added by ALTER TABLE", () => {
    const m = pg();
    const has = (from: string, to: string) => m.relationships.some((r) => r.fromEntity === from && r.toEntity === to && r.provenance === "explicit");
    expect(has("sales.orders", "auth.users")).toBe(true);
    expect(has("sales.order_items", "catalog.products")).toBe(true);
    expect(has("billing.invoices", "sales.orders")).toBe(true);
    expect(has("auth.users", "billing.subscriptions")).toBe(true);
  });

  it("builds the schema dependency graph and finds the cycle", () => {
    const g = namespaceGraph(pg());
    const edge = (from: string, to: string) => g.edges.find((e) => e.from === from && e.to === to);
    expect(edge("sales", "auth")?.count).toBe(1);
    expect(edge("billing", "auth")?.count).toBe(2);
    expect(edge("sales", "catalog")?.examples[0]).toContain("order_items.product_id");
    expect(g.cycles).toContainEqual(["auth", "billing"]);
    expect(g.namespaces.find((n) => n.name === "catalog")?.tables).toBe(4);
    expect(g.namespaces.find((n) => n.name === "auth")?.inbound).toBeGreaterThanOrEqual(5);
  });

  it("raises schema-level findings only when there is more than one schema", () => {
    const multi = analyzeModel(pg()).findings;
    const cycle = multi.find((f) => f.ruleId === "PG-SCHEMA-001");
    expect(cycle?.object).toBe("auth ⇄ billing");
    expect(cycle?.severity).toBe("medium");
    expect(multi.find((f) => f.ruleId === "PG-SCHEMA-003")?.object).toBe("auth");
    // existing per-table rules still fire inside non-public schemas
    expect(multi.some((f) => f.object.startsWith("audit.change_log") && /primary key/i.test(f.title))).toBe(true);
    for (const single of [FIXTURE_ECOMMERCE_SQL, FIXTURE_MYSQL_SQL]) {
      expect(analyzeModel(parseSqlDdl(single).model).findings.filter((f) => /-SCHEMA-/.test(f.ruleId))).toEqual([]);
    }
  });

  it("detects a schema-per-tenant layout", () => {
    const ddl = ["tenant_a", "tenant_b", "tenant_c"].map((t) => `CREATE TABLE ${t}.accounts (id uuid PRIMARY KEY);\nCREATE TABLE ${t}.invoices (id uuid PRIMARY KEY, account_id uuid REFERENCES ${t}.accounts(id));`).join("\n");
    const findings = analyzeModel(parseSqlDdl(ddl, "saas", "postgres").model).findings;
    expect(findings.find((f) => f.ruleId === "PG-SCHEMA-004")?.title).toContain("3 schemas share an identical table set");
    expect(findings.some((f) => f.ruleId === "PG-SCHEMA-002")).toBe(false);
  });

  it("resolves schema selections: all, lists, globs and exclusions", () => {
    const available = ["analytics", "audit", "auth", "public", "tenant_a", "tenant_b"];
    expect(resolveSchemaSelection("*", available).selected).toEqual(available);
    expect(resolveSchemaSelection("", available).selected).toEqual(available);
    expect(resolveSchemaSelection("public, auth", available).selected).toEqual(["auth", "public"]);
    expect(resolveSchemaSelection("tenant_*", available).selected).toEqual(["tenant_a", "tenant_b"]);
    expect(resolveSchemaSelection("*, !audit, !tenant_*", available).selected).toEqual(["analytics", "auth", "public"]);
    expect(resolveSchemaSelection("public,nope", available)).toEqual({ selected: ["public"], missing: ["nope"] });
  });

  it("merges several MySQL databases into one store model", () => {
    const a = parseSqlDdl("CREATE TABLE users (id int PRIMARY KEY);", "x", "mysql").model;
    const b = parseSqlDdl("CREATE TABLE orders (id int PRIMARY KEY);", "y", "mysql").model;
    b.entities.forEach((e) => { e.namespace = "billing"; e.name = `billing.${e.shortName}`; });
    b.namespaces = ["billing"];
    const merged = mergeModels([a, b], "shop");
    expect(merged.entities.length).toBe(2);
    expect(merged.namespaces).toEqual([...a.namespaces, "billing"]);
    expect(merged.catalog?.namespaces.length).toBe(2);
  });
});

describe("redis key model", () => {
  it("turns keys into patterns", () => {
    expect(keyPattern("session:0f8fad5b-d9cb-469f-a165-000000000900")).toBe("session:{session_id}");
    expect(keyPattern("user:42:recent_views")).toBe("user:{user_id}:recent_views");
    expect(keyPattern("rate:login:203.0.113.5")).toBe("rate:login:{ip}");
    expect(keyPattern("leaderboard:daily:2024-06-01")).toBe("leaderboard:daily:{date}");
    expect(keyPattern("queue:emails")).toBe("queue:emails");
    expect(keyPattern("tenants/17/settings")).toBe("tenants/{tenant_id}/settings");
  });

  it("builds entities with type, TTL coverage and shape — and never keeps values", () => {
    const m = redis();
    expect(m.engine).toBe("redis");
    expect(m.namespaces).toEqual(["db0"]);
    const session = m.entities.find((e) => e.shortName === "session:{session_id}")!;
    expect(session.kind).toBe("keyspace");
    expect(session.metadata.redisType).toBe("hash");
    expect(session.metadata.ttl).toMatchObject({ known: 8, with: 8, without: 0 });
    expect(session.fields.map((f) => f.name)).toEqual(expect.arrayContaining(["key", "session_id", "user_id", "ip"]));
    expect(session.fields.find((f) => f.name === "user_id")?.type).toBe("uuid");
    expect(session.rowEstimate).toBeGreaterThan(8); // extrapolated from DBSIZE
    const cache = m.entities.find((e) => e.shortName === "cache:product:{product_id}")!;
    expect(cache.fields.find((f) => f.name === "value")?.nested?.map((f) => f.name)).toContain("price_cents");
    expect(m.relationships.some((r) => r.fromEntity === "db0.session:{session_id}" && r.toEntity === "db0.user:{user_id}")).toBe(true);
    const serialized = JSON.stringify(m);
    for (const secret of ["Mozilla", "a@example.com", "203.0.113.7"]) expect(serialized).not.toContain(secret);
  });

  it("generalises high-cardinality literal segments but keeps real keyspaces apart", () => {
    const flags = Array.from({ length: 9 }, (_, i) => ({ key: `feature:flag_${"abcdefghi"[i]}`, type: "string", ttl: -1 }));
    const caches = ["product", "user", "order"].flatMap((k) => Array.from({ length: 5 }, (_, i) => ({ key: `cache:${k}:${i + 1}`, type: "string", ttl: 60 })));
    const names = buildRedisModel([...flags, ...caches], { database: "t", source: "test" }).entities.map((e) => e.shortName).sort();
    expect(names).toEqual(["cache:order:{order_id}", "cache:product:{product_id}", "cache:user:{user_id}", "feature:{feature_key}"]);
  });

  it("imports plain `key type ttl size` text", () => {
    const { model, warnings } = parseRedisDump("# sample\nsession:abcdef0123456789 hash 1800 5\nqueue:jobs list -1 120\nplainkey\n");
    expect(model.entities.map((e) => e.shortName).sort()).toEqual(["plainkey", "queue:jobs", "session:{session_id}"]);
    expect(warnings[0]).toContain("no type column");
    expect(() => parseRedisDump("{}")).toThrow(/No Redis keys/);
  });

  it("applies Redis rules", () => {
    const { findings, summary } = analyzeModel(redis());
    const rule = (id: string, object: string) => findings.find((f) => f.ruleId === id && f.object.includes(object));
    expect(rule("RD-TTL-001", "otp:")?.severity).toBe("high");
    expect(rule("RD-SIZE-001", "queue:emails")?.title).toBe("Queue grows without a bound");
    expect(rule("RD-MEM-001", "leaderboard:daily")).toBeTruthy();
    expect(rule("RD-TTL-002", "wishlist:")).toBeTruthy();
    expect(findings.find((f) => f.ruleId === "RD-EVICT-001")?.evidence.maxmemoryPolicy).toBe("noeviction");
    expect(findings.some((f) => f.object.includes("session:") && f.ruleId.startsWith("RD-TTL"))).toBe(false);
    expect(summary.designScore).toBeLessThan(90);
    expect(isTransformable("redis")).toBe(false);
    expect(TRANSFORMABLE_ENGINES.map((e) => e.id)).not.toContain("redis");
  });
});

describe("several databases, one system", () => {
  it("infers references and copies across stores", () => {
    const r = analyzeArchitecture(system(), CACHE_FLOW);
    const link = (kind: string, from: string, to: string) => r.links.find((l) => l.kind === kind && l.fromEntity.includes(from) && l.toEntity === to);
    expect(link("reference", "product_reviews", "auth.users")?.fromField).toBe("userId");
    expect(link("reference", "activity_events", "sales.orders")?.fromStoreId).toBe("content");
    expect(link("reference", "session:{session_id}", "auth.users")?.typeMismatch).toBe(false);
    expect(link("reference", "carts", "auth.users")?.typeMismatch).toBe(true);
    expect(link("duplicate", "products", "catalog.products")?.overlap).toBeGreaterThan(0.5);
    expect(link("cache", "cache:product:{product_id}", "catalog.products")?.toStoreId).toBe("core");
    expect(link("cache", "user:{user_id}", "auth.users")).toBeTruthy();
    // a field that resolves inside its own store is not a cross-store link
    expect(r.links.some((l) => l.fromEntity.endsWith("product_reviews") && l.fromField === "productId")).toBe(false);
    expect(r.links.some((l) => l.fromStoreId === l.toStoreId)).toBe(false);
  });

  it("raises architecture findings with the right severity", () => {
    const r = analyzeArchitecture(system(), CACHE_FLOW);
    const rule = (id: string) => r.findings.filter((f) => f.ruleId === id);
    expect(rule("ARCH-001")[0]).toMatchObject({ severity: "high", storeIds: ["content", "core"] });
    expect(rule("ARCH-003")[0].object).toContain("carts.userId");
    expect(rule("ARCH-004").map((f) => f.object)).toEqual(expect.arrayContaining(["commerce-content → commerce-core", "commerce-cache → commerce-core"]));
    const ttl = rule("ARCH-006")[0];
    expect(ttl.severity).toBe("high");
    expect(ttl.evidence.withoutOwner).toEqual(expect.arrayContaining(["wishlist:{wishlist_id}", "queue:emails"]));
    expect(rule("ARCH-005")).toEqual([]);
    expect(rule("ARCH-009")).toEqual([]); // the cache has a declared source
    expect(r.score).toBeLessThan(80);
    expect(r.totals).toMatchObject({ stores: 3, engines: 3, flows: 1 });
    expect(r.stores.find((s) => s.id === "core")?.cycles).toContainEqual(["auth", "billing"]);
  });

  it("changes its verdict when the architecture is declared differently", () => {
    const declared = analyzeArchitecture(system(), [...CACHE_FLOW, { id: "f2", fromStoreId: "core", toStoreId: "content", kind: "cdc" }]);
    expect(declared.findings.some((f) => f.ruleId === "ARCH-001")).toBe(false);
    expect(declared.findings.some((f) => f.ruleId === "ARCH-002")).toBe(true);

    const noOwner = analyzeArchitecture(system().map((s) => ({ ...s, role: s.role === "primary" ? "service" : s.role })), []);
    expect(noOwner.findings.some((f) => f.ruleId === "ARCH-005")).toBe(true);
    expect(noOwner.findings.find((f) => f.ruleId === "ARCH-009")?.object).toBe("commerce-cache");

    const dual = analyzeArchitecture(system(), [{ id: "f3", fromStoreId: "core", toStoreId: "content", kind: "dual_write" }]);
    expect(dual.findings.find((f) => f.ruleId === "ARCH-008")?.title).toBe("Dual write between stores");

    const empty = analyzeArchitecture([...system(), { id: "es", name: "search", engine: "postgres", role: "search", model: null }], CACHE_FLOW);
    expect(empty.findings.find((f) => f.ruleId === "ARCH-007")?.object).toBe("search");
  });

  it("is quiet for a single well-formed store", () => {
    const r = analyzeArchitecture([{ id: "a", name: "shop", engine: "postgres", role: "primary", model: parseSqlDdl(FIXTURE_ECOMMERCE_SQL).model }], []);
    expect(r.links).toEqual([]);
    expect(r.findings).toEqual([]);
    expect(r.score).toBe(100);
    expect(defaultRole("redis", [])).toBe("cache");
    expect(defaultRole("postgres", [])).toBe("primary");
    expect(defaultRole("mongodb", ["primary"])).toBe("service");
  });
});

describe("pg_dump style DDL", () => {
  it("reads keys from ALTER TABLE ONLY … ADD CONSTRAINT instead of inventing a column named CONSTRAINT", () => {
    const sql = `CREATE TABLE sales.orders (id uuid NOT NULL, user_id uuid NOT NULL);
CREATE TABLE auth.users (id uuid NOT NULL);
ALTER TABLE ONLY auth.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY sales.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY sales.orders ADD CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE sales.orders ADD COLUMN note text, ADD COLUMN qty integer NOT NULL DEFAULT 0;`;
    const { model, warnings } = parseSqlDdl(sql, "dump", "postgres");
    const orders = model.entities.find((e) => e.name === "sales.orders")!;
    expect(orders.fields.map((f) => f.name)).toEqual(["id", "user_id", "note", "qty"]);
    expect(orders.constraints.map((c) => c.kind).sort()).toEqual(["foreign_key", "primary_key"]);
    expect(orders.constraints.find((c) => c.kind === "foreign_key")).toMatchObject({ referencedEntity: "auth.users", onDelete: "CASCADE" });
    expect(model.relationships.map((r) => `${r.fromEntity}>${r.toEntity}`)).toEqual(["sales.orders>auth.users"]);
    expect(warnings).toEqual([]);
  });
});
