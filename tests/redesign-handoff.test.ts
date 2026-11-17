import { describe, it, expect } from "vitest";
import { parseMongoJson, parseSqlDdl } from "../src/lib/dsl";
import { analyzeModel } from "../src/lib/analysis";
import { analyzeArchitecture, type StoreInput } from "../src/lib/architecture";
import { parseRedisDump } from "../src/lib/redis-model";
import { FIXTURE_COMMERCE_MONGO_JSON, FIXTURE_MULTISCHEMA_SQL, FIXTURE_REDIS_JSON } from "../src/lib/fixtures-polyglot";
import { extractRequirementSignals, planRedesign } from "../src/lib/redesign";
import { buildHandoffExport, parseProposal, verifyProposal } from "../src/lib/handoff";

const coreModel = () => parseSqlDdl(FIXTURE_MULTISCHEMA_SQL, "commerce_core", "postgres").model;
const mongoModel = () => parseMongoJson(FIXTURE_COMMERCE_MONGO_JSON, "commerce_content").model;
const redisModel = () => parseRedisDump(FIXTURE_REDIS_JSON, "commerce_cache").model;

const polyglotStores = (): StoreInput[] => [
  { id: "core", name: "commerce-core", engine: "postgres", role: "primary", model: coreModel() },
  { id: "content", name: "commerce-content", engine: "mongodb", role: "service", model: mongoModel() },
  { id: "cache", name: "commerce-cache", engine: "redis", role: "cache", model: redisModel() },
];
const defaultFlows = [{ id: "f1", fromStoreId: "core", toStoreId: "cache", kind: "cache_aside" }];

describe("Requirements-driven Architecture & Database Redesign Engine", () => {
  it("extracts compliance, tenancy, scale, latency and engine-migration signals from plain English", () => {
    const sig = extractRequirementSignals("We are building a B2B multi-tenant SaaS with EU GDPR residency, PCI billing, full-text search, <5ms Redis caching, 100M order events, and want to migrate to PostgreSQL.");
    expect(sig.inferredCompliance).toEqual(expect.arrayContaining(["gdpr", "pci"]));
    expect(sig.inferredCapabilities).toEqual(expect.arrayContaining(["search", "cache"]));
    expect(sig.inferredTenancy).toBe("b2b_shared");
    expect(sig.inferredScale).toBe("scale");
    expect(sig.inferredLatency).toBe("realtime");
    expect(sig.inferredTargetEngine).toBe("postgres");
    expect(sig.inferredGoal).toBe("migrate_engine");
  });

  it("produces a concrete blueprint that fixes real issues and measurably improves the deterministic score", () => {
    const bp = planRedesign(polyglotStores(), defaultFlows, {
      goal: "multi_tenant",
      tenancy: "b2b_shared",
      scale: "scale",
      latency: "realtime",
      compliance: ["pci", "gdpr", "soc2"],
      capabilities: ["oltp", "cache", "analytics", "search"],
      productBrief: "B2B commerce with strict tenant isolation and real-time analytics dashboards",
    });

    expect(bp.gaps.some((g) => g.title.includes("audit.change_log"))).toBe(true);
    expect(bp.gaps.some((g) => g.title.includes("Floating-point monetary"))).toBe(true);
    expect(bp.gaps.some((g) => g.title.includes("Circular schema dependency"))).toBe(true);
    expect(bp.gaps.some((g) => g.area === "tenancy")).toBe(true);
    expect(bp.gaps.some((g) => g.area === "scale")).toBe(true);

    // Deterministic Before -> After verification
    expect(bp.verdict.currentDesignScore).not.toBeNull();
    expect(bp.verdict.projectedDesignScore).toBeGreaterThan(bp.verdict.currentDesignScore!);
    expect(bp.verdict.findingsResolvedCount).toBeGreaterThanOrEqual(4);
    expect(bp.verdict.projectedArchitectureScore).toBeGreaterThan(bp.verdict.currentArchitectureScore);

    // Synthesized artifacts: DDL, RLS policies, partitioning, Redis TTL fixes, CDC flow, complementary stores
    expect(bp.artifacts.supplementarySql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(bp.artifacts.supplementarySql).toContain("PARTITION OF");
    expect(bp.artifacts.redisPolicyScript).toContain("volatile-lru");
    expect(bp.artifacts.migrationUp).toContain("CREATE INDEX CONCURRENTLY");
    expect(bp.artifacts.migrationValidation?.ok).toBe(true);
    expect(bp.targetFlows.some((f) => f.isNew && f.kind === "cdc" && f.to === "commerce-content")).toBe(true);
    expect(bp.targetStores.some((s) => s.status === "new" && s.role === "analytics")).toBe(true);
    expect(bp.targetStores.some((s) => s.status === "new" && s.role === "search")).toBe(true);
    expect(bp.cutoverPhases.length).toBe(4);
  });

  it("synthesizes a cross-engine migration blueprint when moving PostgreSQL -> MongoDB", () => {
    const bp = planRedesign(polyglotStores(), defaultFlows, {
      goal: "migrate_engine",
      targetEngine: "mongodb",
      consistency: "balanced",
    });
    expect(bp.verdict.engineChangeRecommended).toBe(true);
    expect(bp.verdict.recommendedPrimaryEngine).toBe("mongodb");
    expect(bp.targetModel?.engine).toBe("mongodb");
    expect(bp.artifacts.transformSummary?.targetEngine).toBe("mongodb");
    expect(bp.artifacts.etlScript).toContain("mongodb");
    expect(bp.artifacts.targetDdl).toContain("db.createCollection");
  });
});

describe("AI Handoff, Portable Agent Skills & Round-Trip Verification", () => {
  const buildInput = () => {
    const stores = polyglotStores();
    const arch = analyzeArchitecture(stores, defaultFlows);
    return {
      projectName: "Commerce Platform",
      stores: stores.map((s) => {
        const a = s.model ? analyzeModel(s.model) : null;
        return { id: s.id, name: s.name, engine: s.engine, role: s.role, model: s.model, findings: a?.findings ?? [], designScore: a?.summary.designScore ?? null };
      }),
      flows: defaultFlows,
      architecture: arch,
      task: "redesign" as const,
      scope: "system" as const,
      detail: "standard" as const,
      productRequirements: "Scale to 50M orders and eliminate cross-store drift.",
    };
  };

  it("exports all 6 portable formats with zero rows/secrets and valid metadata", () => {
    const base = buildInput();
    const formats = ["prompt_pack", "skill_md", "claude_md", "cursor_mdc", "agents_md", "context_json"] as const;
    for (const format of formats) {
      const b = buildHandoffExport({ ...base, format });
      expect(b.stats.rowsExported).toBe(0);
      expect(b.stats.secretsExported).toBe(0);
      expect(b.stats.stores).toBe(3);
      expect(b.estimatedTokens).toBeGreaterThan(100);
      expect(b.content).toContain("commerce-core");
      expect(b.content).toContain("commerce-cache");
      // Never leak sample values or secrets
      expect(b.content).not.toContain("Mozilla/5.0");
      expect(b.content).not.toContain("a@example.com");
    }
    const skill = buildHandoffExport({ ...base, format: "skill_md" });
    expect(skill.filename).toBe("SKILL.md");
    expect(skill.content).toMatch(/^---\nname: db-architect-commerce-platform/);
    expect(skill.content).toContain("db-architect-proposal");

    const mdc = buildHandoffExport({ ...base, format: "cursor_mdc" });
    expect(mdc.filename).toBe("db-architect.mdc");
    expect(mdc.content).toContain("globs:");

    const jsonBundle = buildHandoffExport({ ...base, format: "context_json" });
    const parsed = JSON.parse(jsonBundle.content);
    expect(parsed.format).toBe("db-architect/context/v1");
    expect(parsed.privacy.rowsExported).toBe(0);
    expect(parsed.stores.length).toBe(3);
  });

  it("parses a ChatGPT/Claude prose reply with db-architect-proposal block, verifies fixes, catches AI regressions, and builds a valid migration", () => {
    const baseline = coreModel();
    // Proposal fixes audit.change_log PK + duplicate index + schema cycle,
    // BUT intentionally introduces an AI mistake: a float price column + plaintext password!
    const aiReply = `Sure! Here is my proposal:

\`\`\`db-architect-proposal
{
  "format": "db-architect/proposal/v1",
  "title": "Clean core + CDC",
  "summary": "Fixes PK and cycle, adds CDC.",
  "targetEngine": "postgres",
  "sql": "CREATE SCHEMA IF NOT EXISTS auth;\\nCREATE SCHEMA IF NOT EXISTS sales;\\nCREATE SCHEMA IF NOT EXISTS audit;\\nCREATE TABLE auth.users (id uuid PRIMARY KEY, email varchar(320) NOT NULL UNIQUE, password text NOT NULL);\\nCREATE TABLE sales.orders (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id), total_price float NOT NULL);\\nCREATE INDEX orders_user_idx ON sales.orders (user_id);\\nCREATE TABLE audit.change_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL);",
  "architectureChanges": {
    "flows": [{ "from": "commerce-core", "to": "commerce-content", "kind": "cdc", "description": "Outbox CDC" }]
  }
}
\`\`\`
`;
    const v = verifyProposal({ rawInput: aiReply, baselineModel: baseline, projectStores: polyglotStores(), projectFlows: defaultFlows });
    expect(v.parsed.sourceKind).toBe("proposal_json");
    expect(v.validation.errors).toEqual([]);
    // Fixes real issues from baseline
    expect(v.comparison.findingsFixed.some((f) => f.ruleId === "PG-SCHEMA-001")).toBe(true);
    expect(v.comparison.findingsFixed.some((f) => f.ruleId === "PG-CONST-001" && f.object === "audit.change_log")).toBe(true);
    // Catches AI mistakes deterministically!
    expect(v.comparison.regressions.some((f) => f.ruleId === "PG-SEC-001" && f.object === "auth.users.password")).toBe(true);
    expect(v.comparison.regressions.some((f) => f.ruleId === "PG-TYPE-020" && f.object === "sales.orders.total_price")).toBe(true);
    // Generates a statically valid migration
    expect(v.diff).not.toBeNull();
    expect(v.migration?.validation.ok).toBe(true);
    // Simulates architecture improvement (ARCH-001 resolved by CDC flow)
    expect(v.architecturePreview?.scoreDelta).toBeGreaterThan(0);
    expect(v.architecturePreview?.resolvedArchFindings.some((f) => f.ruleId === "ARCH-001")).toBe(true);
  });

  it("also accepts plain fenced SQL replies without the JSON wrapper", () => {
    const parsed = parseProposal("Try this schema:\n```sql\nCREATE SCHEMA billing;\nCREATE TABLE billing.invoices (id uuid PRIMARY KEY, total numeric(12,2) NOT NULL);\n```");
    expect(parsed.sourceKind).toBe("sql_ddl");
    expect(parsed.model.entities[0].name).toBe("billing.invoices");
  });
});
