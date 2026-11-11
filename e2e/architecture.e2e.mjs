// End-to-end check of the multi-schema + multi-datastore features through the HTTP API.
//
//   node e2e/architecture.e2e.mjs
//
// Needs the app running (BASE_URL) and, for the live-scan section, a PostgreSQL
// database loaded with the multi-schema fixture (PG_* below). The live section is
// skipped when PG_DATABASE is unreachable. Nothing here writes to the scanned database.
// Uses the demo workspace: changes to it are reverted and the scratch project is deleted.
const B = process.env.BASE_URL ?? "http://localhost:3000";
const pg = { engine: "postgres", host: process.env.PG_HOST ?? "127.0.0.1", port: Number(process.env.PG_PORT ?? 5432), database: process.env.PG_DATABASE ?? "commerce_core", username: process.env.PG_USER ?? "postgres", password: process.env.PG_PASSWORD ?? "postgres", sslMode: "disable" };

let token = "";
let failed = 0;
const call = async (path, body, method) => {
  const r = await fetch(B + path, { method: method ?? (body ? "POST" : "GET"), headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: r.status, ...json };
};
const ok = (name, cond, extra = "") => { if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? `  — ${extra}` : ""}`); };
const section = (t) => console.log(`\n── ${t}`);

section("boot");
const health = await call("/api/health");
ok("health endpoint", health.ok === true, JSON.stringify(health));
const home = await fetch(B + "/").then((r) => r.text());
ok("landing page renders the new hero and real showcase data", home.includes("One architecture.") && home.includes("Real systems are not one database with one schema") && home.includes("cross-schema foreign keys kept"));
ok("workspace shell responds", (await fetch(B + "/app")).status === 200);

section("demo workspace: a seeded polyglot system");
const demo = await call("/api/v1/auth", { action: "demo" });
token = demo.token ?? "";
ok("demo sign-in returns a session", Boolean(token));
const projects = await call("/api/v1/projects");
const demoProject = (projects.projects?.find((p) => p.name === "Commerce platform") ?? projects.projects?.[0])?.id;
const dash = await call(`/api/v1/dashboard?projectId=${demoProject}`);
ok("dashboard lists three datastores", dash.stores?.length === 3, (dash.stores ?? []).map((s) => `${s.name}:${s.engine}:${s.role}`).join(", "));
ok("PostgreSQL core opens by default with 8 schemas", dash.recentScans?.[0]?.storeName === "commerce-core" && dash.stats?.namespaces === 8, `namespaces=${dash.stats?.namespaces} entities=${dash.stats?.entities}`);
ok("scans carry label, version and store", dash.recentScans?.every((s) => s.label && s.version && s.storeName));
const arch = await call(`/api/v1/architecture?projectId=${demoProject}`);
ok("architecture totals", arch.totals?.stores === 3 && arch.totals?.engines === 3 && arch.totals?.flows === 1, JSON.stringify(arch.totals));
const kinds = (arch.links ?? []).reduce((a, l) => ({ ...a, [l.kind]: (a[l.kind] ?? 0) + 1 }), {});
ok("cross-store links inferred", kinds.reference > 0 && kinds.duplicate === 1 && kinds.cache > 0, JSON.stringify(kinds));
ok("architecture findings", ["ARCH-001", "ARCH-003", "ARCH-004", "ARCH-006"].every((id) => arch.findings?.some((f) => f.ruleId === id)), (arch.findings ?? []).map((f) => `${f.ruleId}:${f.severity}`).join(" "));
ok("schema graph inside the core store", arch.stores?.find((s) => s.name === "commerce-core")?.cycles?.[0]?.join("⇄") === "auth⇄billing");
console.log(`      score ${arch.score} · ${arch.links?.length} links · ${arch.findings?.length} findings`);

section("architecture is editable and the analysis follows");
const core = arch.stores.find((s) => s.name === "commerce-core");
const content = arch.stores.find((s) => s.name === "commerce-content");
const withFlow = await call("/api/v1/architecture", { projectId: demoProject, action: "create_flow", fromStoreId: core.id, toStoreId: content.id, kind: "cdc" });
ok("declaring a CDC flow turns the duplicate into a derived copy", !withFlow.findings?.some((f) => f.ruleId === "ARCH-001") && withFlow.findings?.some((f) => f.ruleId === "ARCH-002"));
const dupFlow = await call("/api/v1/architecture", { projectId: demoProject, action: "create_flow", fromStoreId: core.id, toStoreId: content.id, kind: "cdc" });
ok("the same flow cannot be declared twice", dupFlow.status === 409, dupFlow.error);
const flowId = withFlow.flows.find((f) => f.toStoreId === content.id)?.id;
const restored = await call("/api/v1/architecture", { projectId: demoProject, action: "delete_flow", flowId });
ok("removing it restores the finding", restored.findings?.some((f) => f.ruleId === "ARCH-001") && restored.flows.length === 1);
const noOwner = await call("/api/v1/architecture", { projectId: demoProject, action: "update_store", storeId: core.id, role: "service" });
ok("with no system of record, ARCH-005 appears", noOwner.findings?.some((f) => f.ruleId === "ARCH-005"));
await call("/api/v1/architecture", { projectId: demoProject, action: "update_store", storeId: core.id, role: "primary" });
ok("self-flow is rejected", (await call("/api/v1/architecture", { projectId: demoProject, action: "create_flow", fromStoreId: core.id, toStoreId: core.id, kind: "cdc" })).status === 400);
ok("unknown project is rejected", (await call("/api/v1/architecture?projectId=00000000-0000-4000-8000-000000000000")).status >= 400);

section("guards: Redis is a key model, not a schema");
const redisScan = dash.recentScans.find((s) => s.engine === "redis");
const pgScan = dash.recentScans.find((s) => s.engine === "postgres");
const t = await call("/api/v1/transform", { scanId: redisScan.id, targetEngine: "postgres" });
ok("transform refuses a Redis source", t.status === 400, t.error);
const mig = await call("/api/v1/migrations", { projectId: demoProject, sourceScanId: redisScan.id, targetScanId: pgScan.id });
ok("migration refuses a Redis model", mig.status === 400, mig.error);
const redisDetail = await call(`/api/v1/scans/${redisScan.id}`);
ok("Redis findings stored", redisDetail.findings?.some((f) => f.ruleId === "RD-TTL-001") && redisDetail.findings?.some((f) => f.ruleId === "RD-SIZE-001"), `${redisDetail.findings?.length} findings`);

section("imports attach to datastores");
const scratch = (await call("/api/v1/projects", { name: `e2e ${Date.now()}`, description: "architecture e2e", engine: "postgres" })).project?.id;
ok("scratch project created", Boolean(scratch));
try {
const v1 = await call("/api/v1/import", { projectId: scratch, filename: "shop.sql", content: "CREATE TABLE users (id uuid PRIMARY KEY, email text);" });
const v2 = await call("/api/v1/import", { projectId: scratch, filename: "shop_v2.sql", content: "CREATE TABLE users (id uuid PRIMARY KEY, email text, name text);" });
ok("shop.sql and shop_v2.sql are versions of one store", v1.dataStoreId && v1.dataStoreId === v2.dataStoreId);
const keys = await call("/api/v1/import", { projectId: scratch, filename: "prod.keys.txt", content: "session:abcdef0123456789 hash 1800 5\nsession:abcdef0123456790 hash -1 5\nuser:42 hash 600 4\nqueue:jobs list -1 25000", storeName: "edge-cache", storeRole: "session" });
ok("plain-text Redis keys import as a key model", keys.engine === "redis" && keys.entities === 3, JSON.stringify({ engine: keys.engine, entities: keys.entities, error: keys.error }));
const scratchArch = await call(`/api/v1/architecture?projectId=${scratch}`);
ok("two stores with default and chosen roles", scratchArch.stores?.map((s) => `${s.name}:${s.role}`).sort().join(",") === "edge-cache:session,shop:primary", scratchArch.stores?.map((s) => `${s.name}:${s.role}`).join(","));
ok("user:{user_id} keyspace is linked to the users table", scratchArch.links?.some((l) => l.kind === "cache" && l.toEntity === "public.users"));
const placeholder = await call("/api/v1/architecture", { projectId: scratch, action: "create_store", name: "search", engine: "postgres", role: "search" });
ok("placeholder store raises ARCH-007 and ARCH-009", placeholder.findings?.some((f) => f.ruleId === "ARCH-007") && placeholder.findings?.some((f) => f.ruleId === "ARCH-009" && f.object === "search"));

section(`live PostgreSQL: every schema of ${pg.database}`);
const found = await call("/api/v1/connections/schemas", pg);
if (!found.namespaces) {
  console.log(`SKIP  live section (${found.error ?? "database unreachable"})`);
} else {
  const names = found.namespaces.map((n) => n.name);
  ok("discovery lists every non-system schema with counts", ["analytics", "audit", "auth", "billing", "catalog", "empty_schema", "public", "sales", "support", "tenant_a", "tenant_b"].every((n) => names.includes(n)) && !names.some((n) => n.startsWith("pg_")), found.namespaces.map((n) => `${n.name}(${n.tables}t${n.views ? `/${n.views}v` : ""})`).join(" "));
  ok("partitions are not counted as tables", found.namespaces.find((n) => n.name === "audit")?.tables === 2);

  const all = await call("/api/v1/scans", { projectId: scratch, ...pg, schemaSelection: "*", storeName: "live-core", storeRole: "primary" });
  ok("scan of all schemas succeeds", all.status === 201 && all.namespaces?.length === 11, `entities=${all.entities} namespaces=${all.namespaces?.length} ${all.error ?? ""}`);
  const detail = await call(`/api/v1/scans/${all.scanId}`);
  const m = detail.version?.model;
  const ent = (n) => m?.entities.find((e) => e.name === n);
  const rel = (a, b) => m?.relationships.some((r) => r.fromEntity === a && r.toEntity === b && r.provenance === "explicit");
  ok("26 relations, partition children folded into the parent", m?.entities.length === 26 && ent("audit.events_p")?.metadata?.partitions === 2 && !ent("audit.events_p_2024"));
  ok("views and materialized views keep their kind", ent("analytics.order_totals")?.kind === "view" && ent("analytics.revenue_mv")?.kind === "materialized_view");
  ok("cross-schema foreign keys are kept", rel("sales.orders", "auth.users") && rel("sales.order_items", "catalog.products") && rel("billing.invoices", "sales.orders") && rel("auth.users", "billing.subscriptions") && rel("support.tickets", "sales.orders"));
  const featured = ent("catalog.featured")?.constraints.find((c) => c.kind === "foreign_key");
  ok("composite foreign key keeps column pairing", featured?.columns.join() === "category_id,product_id" && featured?.referencedColumns.join() === "category_id,product_id" && featured?.referencedEntity === "catalog.product_categories", JSON.stringify(featured?.columns) + " → " + JSON.stringify(featured?.referencedColumns));
  ok("composite primary key", ent("catalog.product_categories")?.constraints.find((c) => c.kind === "primary_key")?.columns.join() === "product_id,category_id");
  const users = ent("auth.users");
  const lower = users?.indexes.find((i) => i.name === "users_lower_email_idx");
  ok("expression + partial index", lower?.expression === true && lower?.partial === true && /lower/.test(lower?.columns[0] ?? "") && /email IS NOT NULL/.test(lower?.predicate ?? ""), JSON.stringify({ cols: lower?.columns, pred: lower?.predicate }));
  const incl = ent("sales.orders")?.indexes.find((i) => i.name === "orders_status_incl");
  ok("covering index separates key and INCLUDE columns", incl?.columns.join() === "status" && incl?.includeColumns?.join() === "total_cents");
  ok("comments, row estimates, identity and types", users?.comment === "Account holders" && users?.fields.find((f) => f.name === "email")?.comment === "Login identifier" && users?.rowEstimate === 250 && ent("catalog.featured")?.fields.find((f) => f.name === "rank")?.identity === "ALWAYS" && ent("billing.invoices")?.fields.find((f) => f.name === "total")?.type === "numeric(12,2)" && ent("auth.api_keys")?.fields.find((f) => f.name === "scopes")?.type === "text[]", `rows=${users?.rowEstimate} total=${ent("billing.invoices")?.fields.find((f) => f.name === "total")?.type}`);
  ok("no phantom NOT NULL check constraints", !m?.entities.some((e) => e.constraints.some((c) => c.kind === "check" && /not_null/.test(c.name))) && ent("catalog.products")?.constraints.filter((c) => c.kind === "check").length === 1);
  ok("catalog: enums, schema comments, empty schema", m?.catalog?.enums?.some((e) => e.namespace === "sales" && e.name === "order_status" && e.values.join() === "pending,paid,shipped") && m?.catalog?.namespaces.find((n) => n.name === "billing")?.comment === "Invoices and subscriptions" && m?.namespaces.includes("empty_schema"));
  const rules = (detail.findings ?? []).map((f) => f.ruleId);
  ok("schema-level findings on the live model", rules.includes("PG-SCHEMA-001") && rules.includes("PG-SCHEMA-002") && rules.includes("PG-SCHEMA-003"), [...new Set(rules.filter((r) => /SCHEMA/.test(r)))].join(" "));
  ok("diagram layout generated", Boolean(detail.layout?.layout?.nodes?.length), `${detail.layout?.layout?.nodes?.length} nodes`);

  const some = await call("/api/v1/scans", { projectId: scratch, ...pg, schemaSelection: "sales, billing", storeName: "live-core" });
  const partial = (await call(`/api/v1/scans/${some.scanId}`));
  ok("list selection scans only those schemas and flags what it leaves out", some.namespaces?.join() === "billing,sales" && partial.findings?.some((f) => f.ruleId === "PG-SCHEMA-006" && f.objectName === "auth") && partial.version?.model.catalog?.excludedNamespaces?.includes("auth"), `entities=${some.entities}`);
  const glob = await call("/api/v1/scans", { projectId: scratch, ...pg, schemaSelection: "tenant_*", storeName: "live-tenants", storeRole: "service" });
  ok("glob selection", glob.namespaces?.join() === "tenant_a,tenant_b" && glob.entities === 2);
  const excl = await call("/api/v1/scans", { projectId: scratch, ...pg, schemaSelection: "*, !tenant_*, !empty_schema", storeName: "live-core" });
  ok("exclusion selection", excl.namespaces?.length === 8 && !excl.namespaces.includes("tenant_a"));
  const none = await call("/api/v1/scans", { projectId: scratch, ...pg, schemaSelection: "does_not_exist" });
  ok("unknown schema gives a clear error, not a 500", none.status === 502 && /Available:/.test(none.error ?? ""), none.error);
  const bad = await call("/api/v1/scans", { projectId: scratch, ...pg, password: "wrong", schemaSelection: "*" });
  ok("bad credentials are reported plainly and without leaking them", bad.status === 502 && /authentication failed/i.test(bad.error ?? "") && !/wrong/.test(bad.error ?? ""), bad.error);

  const saved = await call("/api/v1/connections", { projectId: scratch, name: "core (saved)", ...pg, schemaSelection: "*" });
  ok("connection saved without exposing the secret", saved.connection?.hasCredentials === true && !JSON.stringify(saved).includes("\"password\""));
  const savedSchemas = await call("/api/v1/connections/schemas", { connectionId: saved.connection.id });
  ok("discovery works from a saved connection", savedSchemas.namespaces?.length === 11 && savedSchemas.selection === "*");
  const rescan = await call("/api/v1/scans", { projectId: scratch, connectionId: saved.connection.id, schemaSelection: "auth,sales" });
  const conns = await call(`/api/v1/connections?projectId=${scratch}`);
  ok("re-scan with a new selection, remembered on the connection", rescan.namespaces?.join() === "auth,sales" && conns.connections?.[0]?.schemaSelection === "auth,sales");
  const final = await call(`/api/v1/architecture?projectId=${scratch}`);
  console.log(`      stores: ${final.stores.map((s) => `${s.name}[${s.engine}/${s.role}] v×${s.versions} ns=${s.namespaces.filter((n) => !n.external).length}`).join(" · ")}`);
  // three named scans + the saved-connection re-scan of the same database join one store
  ok("each live scan landed in the intended store", final.stores.find((s) => s.name === "live-core")?.versions === 4 && final.stores.find((s) => s.name === "live-tenants")?.versions === 1);
}

} finally {
  // leave the workspace as we found it
  if (scratch) {
    const del = await call(`/api/v1/projects?projectId=${scratch}`, { projectId: scratch }, "DELETE");
    ok("scratch project removed", del.status < 300, del.error ?? "");
  }
}

console.log(`\n${failed ? `${failed} check(s) FAILED` : "all checks passed"}`);
process.exit(failed ? 1 : 0);
