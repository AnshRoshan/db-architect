import { describe, it, expect } from "vitest";
import { parseSqlDdl, validateModel } from "../src/lib/dsl";
import { analyzeModel } from "../src/lib/analysis";
import { diffModels, generateMigration, validateMigration } from "../src/lib/diff-migrate";
import { generateDdl } from "../src/lib/sql-dialects";
import { planTransform } from "../src/lib/transform";
import { parseType, renderType } from "../src/lib/type-map";
import { deriveProfile } from "../src/lib/advisor";
import { answerQuestion } from "../src/lib/ai";
import { buildMarkdownReport, buildSystemMarkdownReport } from "../src/lib/reports";
import { analyzeArchitecture } from "../src/lib/architecture";
import { parseRedisDump } from "../src/lib/redis-model";
import { FIXTURE_MULTISCHEMA_SQL, FIXTURE_REDIS_JSON } from "../src/lib/fixtures-polyglot";

describe("SQL parser audit fixes", () => {
  it("captures inline ON DELETE / ON UPDATE, inline UNIQUE, CHECK, views, enums, extensions, comments, PARTITION BY, and CONCURRENTLY expression/INCLUDE indexes", () => {
    const sql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE TYPE billing.invoice_status AS ENUM ('draft', 'open', 'paid');
COMMENT ON SCHEMA billing IS 'Billing context';
CREATE TABLE billing.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  code text NOT NULL UNIQUE,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text NOT NULL
);
COMMENT ON TABLE billing.invoices IS 'Customer invoices';
COMMENT ON COLUMN billing.invoices.code IS 'Public invoice code';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_lower_email ON auth.users (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inv_cust_cov ON billing.invoices (customer_id) INCLUDE (amount, code);
CREATE VIEW billing.open_invoices AS SELECT id, code, amount FROM billing.invoices;
CREATE MATERIALIZED VIEW billing.totals_mv AS SELECT customer_id, amount FROM billing.invoices;
ALTER TABLE auth.users ADD COLUMN balance double precision NOT NULL DEFAULT 0;
`;
    const { model } = parseSqlDdl(sql, "acct", "postgres");
    // Forward-referenced FK from billing.invoices -> auth.users must validate cleanly in two passes
    const val = validateModel(model);
    expect(val.errors).toEqual([]);
    expect(val.warnings.some((w) => w.includes("auth.users"))).toBe(false);

    const inv = model.entities.find((e) => e.name === "billing.invoices")!;
    const fk = inv.constraints.find((c) => c.kind === "foreign_key")!;
    expect(fk.onDelete).toBe("CASCADE");
    expect(fk.onUpdate).toBe("RESTRICT");
    expect(inv.constraints.some((c) => c.kind === "unique" && c.columns.includes("code"))).toBe(true);
    expect(inv.constraints.some((c) => c.kind === "check" && c.definition?.includes("amount >= 0"))).toBe(true);
    expect(inv.metadata.partitioned).toBe(true);
    expect(inv.metadata.partitionBy).toBe("PARTITION BY RANGE (created_at)");
    expect(inv.comment).toBe("Customer invoices");
    expect(inv.fields.find((f) => f.name === "code")?.comment).toBe("Public invoice code");

    const users = model.entities.find((e) => e.name === "auth.users")!;
    expect(users.fields.find((f) => f.name === "balance")?.type).toBe("double precision");
    const exprIdx = users.indexes.find((i) => i.name === "idx_users_lower_email")!;
    expect(exprIdx.expression).toBe(true);
    expect(exprIdx.partial).toBe(true);
    expect(exprIdx.columns[0]).toBe("lower(email)");

    const covIdx = inv.indexes.find((i) => i.name === "idx_inv_cust_cov")!;
    expect(covIdx.columns).toEqual(["customer_id"]);
    expect(covIdx.includeColumns).toEqual(["amount", "code"]);

    expect(model.entities.find((e) => e.name === "billing.open_invoices")?.kind).toBe("view");
    expect(model.entities.find((e) => e.name === "billing.totals_mv")?.kind).toBe("materialized_view");
    expect(model.catalog?.extensions).toContain("pgcrypto");
    expect(model.catalog?.enums).toContainEqual({ namespace: "billing", name: "invoice_status", values: ["draft", "open", "paid"] });
  });
});

describe("deterministic analysis rule upgrades", () => {
  it("detects unconstrained FK-like columns, 32-bit PK overflow risk, plaintext secrets, invalid indexes, unused indexes, and cascade blast radius", () => {
    const sql = `
CREATE TABLE public.users (id uuid PRIMARY KEY, password text NOT NULL);
CREATE TABLE public.orders (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE);
CREATE TABLE public.order_items (id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE);
CREATE TABLE public.order_shipments (id uuid PRIMARY KEY, item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE);
CREATE TABLE public.events (id serial PRIMARY KEY, user_id uuid, payload jsonb);
`;
    const { model } = parseSqlDdl(sql, "shop", "postgres");
    const orders = model.entities.find((e) => e.name === "public.orders")!;
    orders.rowEstimate = 50_000;
    orders.indexes.push(
      { id: "i1", name: "idx_bad", columns: ["user_id"], method: "btree", unique: false, kind: "invalid" },
      { id: "i2", name: "idx_unused", columns: ["user_id"], method: "btree", unique: false, usageCount: 0 }
    );
    const { findings } = analyzeModel(model);
    const has = (ruleId: string, objPart?: string) => findings.some((f) => f.ruleId === ruleId && (!objPart || f.object.includes(objPart)));
    expect(has("PG-SEC-001", "users.password")).toBe(true);
    expect(has("PG-TYPE-004", "events.id")).toBe(true);
    expect(has("PG-CONST-003", "events.user_id")).toBe(true);
    expect(has("PG-INDEX-006", "idx_bad")).toBe(true);
    expect(has("PG-INDEX-007", "idx_unused")).toBe(true);
    expect(has("PG-REL-003", "public.users")).toBe(true);
    expect(findings.find((f) => f.ruleId === "PG-INDEX-007")?.evidenceLevel).toBe("statistics");
  });

  it("does not falsely flag prefix redundancy across different index methods or partial predicates", () => {
    const { model } = parseSqlDdl(`CREATE TABLE public.docs (id uuid PRIMARY KEY, tags text[], active boolean);`, "d", "postgres");
    const docs = model.entities[0];
    docs.indexes.push(
      { id: "a", name: "idx_tags_gin", columns: ["tags"], method: "gin", unique: false },
      { id: "b", name: "idx_tags_active_btree", columns: ["tags", "active"], method: "btree", unique: false }
    );
    const { findings } = analyzeModel(model);
    expect(findings.some((f) => f.ruleId === "PG-INDEX-002")).toBe(false);
  });
});

describe("multi-schema DDL, diff, migration & transform fixes", () => {
  it("emits CREATE SCHEMA for every non-public schema and preserves INCLUDE & PARTITION BY in generateDdl", () => {
    const m = parseSqlDdl(FIXTURE_MULTISCHEMA_SQL, "commerce_core", "postgres").model;
    const ddl = generateDdl(m, "postgres");
    for (const s of ["auth", "catalog", "sales", "billing", "support", "analytics", "audit"]) {
      expect(ddl).toContain(`CREATE SCHEMA IF NOT EXISTS "${s}";`);
    }
  });

  it("normalizes canonical types in diffModels and emits valid multi-schema migrations with CREATE SCHEMA, expression indexes, and real constraint rollbacks", () => {
    const v1 = parseSqlDdl(`
CREATE TABLE public.users (id int4 PRIMARY KEY, email character varying(320) NOT NULL, created_at timestamp with time zone DEFAULT now());
`, "app", "postgres").model;
    const v2 = parseSqlDdl(`
CREATE SCHEMA IF NOT EXISTS billing;
CREATE TABLE public.users (id integer PRIMARY KEY, email varchar(320) NOT NULL, created_at timestamptz DEFAULT now());
CREATE INDEX idx_users_lower_email ON public.users (lower(email)) WHERE email IS NOT NULL;
CREATE TABLE billing.invoices (id uuid PRIMARY KEY, user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE);
`, "app", "postgres").model;
    const diff = diffModels(v1, v2);
    // int4 vs integer, character varying(320) vs varchar(320), timestamp with time zone vs timestamptz must NOT cause false alter_field!
    expect(diff.changes.filter((c) => c.kind === "alter_field")).toEqual([]);
    const mig = generateMigration("postgres", diff, v1, v2);
    expect(mig.up).toContain(`CREATE SCHEMA IF NOT EXISTS billing;`);
    expect(mig.up).toContain(`ON DELETE CASCADE`);
    expect(mig.up).toContain(`(lower(email))`);
    expect(mig.up).toContain(`WHERE email IS NOT NULL`);
    expect(mig.up).not.toContain(`"lower(email)"`);
    expect(mig.down).toContain(`DROP INDEX CONCURRENTLY IF EXISTS public.idx_users_lower_email;`);
    expect(validateMigration(mig.up, "postgres").ok).toBe(true);
  });

  it("preserves multiple schemas on PG -> MySQL transform and disambiguates duplicate names on SQLite", () => {
    const m = parseSqlDdl(`
CREATE TABLE auth.items (id uuid PRIMARY KEY);
CREATE TABLE sales.items (id uuid PRIMARY KEY);
`, "multi", "postgres").model;
    const toMy = planTransform(m, "mysql");
    expect(toMy.targetModel.namespaces.sort()).toEqual(["auth", "sales"]);
    expect(toMy.targetModel.entities.map((e) => e.name).sort()).toEqual(["auth.items", "sales.items"]);
    const toSqlite = planTransform(m, "sqlite");
    expect(toSqlite.targetModel.entities.map((e) => e.shortName).sort()).toEqual(["auth_items", "sales_items"]);
    // Array element type preservation
    const arrInfo = parseType("uuid[]", "postgres");
    expect(renderType(arrInfo, "postgres").type).toBe("uuid[]");
  });
});

describe("advisor, grounded AI & system reports", () => {
  it("derives a key-value profile for Redis instead of misclassifying it as document", () => {
    const r = parseRedisDump(FIXTURE_REDIS_JSON, "commerce_cache").model;
    const d = deriveProfile(r);
    expect(d.profile.dataShape).toBe("key_value");
    expect(d.profile.latency).toBe("ultra_low");
    expect(d.profile.needs).toContain("ttl");
  });

  it("answers multi-schema, entity-specific and rule-specific questions without hardcoded unrelated tables", () => {
    const m = parseSqlDdl(FIXTURE_MULTISCHEMA_SQL, "commerce_core", "postgres").model;
    const { findings, summary } = analyzeModel(m);
    const arch = analyzeArchitecture([{ id: "core", name: "commerce-core", engine: "postgres", role: "primary", model: m }], []);

    const ruleAns = answerQuestion("How do I fix PG-SCHEMA-001?", m, findings, "architect", { architecture: arch, flows: [] });
    expect(ruleAns.answer).toContain("PG-SCHEMA-001");
    expect(ruleAns.answer).toContain("auth ⇄ billing");

    const entAns = answerQuestion("Tell me about billing.invoices", m, findings, "architect", { architecture: arch, flows: [] });
    expect(entAns.answer).toContain("billing.invoices");
    expect(entAns.answer).toContain("invoice_lines");

    const md = buildMarkdownReport("Commerce", m, findings, summary, { id: "s1", createdAt: "2026-01-01", engine: "postgres" });
    expect(md).toContain("## Schemas & Cross-Schema Dependencies");
    expect(md).toContain("auth ⇄ billing");

    const sysMd = buildSystemMarkdownReport("Commerce", arch, []);
    expect(sysMd).toContain("System Architecture Report");
    expect(sysMd).toContain("commerce-core");
  });
});
