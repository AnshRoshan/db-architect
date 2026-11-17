import { advise, DEFAULT_PROFILE, type AdvisorResult, type Need, type WorkloadProfile } from "./advisor";
import { analyzeModel, type Finding } from "./analysis";
import { analyzeArchitecture, type ArchitectureReport, type FlowInput, type StoreInput, type StoreRole } from "./architecture";
import { diffModels, generateMigration, validateMigration } from "./diff-migrate";
import { engineLabel, isRelational, isTransformable, type Engine } from "./engines";
import { constraintId, emptyModel, entityId, fieldId, indexId, type EntityModel, type SchemaModel, type Severity } from "./schema-model";
import { generateDdl, type SqlDialect } from "./sql-dialects";
import { planTransform, type TransformPlan } from "./transform";

// ─── Requirements-driven Architecture & Database Redesign Engine ───
// Evaluates a project's ACTUAL datastores, schemas, findings and cross-store
// topology against declared product requirements and produces a concrete,
// deterministic Redesign Blueprint with real before/after verification.

export type RedesignGoal =
  | "optimize_current"
  | "migrate_engine"
  | "scale_out"
  | "multi_tenant"
  | "decompose"
  | "consolidate";

export type ScaleTier = "startup" | "growth" | "scale" | "hyperscale";
export type LatencySlo = "standard" | "snappy" | "realtime";
export type TenancyModel = "single" | "b2b_shared" | "b2b_isolated" | "consumer_global";
export type ConsistencyMode = "strict_acid" | "balanced" | "eventual_ok";
export type ComplianceTag = "soc2" | "gdpr" | "pci" | "hipaa";
export type CapabilityTag = "oltp" | "search" | "analytics" | "cache" | "queues" | "time_series" | "geo" | "vectors";
export type TeamOps = "lean" | "standard" | "dedicated_sre";

export interface RedesignRequirements {
  goal: RedesignGoal;
  productBrief: string;
  scale: ScaleTier;
  latency: LatencySlo;
  tenancy: TenancyModel;
  consistency: ConsistencyMode;
  compliance: ComplianceTag[];
  capabilities: CapabilityTag[];
  targetEngine: "keep" | "auto" | "postgres" | "mysql" | "sqlite" | "mongodb";
  teamOps: TeamOps;
}

export const DEFAULT_REQUIREMENTS: RedesignRequirements = {
  goal: "optimize_current",
  productBrief: "",
  scale: "growth",
  latency: "snappy",
  tenancy: "single",
  consistency: "strict_acid",
  compliance: [],
  capabilities: ["oltp"],
  targetEngine: "keep",
  teamOps: "standard",
};

export interface RedesignPreset {
  id: string;
  label: string;
  summary: string;
  patch: Partial<RedesignRequirements>;
}

export const REDESIGN_PRESETS: RedesignPreset[] = [
  {
    id: "harden",
    label: "Harden & fix production risks",
    summary: "Fix missing PKs, duplicate indexes, schema cycles, float money and cache TTLs.",
    patch: { goal: "optimize_current", scale: "growth", latency: "snappy", consistency: "strict_acid", compliance: ["soc2"], targetEngine: "keep" },
  },
  {
    id: "b2b_saas",
    label: "B2B Multi-Tenant SaaS (RLS + Audit)",
    summary: "Add tenant isolation, RLS policies, SOC2/GDPR auditability and safe indexes.",
    patch: { goal: "multi_tenant", scale: "growth", latency: "snappy", tenancy: "b2b_shared", consistency: "strict_acid", compliance: ["soc2", "gdpr"], capabilities: ["oltp", "cache", "search"], targetEngine: "postgres" },
  },
  {
    id: "scale_100m",
    label: "Scale to 100M+ rows & <5ms reads",
    summary: "Range-partition high-growth tables, offload analytics, enforce cache TTLs and add replicas.",
    patch: { goal: "scale_out", scale: "scale", latency: "realtime", consistency: "balanced", capabilities: ["oltp", "cache", "analytics", "time_series"], targetEngine: "keep" },
  },
  {
    id: "move_pg",
    label: "Consolidate / move primary to PostgreSQL",
    summary: "Unify relational & JSONB workloads on PostgreSQL with CDC outbox to secondary stores.",
    patch: { goal: "migrate_engine", scale: "growth", latency: "snappy", consistency: "strict_acid", capabilities: ["oltp", "cache"], targetEngine: "postgres" },
  },
  {
    id: "move_mongo",
    label: "Move relational store to MongoDB",
    summary: "Convert tables into embedded documents + referenced collections with $jsonSchema and ETL.",
    patch: { goal: "migrate_engine", scale: "scale", latency: "snappy", consistency: "balanced", capabilities: ["oltp", "cache"], targetEngine: "mongodb" },
  },
  {
    id: "decompose",
    label: "Decompose schemas into bounded services",
    summary: "Break schema cycles, isolate bounded contexts and replace shared writes with CDC/outbox.",
    patch: { goal: "decompose", scale: "scale", latency: "snappy", consistency: "balanced", capabilities: ["oltp", "queues", "cache"], targetEngine: "keep" },
  },
];

export interface RedesignGap {
  id: string;
  area: "integrity" | "scale" | "latency" | "tenancy" | "compliance" | "architecture" | "engine_fit";
  severity: Severity;
  title: string;
  requirement: string;
  currentEvidence: string;
  impact: string;
  remediation: string;
  objects: string[];
}

export interface TargetStoreDesign {
  name: string;
  engine: string;
  role: StoreRole;
  status: "keep" | "upgrade" | "new" | "migrate_to" | "retire";
  rationale: string;
  schemas: string[];
  entities: string[];
  keyPolicies: string[];
}

export interface TargetFlowDesign {
  from: string;
  to: string;
  kind: string;
  rationale: string;
  isNew: boolean;
}

export interface SchemaAction {
  kind: "fix_pk" | "drop_dup_index" | "fix_type" | "add_fk_index" | "add_tenant_rls" | "partition_table" | "break_cycle" | "redis_ttl" | "engine_convert";
  target: string;
  title: string;
  detail: string;
  sqlPreview?: string;
}

export interface CutoverPhase {
  phase: number;
  title: string;
  durationHint: string;
  downtimeRisk: "none" | "low" | "brief_window";
  steps: string[];
  gate: string;
  rollback: string;
}

export interface RedesignBlueprint {
  generatedAt: string;
  requirements: RedesignRequirements;
  detectedSignals: string[];
  verdict: {
    headline: string;
    summary: string;
    recommendedPrimaryEngine: string;
    currentPrimaryEngine: string | null;
    engineChangeRecommended: boolean;
    currentDesignScore: number | null;
    projectedDesignScore: number | null;
    currentArchitectureScore: number;
    projectedArchitectureScore: number;
    findingsResolvedCount: number;
    findingsRemainingCount: number;
  };
  advisor: AdvisorResult;
  gaps: RedesignGap[];
  targetStores: TargetStoreDesign[];
  targetFlows: TargetFlowDesign[];
  schemaActions: SchemaAction[];
  targetModel: SchemaModel | null;
  artifacts: {
    targetDdl: string;
    migrationUp: string;
    migrationDown: string;
    migrationValidation: { ok: boolean; checks: string[] } | null;
    supplementarySql: string;
    redisPolicyScript: string;
    etlScript: string | null;
    transformSummary: {
      sourceEngine: string;
      targetEngine: string;
      fieldsMapped: number;
      lossy: number;
      embedded: number;
      warnings: string[];
      risks: string[];
    } | null;
  };
  cutoverPhases: CutoverPhase[];
  tradeoffs: string[];
  limitations: string[];
}

// ─── Natural-language brief extractor ──────────────────────────────
export function extractRequirementSignals(brief: string): {
  signals: string[];
  inferredCompliance: ComplianceTag[];
  inferredCapabilities: CapabilityTag[];
  inferredTenancy?: TenancyModel;
  inferredScale?: ScaleTier;
  inferredLatency?: LatencySlo;
  inferredTargetEngine?: RedesignRequirements["targetEngine"];
  inferredGoal?: RedesignGoal;
} {
  const s = brief.trim();
  if (!s) return { signals: [], inferredCompliance: [], inferredCapabilities: [] };
  const signals: string[] = [];
  const inferredCompliance: ComplianceTag[] = [];
  const inferredCapabilities: CapabilityTag[] = [];
  let inferredTenancy: TenancyModel | undefined;
  let inferredScale: ScaleTier | undefined;
  let inferredLatency: LatencySlo | undefined;
  let inferredTargetEngine: RedesignRequirements["targetEngine"] | undefined;
  let inferredGoal: RedesignGoal | undefined;

  if (/\b(gdpr|eu\s+residency|right\s+to\s+be\s+forgotten|data\s+residency)\b/i.test(s)) { inferredCompliance.push("gdpr"); signals.push("Brief mentions GDPR / EU residency → data deletion & locality rules enabled"); }
  if (/\b(pci|payment|billing|ledger|fintech|invoice|stripe|money|bank)\b/i.test(s)) { inferredCompliance.push("pci"); signals.push("Brief mentions payments/financial ledger → strict ACID & exact decimal rules enabled"); }
  if (/\b(hipaa|phi|patient|medical|health\s*care)\b/i.test(s)) { inferredCompliance.push("hipaa"); signals.push("Brief mentions HIPAA/healthcare → encryption, audit & strict isolation rules enabled"); }
  if (/\b(soc\s*2|audit\s*trail|compliance|iso\s*27001)\b/i.test(s)) { inferredCompliance.push("soc2"); signals.push("Brief mentions SOC2/auditability → immutable audit & RBAC checks enabled"); }

  if (/\b(multi.?tenant|b2b|saas|org(anization)?\s+isolation|row.?level\s+security|rls)\b/i.test(s)) {
    inferredTenancy = /\b(dedicated|silo|isolated|per.?tenant)\b/i.test(s) ? "b2b_isolated" : "b2b_shared";
    signals.push(`Brief mentions multi-tenancy → ${inferredTenancy === "b2b_isolated" ? "isolated tenant" : "shared schema + RLS"} checks activated`);
  }
  if (/\b(full.?text|search|elasticsearch|opensearch|autocomplete|faceted)\b/i.test(s)) { inferredCapabilities.push("search"); signals.push("Brief mentions search → dedicated search index evaluation added"); }
  if (/\b(analytics|dashboard|bi|reporting|olap|clickhouse|warehouse|metrics)\b/i.test(s)) { inferredCapabilities.push("analytics"); signals.push("Brief mentions analytics/BI → OLAP offload evaluation added"); }
  if (/\b(cache|redis|session|rate.?limit|sub.?5ms|sub.?millisecond|leaderboard)\b/i.test(s)) { inferredCapabilities.push("cache"); signals.push("Brief mentions caching/sessions → in-memory cache & TTL checks added"); }
  if (/\b(queue|worker|background\s+job|async|kafka|event\s+stream|outbox|cdc)\b/i.test(s)) { inferredCapabilities.push("queues"); signals.push("Brief mentions async queues/events → outbox/CDC pattern added"); }
  if (/\b(time.?series|iot|telemetry|sensor|clickstream|log\s+ingestion)\b/i.test(s)) { inferredCapabilities.push("time_series"); signals.push("Brief mentions time-series/telemetry → partitioning & columnar storage evaluated"); }
  if (/\b(geo|location|map|nearby|postgis|coordinates)\b/i.test(s)) { inferredCapabilities.push("geo"); signals.push("Brief mentions geospatial queries → PostGIS / geo index evaluation added"); }
  if (/\b(vector|embedding|rag|semantic\s+search|pgvector|ai\s+search)\b/i.test(s)) { inferredCapabilities.push("vectors"); signals.push("Brief mentions vectors/RAG → pgvector / vector index support evaluated"); }

  if (/\b(100m|billion|terabyte|tb|100k\s*rps|global|massive|millions\s+of\s+users)\b/i.test(s)) { inferredScale = "scale"; signals.push("Brief indicates high scale → partitioning, read replicas & write-amplification rules active"); }
  if (/\b(petabyte|hyperscale|multi.?region\s+active)\b/i.test(s)) { inferredScale = "hyperscale"; signals.push("Brief indicates hyperscale / multi-region active"); }
  if (/(?:<\s*5\s*ms|\bsub.?10ms\b|\breal.?time\b|\blow\s+latency\b)/i.test(s)) { inferredLatency = "realtime"; signals.push("Brief requires real-time / ultra-low latency"); }

  const moveM = s.match(/\b(?:move|migrate|switch|convert|replace)\b[\s\S]{0,40}\bto\s+(postgres(?:ql)?|mysql|mongo(?:db)?|sqlite)\b/i);
  if (moveM) {
    const raw = moveM[1].toLowerCase();
    inferredTargetEngine = raw.startsWith("pg") || raw.startsWith("postgres") ? "postgres" : raw.startsWith("mongo") ? "mongodb" : raw === "mysql" ? "mysql" : "sqlite";
    inferredGoal = "migrate_engine";
    signals.push(`Brief requests moving to ${engineLabel(inferredTargetEngine)} → engine migration blueprint enabled`);
  } else if (/\b(decompose|microservices?|split\s+(?:the\s+)?monolith|extract\s+service)\b/i.test(s)) {
    inferredGoal = "decompose";
    signals.push("Brief requests service decomposition → cycle breaking & bounded-context extraction prioritized");
  } else if (/\b(consolidate|merge\s+databases|simplify\s+stack|single\s+database)\b/i.test(s)) {
    inferredGoal = "consolidate";
    signals.push("Brief requests stack consolidation → duplicate-store retirement prioritized");
  }
  return { signals, inferredCompliance, inferredCapabilities, inferredTenancy, inferredScale, inferredLatency, inferredTargetEngine, inferredGoal };
}

function toWorkloadProfile(req: RedesignRequirements, primaryModel: SchemaModel | null): WorkloadProfile {
  const needs = new Set<Need>();
  if (req.consistency === "strict_acid" || req.compliance.includes("pci")) needs.add("transactions");
  if (req.capabilities.includes("search")) needs.add("full_text");
  if (req.capabilities.includes("analytics")) needs.add("analytics_sql");
  if (req.capabilities.includes("time_series")) needs.add("time_series");
  if (req.capabilities.includes("geo")) needs.add("geo");
  if (req.capabilities.includes("cache")) needs.add("ttl");
  if (req.tenancy === "consumer_global" || req.scale === "hyperscale") needs.add("multi_region");
  if (req.scale !== "startup" || req.compliance.length > 0) needs.add("high_availability");
  if (primaryModel?.entities.some((e) => e.fields.some((f) => /json/i.test(f.type) || f.nested))) needs.add("json");

  const dataShape: WorkloadProfile["dataShape"] =
    req.capabilities.includes("time_series") && !req.capabilities.includes("oltp") ? "time_series"
    : req.capabilities.includes("analytics") && !req.capabilities.includes("oltp") ? "analytics"
    : req.capabilities.includes("search") && !req.capabilities.includes("oltp") ? "search"
    : primaryModel?.engine === "mongodb" && req.consistency !== "strict_acid" ? "document"
    : "relational";

  return {
    ...DEFAULT_PROFILE,
    dataShape,
    consistency: req.consistency === "eventual_ok" ? "eventual" : "strong",
    scale: req.scale === "startup" ? "small" : req.scale === "growth" ? "medium" : req.scale === "scale" ? "large" : "massive",
    writes: req.capabilities.includes("time_series") || req.capabilities.includes("queues") ? "write_heavy" : req.latency === "realtime" ? "read_heavy" : "balanced",
    queries: req.capabilities.includes("analytics") ? "aggregations" : req.capabilities.includes("search") ? "full_text" : "joins",
    schema: primaryModel?.engine === "mongodb" ? "evolving" : "stable",
    latency: req.latency === "realtime" ? "ultra_low" : req.latency === "snappy" ? "low" : "relaxed",
    deployment: req.teamOps === "lean" ? "managed_cloud" : "any",
    needs: [...needs],
  };
}

function cloneModel(m: SchemaModel): SchemaModel {
  return JSON.parse(JSON.stringify(m)) as SchemaModel;
}

const HIGH_GROWTH_RE = /(event|log|audit|order|payment|transaction|message|notification|session|activity|metric|click|job|invoice|ledger|webhook|history)s?$/i;
const SYSTEM_TABLE_RE = /^(schema_migrations|migrations|flyway_|alembic_|feature_flags|countries|currencies|plans)/i;

// ─── Main Redesign Planner ─────────────────────────────────────────
export function planRedesign(
  stores: StoreInput[],
  flows: FlowInput[],
  rawReq: Partial<RedesignRequirements>
): RedesignBlueprint {
  const extracted = extractRequirementSignals(rawReq.productBrief ?? "");
  const req: RedesignRequirements = {
    ...DEFAULT_REQUIREMENTS,
    ...rawReq,
    compliance: [...new Set([...(rawReq.compliance ?? []), ...extracted.inferredCompliance])],
    capabilities: [...new Set([...(rawReq.capabilities ?? DEFAULT_REQUIREMENTS.capabilities), ...extracted.inferredCapabilities])],
    tenancy: rawReq.tenancy && rawReq.tenancy !== "single" ? rawReq.tenancy : extracted.inferredTenancy ?? rawReq.tenancy ?? "single",
    scale: rawReq.scale && rawReq.scale !== "growth" ? rawReq.scale : extracted.inferredScale ?? rawReq.scale ?? "growth",
    latency: rawReq.latency && rawReq.latency !== "snappy" ? rawReq.latency : extracted.inferredLatency ?? rawReq.latency ?? "snappy",
    targetEngine: rawReq.targetEngine && rawReq.targetEngine !== "keep" ? rawReq.targetEngine : extracted.inferredTargetEngine ?? rawReq.targetEngine ?? "keep",
    goal: rawReq.goal && rawReq.goal !== "optimize_current" ? rawReq.goal : extracted.inferredGoal ?? rawReq.goal ?? "optimize_current",
  };

  const arch: ArchitectureReport = analyzeArchitecture(stores, flows);
  const primaryStore = stores.find((s) => s.role === "primary" && s.model)
    ?? stores.find((s) => isRelational(s.engine) && s.model)
    ?? stores.find((s) => s.model)
    ?? null;
  const primaryModel = primaryStore?.model ?? null;
  const currentAnalysis = primaryModel ? analyzeModel(primaryModel) : null;
  const advisor = advise(toWorkloadProfile(req, primaryModel));

  const recommendedPrimaryEngine =
    req.targetEngine === "keep" ? (primaryStore?.engine ?? advisor.ranked[0].id)
    : req.targetEngine === "auto" ? advisor.ranked[0].id
    : req.targetEngine;
  const engineChangeRecommended = Boolean(primaryStore && recommendedPrimaryEngine !== primaryStore.engine);

  const gaps: RedesignGap[] = [];
  const schemaActions: SchemaAction[] = [];
  const supplementaryLines: string[] = [];
  const redisPolicyLines: string[] = [];
  let gapCounter = 1;
  const addGap = (g: Omit<RedesignGap, "id">) => gaps.push({ id: `GAP-${String(gapCounter++).padStart(2, "0")}`, ...g });

  // 1) Engine fit check against requirements
  if (primaryStore) {
    const currentRanked = advisor.ranked.find((r) => r.id === primaryStore.engine);
    const best = advisor.ranked[0];
    if (engineChangeRecommended) {
      addGap({
        area: "engine_fit",
        severity: "medium",
        title: `Primary datastore engine change planned (${engineLabel(primaryStore.engine)} → ${engineLabel(recommendedPrimaryEngine)})`,
        requirement: req.targetEngine === "auto" ? `Best fit for declared workload (${best.label} ${best.score}/100 vs ${currentRanked?.label ?? primaryStore.engine} ${currentRanked?.score ?? "?"}/100)` : `Target engine set to ${engineLabel(recommendedPrimaryEngine)}`,
        currentEvidence: `${primaryStore.name} runs on ${engineLabel(primaryStore.engine)} with ${primaryModel?.entities.length ?? 0} entities.`,
        impact: "Cross-engine migration requires schema conversion, idempotent backfill, CDC/dual-write sync and parity checks.",
        remediation: isTransformable(primaryStore.engine) && isTransformable(recommendedPrimaryEngine)
          ? `Use the generated ${engineLabel(recommendedPrimaryEngine)} schema + ETL runbook below and rehearse against staging.`
          : "Export the redesigned target model as a blueprint and stage a custom CDC pipeline.",
        objects: [primaryStore.name],
      });
    } else if (currentRanked && best.score - currentRanked.score >= 15 && primaryStore.engine !== best.id) {
      addGap({
        area: "engine_fit",
        severity: "low",
        title: `${best.label} scores higher than ${currentRanked.label} for these requirements`,
        requirement: `${req.scale} scale · ${req.latency} latency · ${req.consistency} consistency`,
        currentEvidence: `Advisor heuristic: ${best.label} ${best.score}/100 vs ${currentRanked.label} ${currentRanked.score}/100.`,
        impact: "You can stay on your current primary if you offload specialized workloads (cache/search/analytics) to complementary stores.",
        remediation: `Either switch target engine to ${best.label} to see a migration plan, or keep ${currentRanked.label} and adopt the polyglot stores below.`,
        objects: [primaryStore.name],
      });
    }
  }

  // 2) Cross-store architecture gaps from real ARCH-* findings
  for (const f of arch.findings) {
    if (f.severity === "info") continue;
    addGap({
      area: f.ruleId === "ARCH-006" ? "latency" : "architecture",
      severity: f.severity,
      title: f.title,
      requirement: f.ruleId === "ARCH-006" ? "Predictable cache memory & durability" : "Single source of truth & explicit data ownership",
      currentEvidence: `${f.ruleId} on ${f.object}`,
      impact: f.explanation,
      remediation: f.recommendation,
      objects: [f.object],
    });
  }

  // 3) Build a redesigned clone of the primary model & fix concrete structural issues
  let redesigned: SchemaModel | null = primaryModel ? cloneModel(primaryModel) : null;

  if (redesigned && currentAnalysis) {
    // 3a) Missing primary keys
    const noPk = currentAnalysis.findings.filter((f) => /-CONST-001$/.test(f.ruleId));
    for (const f of noPk) {
      const ent = redesigned.entities.find((e) => e.name === f.object);
      if (!ent) continue;
      addGap({
        area: "integrity",
        severity: "high",
        title: `Missing primary key on ${ent.name}`,
        requirement: "Safe replication, CDC/outbox and deterministic updates",
        currentEvidence: `${f.ruleId}: ${ent.name} has ${ent.fields.length} columns and no PRIMARY KEY.`,
        impact: "Logical replication (Debezium/pgoutput) and idempotent ETL cannot reliably track row changes without a primary key.",
        remediation: `Add a generated UUID/BIGINT primary key to ${ent.name}.`,
        objects: [ent.name],
      });
      const pkName = ent.fields.some((x) => x.name === "id") ? "row_id" : "id";
      const pkType = redesigned.engine === "postgres" ? "uuid" : redesigned.engine === "mysql" ? "bigint" : "integer";
      const pkDefault = redesigned.engine === "postgres" ? "gen_random_uuid()" : null;
      ent.fields.unshift({
        id: fieldId(ent.id, pkName),
        name: pkName,
        type: pkType,
        nullable: false,
        defaultValue: pkDefault,
        isPrimaryKey: true,
        identity: redesigned.engine === "postgres" ? null : "identity",
      });
      ent.constraints.unshift({
        id: constraintId(ent.id, `${ent.shortName}_pkey`),
        name: `${ent.shortName}_pkey`,
        kind: "primary_key",
        columns: [pkName],
      });
      schemaActions.push({
        kind: "fix_pk",
        target: ent.name,
        title: `Add primary key ${pkName} to ${ent.name}`,
        detail: `Enables logical replication, CDC and safe row-level updates.`,
        sqlPreview: `ALTER TABLE ${ent.name} ADD COLUMN ${pkName} ${pkType}${pkDefault ? ` DEFAULT ${pkDefault}` : ""} PRIMARY KEY;`,
      });
    }

    // 3b) Duplicate & invalid indexes
    const dupIdx = currentAnalysis.findings.filter((f) => /-INDEX-001$/.test(f.ruleId));
    for (const f of dupIdx) {
      const ent = redesigned.entities.find((e) => e.name === f.object);
      const pair = f.evidence.indexes as string[] | undefined;
      if (!ent || !pair || pair.length < 2) continue;
      const dropName = pair[1];
      ent.indexes = ent.indexes.filter((ix) => ix.name !== dropName);
      schemaActions.push({
        kind: "drop_dup_index",
        target: `${ent.name}.${dropName}`,
        title: `Drop duplicate index ${dropName} on ${ent.name}`,
        detail: `Duplicates ${pair[0]} on (${(f.evidence.columns as string[] | undefined)?.join(", ") ?? ""}). Eliminates redundant write I/O.`,
        sqlPreview: `DROP INDEX CONCURRENTLY IF EXISTS ${ent.namespace}.${dropName};`,
      });
    }
    for (const f of currentAnalysis.findings.filter((x) => /-INDEX-006$/.test(x.ruleId))) {
      const [schemaTbl, idxName] = [f.object.split(".").slice(0, -1).join("."), f.object.split(".").pop()!];
      const ent = redesigned.entities.find((e) => e.name === schemaTbl);
      if (ent) ent.indexes = ent.indexes.filter((ix) => ix.name !== idxName);
      schemaActions.push({
        kind: "drop_dup_index",
        target: f.object,
        title: `Drop invalid index ${idxName}`,
        detail: "Failed concurrent build slows writes and is never used by queries.",
        sqlPreview: `DROP INDEX CONCURRENTLY IF EXISTS ${ent?.namespace ?? "public"}.${idxName};`,
      });
    }

    // 3c) Float monetary columns (critical under PCI/SOC2)
    for (const f of currentAnalysis.findings.filter((x) => /-TYPE-020$/.test(x.ruleId))) {
      const parts = f.object.split(".");
      const colName = parts.pop()!;
      const tblName = parts.join(".");
      const ent = redesigned.entities.find((e) => e.name === tblName);
      const col = ent?.fields.find((x) => x.name === colName);
      if (!ent || !col) continue;
      const oldType = col.type;
      const exactType = redesigned.engine === "mysql" ? "decimal(14,2)" : "numeric(14,2)";
      col.type = exactType;
      addGap({
        area: req.compliance.includes("pci") ? "compliance" : "integrity",
        severity: req.compliance.includes("pci") ? "high" : "medium",
        title: `Floating-point monetary column ${ent.name}.${colName}`,
        requirement: req.compliance.includes("pci") ? "PCI / financial arithmetic accuracy" : "Exact monetary representation",
        currentEvidence: `${ent.name}.${colName} uses ${oldType} (${f.ruleId}).`,
        impact: "Binary floating point introduces rounding drift in invoices, ledgers and revenue sums.",
        remediation: `Convert ${ent.name}.${colName} from ${oldType} to ${exactType} (or store integer minor units).`,
        objects: [f.object],
      });
      schemaActions.push({
        kind: "fix_type",
        target: f.object,
        title: `Convert ${f.object} from ${oldType} to ${exactType}`,
        detail: "Prevents binary float rounding errors in financial totals.",
        sqlPreview: `ALTER TABLE ${ent.name} ALTER COLUMN ${colName} TYPE ${exactType} USING ROUND(${colName}::numeric, 2);`,
      });
    }

    // 3d) 32-bit SERIAL/INT PK on high-growth tables
    for (const f of currentAnalysis.findings.filter((x) => /-TYPE-004$/.test(x.ruleId))) {
      const parts = f.object.split(".");
      const colName = parts.pop()!;
      const tblName = parts.join(".");
      const ent = redesigned.entities.find((e) => e.name === tblName);
      const col = ent?.fields.find((x) => x.name === colName);
      if (!ent || !col) continue;
      const oldType = col.type;
      col.type = "bigint";
      addGap({
        area: "scale",
        severity: req.scale === "scale" || req.scale === "hyperscale" ? "high" : "medium",
        title: `32-bit primary key overflow risk on ${ent.name}`,
        requirement: `${req.scale} scale longevity`,
        currentEvidence: `${ent.name}.${colName} uses ${oldType} (max ~2.1B rows).`,
        impact: "Sequence exhaustion halts all inserts and requires an online bigint migration.",
        remediation: `Widen ${ent.name}.${colName} to bigint before table size makes rewrites painful.`,
        objects: [f.object],
      });
      schemaActions.push({
        kind: "fix_type",
        target: f.object,
        title: `Widen ${f.object} from ${oldType} to bigint`,
        detail: "Eliminates 2.1B signed 32-bit sequence ceiling.",
      });
    }

    // 3e) Circular schema dependencies
    for (const f of currentAnalysis.findings.filter((x) => /-SCHEMA-001$/.test(x.ruleId))) {
      const [schemaA, schemaB] = f.object.split("⇄").map((x) => x.trim());
      addGap({
        area: "architecture",
        severity: req.goal === "decompose" ? "high" : "medium",
        title: `Circular schema dependency (${f.object})`,
        requirement: req.goal === "decompose" ? "Independent service extraction & clean schema layering" : "Acyclic schema migrations and clean ownership",
        currentEvidence: `${f.ruleId}: ${JSON.stringify(f.evidence)}`,
        impact: "Neither schema can be extracted into its own database or migrated independently while both point at each other.",
        remediation: `Break the back-reference from ${schemaA} → ${schemaB} (keep the FK only on the child/dependent schema, or read the active record via an indexed lookup / view).`,
        objects: [f.object],
      });
      // Actually break the smaller back-edge in the redesigned model
      if (schemaA && schemaB) {
        const aToB = redesigned.entities.filter((e) => e.namespace === schemaA).flatMap((e) => e.constraints.filter((c) => c.kind === "foreign_key" && c.referencedEntity?.startsWith(`${schemaB}.`)).map((c) => ({ e, c })));
        const bToA = redesigned.entities.filter((e) => e.namespace === schemaB).flatMap((e) => e.constraints.filter((c) => c.kind === "foreign_key" && c.referencedEntity?.startsWith(`${schemaA}.`)).map((c) => ({ e, c })));
        const toBreak = aToB.length <= bToA.length ? aToB : bToA;
        for (const { e, c } of toBreak) {
          e.constraints = e.constraints.filter((x) => x.id !== c.id);
          redesigned.relationships = redesigned.relationships.filter((r) => !(r.fromEntity === e.name && r.constraintName === c.name));
          schemaActions.push({
            kind: "break_cycle",
            target: `${e.name}.${c.name}`,
            title: `Break schema cycle by removing back-reference FK ${c.name} on ${e.name}`,
            detail: `Removes ${e.namespace} → ${c.referencedEntity?.split(".")[0]} back-edge so schema ownership is strictly one-way. Replace with a query/view on the owning schema.`,
            sqlPreview: `ALTER TABLE ${e.name} DROP CONSTRAINT IF EXISTS ${c.name};`,
          });
        }
      }
    }

    // 3f) Supporting indexes for unindexed FKs when latency/scale/optimize matters
    if (isRelational(redesigned.engine) && (req.latency !== "standard" || req.scale !== "startup" || req.goal === "optimize_current")) {
      const unindexedFks = currentAnalysis.findings.filter((x) => /-INDEX-003$/.test(x.ruleId)).slice(0, 12);
      for (const f of unindexedFks) {
        const [tbl, colList] = [f.object.split(".").slice(0, -1).join("."), f.object.split(".").pop() ?? ""];
        const cols = colList.split(",").map((x) => x.trim()).filter(Boolean);
        const ent = redesigned.entities.find((e) => e.name === tbl);
        if (!ent || !cols.length) continue;
        const idxName = `idx_${ent.shortName}_${cols.join("_")}`;
        if (ent.indexes.some((ix) => ix.name === idxName)) continue;
        ent.indexes.push({
          id: indexId(ent.id, idxName),
          name: idxName,
          columns: cols,
          method: "btree",
          unique: false,
        });
        schemaActions.push({
          kind: "add_fk_index",
          target: `${ent.name}(${cols.join(", ")})`,
          title: `Add supporting FK index ${idxName}`,
          detail: "Prevents sequential scans on parent deletes/updates and child joins.",
          sqlPreview: `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${idxName} ON ${ent.name} (${cols.join(", ")});`,
        });
      }
    }

    // 3g) Multi-tenancy redesign (B2B shared RLS or isolated)
    if (req.tenancy === "b2b_shared" || req.goal === "multi_tenant") {
      const domainTables = redesigned.entities.filter((e) => e.kind === "table" && !SYSTEM_TABLE_RE.test(e.shortName));
      const lackingTenant = domainTables.filter((e) => !e.fields.some((f) => /^(tenant_id|org_id|organization_id|workspace_id|account_id)$/i.test(f.name)));
      if (lackingTenant.length) {
        addGap({
          area: "tenancy",
          severity: "high",
          title: `${lackingTenant.length} of ${domainTables.length} tables lack an explicit tenant identifier`,
          requirement: req.tenancy === "b2b_isolated" ? "Strict B2B tenant isolation" : "B2B shared multi-tenancy with Row-Level Security (RLS)",
          currentEvidence: `Missing tenant_id / org_id on: ${lackingTenant.slice(0, 6).map((e) => e.name).join(", ")}${lackingTenant.length > 6 ? "…" : ""}.`,
          impact: "Without a mandatory tenant column and RLS enforcement, a missing WHERE clause leaks cross-tenant data.",
          remediation: "Add tenant_id uuid NOT NULL to every tenant-owned table, lead composite indexes with tenant_id, and enable PostgreSQL Row-Level Security policies.",
          objects: lackingTenant.slice(0, 8).map((e) => e.name),
        });
        supplementaryLines.push("-- ── Multi-Tenant Row-Level Security (RLS) Policy Template ──");
        for (const ent of lackingTenant) {
          ent.fields.push({ id: fieldId(ent.id, "tenant_id"), name: "tenant_id", type: redesigned.engine === "postgres" ? "uuid" : "char(36)", nullable: false, comment: "Tenant isolation key" });
          const idxName = `idx_${ent.shortName}_tenant_id`;
          ent.indexes.push({ id: indexId(ent.id, idxName), name: idxName, columns: ["tenant_id"], method: "btree", unique: false });
          if (redesigned.engine === "postgres") {
            supplementaryLines.push(
              `ALTER TABLE ${ent.name} ENABLE ROW LEVEL SECURITY;`,
              `ALTER TABLE ${ent.name} FORCE ROW LEVEL SECURITY;`,
              `CREATE POLICY ${ent.shortName}_tenant_isolation ON ${ent.name} USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);`
            );
          }
        }
        supplementaryLines.push("");
        schemaActions.push({
          kind: "add_tenant_rls",
          target: `${lackingTenant.length} table(s)`,
          title: `Add tenant_id + index + RLS policies across ${lackingTenant.length} domain tables`,
          detail: "Enforces tenant isolation in the database engine itself, not only in application queries.",
        });
      }
    }

    // 3h) High-scale partitioning for append-only / transactional tables
    if (req.scale === "scale" || req.scale === "hyperscale" || req.goal === "scale_out") {
      const partitionCandidates = redesigned.entities.filter(
        (e) => e.kind === "table" && !e.metadata?.partitioned && HIGH_GROWTH_RE.test(e.shortName) && e.fields.some((f) => /created_at|occurred_at|changed_at|placed_at|issued_at|ts$/i.test(f.name))
      );
      if (partitionCandidates.length) {
        addGap({
          area: "scale",
          severity: "medium",
          title: `${partitionCandidates.length} high-growth table(s) are not partitioned`,
          requirement: `${req.scale} scale (100M+ rows & fast retention pruning)`,
          currentEvidence: `Unpartitioned growth tables: ${partitionCandidates.map((e) => e.name).join(", ")}.`,
          impact: "Unpartitioned event/order/audit tables bloat B-tree indexes and make retention DELETEs cause severe vacuum pressure.",
          remediation: "Adopt monthly declarative RANGE partitioning on the timestamp column so old data is pruned via instant DROP TABLE.",
          objects: partitionCandidates.map((e) => e.name),
        });
        supplementaryLines.push("-- ── Declarative Time-Range Partitioning Plan (PostgreSQL) ──");
        for (const ent of partitionCandidates) {
          const tsCol = ent.fields.find((f) => /created_at|occurred_at|changed_at|placed_at|issued_at|ts$/i.test(f.name))!.name;
          ent.metadata = { ...ent.metadata, partitioned: true, partitionBy: `PARTITION BY RANGE (${tsCol})` };
          supplementaryLines.push(
            `-- Range-partition ${ent.name} by ${tsCol} (note: PK/UNIQUE must include ${tsCol})`,
            `CREATE TABLE ${ent.name}_2026_01 PARTITION OF ${ent.name} FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');`,
            `CREATE TABLE ${ent.name}_2026_02 PARTITION OF ${ent.name} FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');`
          );
          schemaActions.push({
            kind: "partition_table",
            target: ent.name,
            title: `Range-partition ${ent.name} by ${tsCol}`,
            detail: "Keeps hot B-tree indexes in RAM and turns retention deletes into O(1) partition drops.",
          });
        }
        supplementaryLines.push("");
      }
    }

    // 3i) Compliance checks (GDPR / HIPAA / SOC2)
    if (req.compliance.includes("gdpr")) {
      const piiTables = redesigned.entities.filter((e) => e.fields.some((f) => /email|phone|address|ip|birth|name/i.test(f.name)));
      const hasAudit = redesigned.entities.some((e) => /audit|change_log/i.test(e.name));
      addGap({
        area: "compliance",
        severity: "medium",
        title: `GDPR erasure & PII lineage across ${piiTables.length} table(s)`,
        requirement: "GDPR Right to Erasure & data locality",
        currentEvidence: `PII-like fields appear in: ${piiTables.slice(0, 6).map((e) => e.name).join(", ")}${arch.stores.length > 1 ? ` plus secondary stores (${arch.stores.filter((s) => s.id !== primaryStore?.id).map((s) => s.name).join(", ")})` : ""}.`,
        impact: "Deleting a user in the primary store will not automatically erase copies in MongoDB, Redis caches, or analytics tables.",
        remediation: `Emit a UserErased event via transactional outbox to purge PII in every downstream store${hasAudit ? "; crypto-shred or pseudonymize user identifiers inside audit logs" : ""}.`,
        objects: piiTables.slice(0, 6).map((e) => e.name),
      });
    }
    if (req.compliance.includes("soc2") || req.compliance.includes("hipaa")) {
      const hasAudit = redesigned.entities.some((e) => /audit|change_log|event/i.test(e.name));
      if (!hasAudit) {
        addGap({
          area: "compliance",
          severity: "medium",
          title: "No immutable audit log table detected",
          requirement: `${req.compliance.filter((c) => c === "soc2" || c === "hipaa").join("/").toUpperCase()} access & mutation auditability`,
          currentEvidence: "None of the scanned entities looks like an append-only audit log.",
          impact: "Compliance audits require tamper-evident records of who changed sensitive records and when.",
          remediation: "Create a dedicated audit.change_log table (with BIGINT/UUID PK, actor_id, action, object, changed_at) and revoke UPDATE/DELETE on it for the app role.",
          objects: [redesigned.database],
        });
      }
    }
  }

  // 4) Redis TTL & eviction remediation script if a Redis store exists
  for (const s of stores.filter((x) => x.engine === "redis" && x.model)) {
    const persistent = s.model!.entities.filter((e) => {
      const ttl = e.metadata?.ttl as { known?: number; with?: number } | undefined;
      return e.kind === "keyspace" && ttl && (ttl.known ?? 0) > 0 && (ttl.with ?? 0) === 0;
    });
    if (persistent.length) {
      redisPolicyLines.push(`# Redis keyspace & eviction policy fixes for ${s.name}`);
      if (s.model!.catalog?.settings?.maxmemoryPolicy === "noeviction" && (s.role === "cache" || s.role === "session")) {
        redisPolicyLines.push(`# Switch cache instance from noeviction to volatile-lru so cache misses never OOM the app`, `CONFIG SET maxmemory-policy volatile-lru`, ``);
      }
      for (const e of persistent) {
        const isQueue = /queue|jobs?|stream/i.test(e.shortName);
        if (isQueue) {
          redisPolicyLines.push(`# Cap unbounded queue ${e.shortName} (switch to Redis Streams with MAXLEN ~ 10000 or dedicated broker)`, `# XADD ${e.shortName} MAXLEN ~ 10000 * payload ...`);
        } else {
          const suggestedTtl = /otp|token|rate|lock/i.test(e.shortName) ? 300 : /cart|session/i.test(e.shortName) ? 86400 : 3600;
          redisPolicyLines.push(`# Enforce TTL (${suggestedTtl}s) on ${e.shortName} at write time (SET ... EX ${suggestedTtl} / EXPIRE)`);
        }
        schemaActions.push({
          kind: "redis_ttl",
          target: `${s.name} · ${e.shortName}`,
          title: isQueue ? `Bound queue ${e.shortName} or move to durable broker` : `Enforce TTL on ${e.shortName}`,
          detail: isQueue ? "Prevents memory exhaustion when consumers stall." : "Prevents unbounded memory growth on cache/ephemeral store.",
        });
      }
    }
  }

  // 5) Engine conversion if requested & supported
  let transformPlan: TransformPlan | null = null;
  if (redesigned && engineChangeRecommended && isTransformable(redesigned.engine) && isTransformable(recommendedPrimaryEngine)) {
    try {
      transformPlan = planTransform(redesigned, recommendedPrimaryEngine as Engine);
      redesigned = transformPlan.targetModel;
      schemaActions.push({
        kind: "engine_convert",
        target: `${primaryStore!.name} → ${engineLabel(recommendedPrimaryEngine)}`,
        title: `Convert schema from ${engineLabel(primaryStore!.engine)} to ${engineLabel(recommendedPrimaryEngine)}`,
        detail: `${transformPlan.stats.targetEntities} target entities · ${transformPlan.stats.fieldsMapped} fields mapped (${transformPlan.stats.lossy} lossy conversions flagged).`,
      });
    } catch {
      transformPlan = null;
    }
  }

  // 6) Compute Target System Architecture (stores + flows)
  const targetStores: TargetStoreDesign[] = [];
  const targetFlows: TargetFlowDesign[] = flows.map((f) => ({
    from: stores.find((s) => s.id === f.fromStoreId)?.name ?? f.fromStoreId,
    to: stores.find((s) => s.id === f.toStoreId)?.name ?? f.toStoreId,
    kind: f.kind,
    rationale: f.description ?? "Existing declared data flow",
    isNew: false,
  }));

  const primaryName = primaryStore?.name ?? `${recommendedPrimaryEngine}-core`;
  for (const s of stores) {
    const isPrimary = s.id === primaryStore?.id;
    const nsList = (s.model?.namespaces ?? []).filter(Boolean);
    const entList = (s.model?.entities ?? []).map((e) => e.name).slice(0, 12);
    if (isPrimary) {
      targetStores.push({
        name: s.name,
        engine: recommendedPrimaryEngine,
        role: "primary",
        status: engineChangeRecommended ? "migrate_to" : schemaActions.length ? "upgrade" : "keep",
        rationale: engineChangeRecommended
          ? `Migrated system of record on ${engineLabel(recommendedPrimaryEngine)} with cleaned structural integrity.`
          : `Hardened system of record (${nsList.length} schema${nsList.length === 1 ? "" : "s"}, ${schemaActions.length} targeted improvement${schemaActions.length === 1 ? "" : "s"}).`,
        schemas: nsList,
        entities: entList,
        keyPolicies: [
          req.tenancy === "b2b_shared" ? "Row-Level Security (tenant_id) enforced" : "Schema-qualified ownership",
          req.scale === "scale" || req.scale === "hyperscale" ? "Time-range partitioning + PgBouncer pooling" : "Online DDL (CONCURRENTLY / NOT VALID)",
        ],
      });
    } else if (req.goal === "consolidate" && s.role === "service" && arch.links.some((l) => l.kind === "duplicate" && (l.fromStoreId === s.id || l.toStoreId === s.id))) {
      targetStores.push({
        name: s.name,
        engine: s.engine,
        role: s.role as StoreRole,
        status: "retire",
        rationale: `Consolidate overlapping entities into ${primaryName} (JSONB/dedicated schema) to eliminate dual-store drift.`,
        schemas: nsList,
        entities: entList,
        keyPolicies: ["Migrate unique collections into primary store, then decommission"],
      });
    } else {
      targetStores.push({
        name: s.name,
        engine: s.engine,
        role: s.role as StoreRole,
        status: s.engine === "redis" && redisPolicyLines.length ? "upgrade" : "keep",
        rationale: s.engine === "redis" ? "Ephemeral cache & session tier with mandatory TTLs and volatile-lru eviction." : `Retained ${s.role} store synced via explicit event/CDC contract.`,
        schemas: nsList,
        entities: entList,
        keyPolicies: s.engine === "redis" ? ["TTL required on all cache/session keys", "volatile-lru eviction"] : ["Read/write ownership contract documented"],
      });
    }
  }
  if (!stores.length) {
    targetStores.push({
      name: primaryName,
      engine: recommendedPrimaryEngine,
      role: "primary",
      status: "new",
      rationale: `Recommended primary system of record (${advisor.ranked[0].label}, ${advisor.ranked[0].score}/100 fit).`,
      schemas: ["auth", "core", "billing", "audit"],
      entities: [],
      keyPolicies: ["Multi-schema separation by bounded context", "Strict primary & foreign keys"],
    });
  }

  // Declare CDC flows to fix any ARCH-001 undeclared duplicates
  for (const l of arch.links.filter((x) => x.kind === "duplicate")) {
    const a = stores.find((s) => s.id === l.fromStoreId);
    const b = stores.find((s) => s.id === l.toStoreId);
    if (!a || !b) continue;
    const from = a.role === "primary" ? a.name : b.name;
    const to = a.role === "primary" ? b.name : a.name;
    if (req.goal === "consolidate") continue;
    if (!targetFlows.some((f) => (f.from === from && f.to === to) || (f.from === to && f.to === from))) {
      targetFlows.push({
        from,
        to,
        kind: "cdc",
        rationale: `Resolves ARCH-001: stream authoritative changes for "${l.toEntity}" via transactional outbox / Debezium CDC so copies never silently diverge.`,
        isNew: true,
      });
    }
  }

  // Add recommended complementary stores based on requirements & gaps
  const hasEngine = (eng: string) => targetStores.some((s) => s.engine === eng && s.status !== "retire");
  const hasRole = (role: StoreRole) => targetStores.some((s) => s.role === role && s.status !== "retire");

  if ((req.latency === "realtime" || req.capabilities.includes("cache")) && !hasEngine("redis")) {
    targetStores.push({ name: "edge-cache", engine: "redis", role: "cache", status: "new", rationale: "Sub-5ms read cache, sessions and rate limiting with strict TTLs.", schemas: ["db0"], entities: ["session:{session_id}", "cache:{entity}:{id}"], keyPolicies: ["Mandatory TTL on every key", "volatile-lru eviction"] });
    targetFlows.push({ from: primaryName, to: "edge-cache", kind: "cache_aside", rationale: "Cache hot lookups on read miss and invalidate on primary write.", isNew: true });
  }
  if ((req.capabilities.includes("analytics") || req.capabilities.includes("time_series")) && (req.scale === "scale" || req.scale === "hyperscale" || req.goal === "scale_out") && !hasRole("analytics")) {
    targetStores.push({ name: "analytics-olap", engine: "clickhouse", role: "analytics", status: "new", rationale: "Columnar OLAP store to isolate heavy dashboards & event aggregations from OLTP traffic.", schemas: ["analytics"], entities: ["events", "daily_revenue"], keyPolicies: ["Partitioned by month", "TTL-based cold retention"] });
    targetFlows.push({ from: primaryName, to: "analytics-olap", kind: "cdc", rationale: "Stream append-only events and order facts via CDC/Kafka without impacting OLTP reads.", isNew: true });
  }
  if (req.capabilities.includes("search") && !hasRole("search")) {
    targetStores.push({ name: "search-index", engine: "elasticsearch", role: "search", status: "new", rationale: "Dedicated inverted index for relevance ranking, typo tolerance and faceted search.", schemas: ["catalog"], entities: ["products_idx"], keyPolicies: ["Rebuildable from system of record", "Async outbox indexing"] });
    targetFlows.push({ from: primaryName, to: "search-index", kind: "cdc", rationale: "Index catalog/content updates asynchronously from the system of record.", isNew: true });
  }
  if ((req.scale === "scale" || req.scale === "hyperscale") && req.latency !== "standard" && !hasRole("replica") && isRelational(recommendedPrimaryEngine)) {
    targetStores.push({ name: `${primaryName}-replica`, engine: recommendedPrimaryEngine, role: "replica", status: "new", rationale: "Offload read-heavy queries and reporting traffic from the primary writer.", schemas: primaryModel?.namespaces ?? ["public"], entities: [], keyPolicies: ["Streaming replication", "Monitor replication lag < 250ms"] });
    targetFlows.push({ from: primaryName, to: `${primaryName}-replica`, kind: "replication", rationale: "Engine-native streaming replication for read scaling & failover readiness.", isNew: true });
  }

  // 7) Verify Redesigned Model Deterministically (REAL before/after score!)
  const afterAnalysis = redesigned ? analyzeModel(redesigned) : null;
  const beforeFindingKeys = new Set((currentAnalysis?.findings ?? []).map((f) => `${f.ruleId}|${f.object}`));
  const afterFindingKeys = new Set((afterAnalysis?.findings ?? []).map((f) => `${f.ruleId}|${f.object}`));
  const resolvedCount = [...beforeFindingKeys].filter((k) => !afterFindingKeys.has(k)).length;

  // Compute projected architecture score realistically
  const archResolvedPenalty =
    (targetFlows.some((f) => f.isNew && f.kind === "cdc") ? arch.findings.filter((f) => f.ruleId === "ARCH-001").length * 9 : 0) +
    (redisPolicyLines.length ? arch.findings.filter((f) => f.ruleId === "ARCH-006").length * 9 : 0) +
    (targetStores.some((s) => s.role === "primary") ? arch.findings.filter((f) => f.ruleId === "ARCH-005").length * 5 : 0);
  const projectedArchScore = stores.length ? Math.min(100, arch.score + archResolvedPenalty) : 95;

  // 8) Generate DDL & Migration Artifacts
  let targetDdl = "";
  let migrationUp = "";
  let migrationDown = "";
  let migrationValidation: { ok: boolean; checks: string[] } | null = null;
  if (transformPlan) {
    targetDdl = transformPlan.ddl;
    migrationUp = transformPlan.ddl;
  } else if (redesigned && primaryModel && isRelational(redesigned.engine)) {
    targetDdl = generateDdl(redesigned, redesigned.engine as SqlDialect);
    const diff = diffModels(primaryModel, redesigned);
    const mig = generateMigration(redesigned.engine, diff, primaryModel, redesigned);
    migrationUp = mig.up;
    migrationDown = mig.down;
    migrationValidation = validateMigration(mig.up, redesigned.engine);
  }

  // 9) Phased Cutover Plan
  const cutoverPhases: CutoverPhase[] = buildCutoverPlan(req, primaryStore?.engine ?? null, recommendedPrimaryEngine, targetStores, targetFlows, engineChangeRecommended);

  const curScore = currentAnalysis?.summary.designScore ?? null;
  const projScore = afterAnalysis?.summary.designScore ?? null;
  const headline = engineChangeRecommended
    ? `Migrate ${primaryStore!.name} from ${engineLabel(primaryStore!.engine)} to ${engineLabel(recommendedPrimaryEngine)}${targetStores.some((s) => s.status === "new") ? " + add complementary stores" : ""}`
    : targetStores.some((s) => s.status === "new")
      ? `Keep ${engineLabel(recommendedPrimaryEngine)} as core, harden ${schemaActions.length} schema item(s) & add ${targetStores.filter((s) => s.status === "new").length} specialized store(s)`
      : `Harden ${primaryStore?.name ?? engineLabel(recommendedPrimaryEngine)} in place (${schemaActions.length} concrete schema improvements)`;

  return {
    generatedAt: new Date().toISOString(),
    requirements: req,
    detectedSignals: extracted.signals,
    verdict: {
      headline,
      summary: `Evaluated ${stores.length} datastore(s) against ${req.scale} scale, ${req.latency} latency, ${req.tenancy.replace("_", " ")} tenancy and ${req.consistency.replace("_", " ")} consistency. Found ${gaps.length} requirement gap(s) and synthesized ${schemaActions.length} deterministic schema fix(es).`,
      recommendedPrimaryEngine,
      currentPrimaryEngine: primaryStore?.engine ?? null,
      engineChangeRecommended,
      currentDesignScore: curScore,
      projectedDesignScore: projScore,
      currentArchitectureScore: arch.score,
      projectedArchitectureScore: projectedArchScore,
      findingsResolvedCount: resolvedCount,
      findingsRemainingCount: afterAnalysis?.findings.length ?? 0,
    },
    advisor,
    gaps: gaps.sort((a, b) => sevRank(a.severity) - sevRank(b.severity)),
    targetStores,
    targetFlows,
    schemaActions,
    targetModel: redesigned,
    artifacts: {
      targetDdl,
      migrationUp,
      migrationDown,
      migrationValidation,
      supplementarySql: supplementaryLines.join("\n"),
      redisPolicyScript: redisPolicyLines.join("\n"),
      etlScript: transformPlan?.etlScript ?? null,
      transformSummary: transformPlan
        ? {
            sourceEngine: transformPlan.sourceEngine,
            targetEngine: transformPlan.targetEngine,
            fieldsMapped: transformPlan.stats.fieldsMapped,
            lossy: transformPlan.stats.lossy,
            embedded: transformPlan.stats.embedded,
            warnings: transformPlan.warnings,
            risks: transformPlan.risks,
          }
        : null,
    },
    cutoverPhases,
    tradeoffs: [
      ...(targetStores.filter((s) => s.status === "new").length > 0 ? [`Adding ${targetStores.filter((s) => s.status === "new").length} new datastore(s) increases operational surface (backups, monitoring, lag alerts).${req.teamOps === "lean" ? " Use managed cloud services to keep SRE overhead low." : ""}`] : []),
      ...(req.tenancy === "b2b_shared" ? ["Shared-schema RLS requires every connection pool transaction to set app.current_tenant_id (use SET LOCAL inside a transaction with PgBouncer transaction pooling)."] : []),
      ...(engineChangeRecommended ? ["Cross-engine migrations introduce a temporary dual-run period where both databases operate in parallel until parity and rollback criteria are satisfied."] : []),
      "All schema scores and recommendations are deterministic heuristics — validate index and partitioning choices against production query plans (EXPLAIN ANALYZE).",
    ],
    limitations: [
      "Redesign blueprints are generated deterministically from schema metadata + declared requirements; runtime query latency and traffic skew were not measured.",
      "Review every generated DDL, RLS policy and migration script in staging before touching production.",
    ],
  };
}

function sevRank(s: Severity): number {
  return { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[s];
}

function buildCutoverPlan(
  req: RedesignRequirements,
  srcEngine: string | null,
  dstEngine: string,
  targetStores: TargetStoreDesign[],
  targetFlows: TargetFlowDesign[],
  engineChange: boolean
): CutoverPhase[] {
  const newStores = targetStores.filter((s) => s.status === "new");
  const newFlows = targetFlows.filter((f) => f.isNew);
  return [
    {
      phase: 1,
      title: "Baseline, Backups & Structural Hygiene",
      durationHint: "Days 1–3",
      downtimeRisk: "none",
      steps: [
        "Take verified snapshots of every datastore and rehearse a restore into staging.",
        "Apply non-blocking structural fixes first: add missing primary keys, drop duplicate/invalid indexes (CONCURRENTLY) and enforce Redis TTLs.",
        "Enable query telemetry (pg_stat_statements / slow query log) to establish baseline P95 latency.",
      ],
      gate: "All critical/high structural findings resolved in staging; baseline row counts and P95 metrics recorded.",
      rollback: "Revert additive indexes/policies independently; no destructive changes occur in Phase 1.",
    },
    {
      phase: 2,
      title: engineChange ? `Provision ${engineLabel(dstEngine)} & Backfill` : "Expand Schema & Stand Up Complementary Stores",
      durationHint: "Days 4–10",
      downtimeRisk: "none",
      steps: [
        ...(engineChange
          ? [
              `Provision target ${engineLabel(dstEngine)} cluster and apply Phase 1 target schema DDL.`,
              `Run the generated idempotent ETL script in DRY_RUN=1 mode first, then backfill in throttled batches.`,
              `Enable CDC (${srcEngine === "postgres" ? "pgoutput/Debezium" : srcEngine === "mysql" ? "binlog/Debezium" : "change streams"}) from the backfill LSN/timestamp.`,
            ]
          : [
              ...(req.tenancy === "b2b_shared" ? ["Add nullable tenant_id columns, backfill in 2,000-row batches, add NOT VALID constraints, then validate and enable RLS."] : ["Apply additive schema changes (new columns, partitioned tables, supporting FK indexes CONCURRENTLY)."]),
              ...(newStores.length ? [`Provision ${newStores.map((s) => `${s.name} (${s.engine})`).join(", ")} and wire ${newFlows.map((f) => `${f.from}→${f.to} (${f.kind})`).join(", ")}.`] : []),
            ]),
      ],
      gate: "Row/document counts match within 0% tolerance; replication/CDC lag stays under 1 second under production write load.",
      rollback: "Stop CDC/backfill workers and drop unused target tables or new stores with zero production impact.",
    },
    {
      phase: 3,
      title: "Shadow Reads & Parity Verification",
      durationHint: "Days 11–14",
      downtimeRisk: "none",
      steps: [
        "Route read-only shadow traffic (or 5% canary reads) to the redesigned tables / new engine behind a feature flag.",
        "Compare query results, orphan counts and P99 latency against the existing path.",
        ...(req.compliance.length ? [`Verify ${req.compliance.map((c) => c.toUpperCase()).join(" / ")} controls (RLS isolation tests, audit log immutability, PII erasure test).`] : []),
      ],
      gate: "Zero parity diffs across 48h of representative traffic; error rate and latency within SLO.",
      rollback: "Disable shadow/canary feature flag immediately.",
    },
    {
      phase: 4,
      title: "Cutover & Safe Contraction",
      durationHint: "Days 15–21",
      downtimeRisk: engineChange ? "brief_window" : "low",
      steps: [
        engineChange
          ? "Pause writes briefly (<30s), drain final CDC events, verify sequence offsets, and flip writes to the new primary."
          : "Switch application reads and writes to the redesigned tables / flows via feature flag.",
        "Keep the previous structure read-only for an agreed rollback window (7–14 days).",
        "After the rollback window closes, drop retired columns/tables/stores and archive final backups.",
      ],
      gate: "7+ days of stable production operation with clean metrics and backups before any destructive DROP.",
      rollback: engineChange ? "Flip feature flag back to source and replay target writes captured in reverse-CDC/outbox." : "Flip feature flag back to legacy columns/tables before contraction runs.",
    },
  ];
}
