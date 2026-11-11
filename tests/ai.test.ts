import { describe, it, expect } from "vitest";
import { parseSqlDdl } from "../src/lib/dsl";
import { analyzeModel } from "../src/lib/analysis";
import { askFrontierArchitect, AI_MODELS } from "../src/lib/ai";
import { FIXTURE_ECOMMERCE_SQL } from "../src/lib/fixtures";

describe("Architecture assistant (built-in, rule-grounded)", () => {
  const parsed = parseSqlDdl(FIXTURE_ECOMMERCE_SQL, "shop_e2e");
  const model = parsed.model;
  const analysis = analyzeModel(model);

  it("exposes three honestly named analysis modes", () => {
    expect(Object.keys(AI_MODELS)).toEqual(["architect", "optimizer", "operations"]);
    for (const m of Object.values(AI_MODELS)) expect(m.name).not.toMatch(/opus|fable|gpt|claude/i);
  });

  it("Opus 5.5 Max generates exhaustive architectural and bottleneck critique", async () => {
    const res = await askFrontierArchitect(
      "Perform an exhaustive architectural & bottleneck audit",
      model,
      analysis.findings,
      "architect"
    );
    expect(res.model.id).toBe("architect");
    expect(res.model.engine).toBe("built-in");
    expect(res.answer).toContain("Executive Architecture Audit");
    expect(res.answer).toContain("System Topology");
    expect(res.answer).toContain("Primary Hub Entities");
    expect(res.citations.length).toBeGreaterThan(0);
  });

  it("Fable 5.2 Max generates deep compound index and ESR query plan analysis", async () => {
    const res = await askFrontierArchitect(
      "Analyze index selectivity, redundancy & missing covering indexes",
      model,
      analysis.findings,
      "optimizer"
    );
    expect(res.model.id).toBe("optimizer");
    expect(res.answer).toContain("Compound Index Ordering");
    expect(res.answer).toContain("CREATE INDEX CONCURRENTLY");
  });

  it("Frontier Principal DBA generates zero-downtime online migration strategies", async () => {
    const res = await askFrontierArchitect(
      "Generate a zero-downtime online migration strategy",
      model,
      analysis.findings,
      "operations"
    );
    expect(res.model.id).toBe("operations");
    expect(res.answer).toContain("Zero-Downtime Online Migration");
    expect(res.answer).toContain("Expand-Contract");
    expect(res.answer).toContain("NOT VALID");
  });

  it("handles partitioning and sharding roadmap queries for 100M+ rows", async () => {
    const res = await askFrontierArchitect(
      "Design a table partitioning and sharding roadmap for 100M+ rows",
      model,
      analysis.findings,
      "architect"
    );
    expect(res.answer).toContain("PARTITION BY RANGE");
    expect(res.answer).toContain("Shard Key Selection");
  });
});
