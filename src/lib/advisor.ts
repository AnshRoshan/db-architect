import type { SchemaModel } from "./schema-model";
import { isRelational } from "./engines";

// Database Selection Advisor — a transparent, explainable scoring model.
// It is a heuristic over declared requirements, NOT a benchmark.

export type Cap =
  | "relational" | "document" | "keyValue" | "timeSeries" | "search" | "analytics" | "graph" | "acid"
  | "scaleOut" | "readSpeed" | "writeSpeed" | "flexSchema" | "joins" | "simpleOps" | "embedded"
  | "geo" | "multiRegion" | "ha" | "jsonSupport" | "ttl" | "serverless";

export const CAP_LABEL: Record<Cap, string> = {
  relational: "relational modelling", document: "document modelling", keyValue: "key-value access", timeSeries: "time-series data",
  search: "full-text search", analytics: "analytical queries", graph: "graph traversal", acid: "ACID transactions",
  scaleOut: "horizontal scale-out", readSpeed: "read latency", writeSpeed: "write throughput", flexSchema: "schema flexibility",
  joins: "ad-hoc joins", simpleOps: "operational simplicity", embedded: "embedded / in-process use", geo: "geospatial queries",
  multiRegion: "multi-region replication", ha: "high availability", jsonSupport: "JSON handling", ttl: "automatic expiry (TTL)", serverless: "serverless / elastic operation",
};

export interface WorkloadProfile {
  dataShape: "relational" | "document" | "key_value" | "time_series" | "search" | "analytics" | "graph" | "mixed";
  consistency: "strong" | "eventual";
  scale: "small" | "medium" | "large" | "massive";
  writes: "read_heavy" | "balanced" | "write_heavy";
  queries: "key_lookup" | "joins" | "aggregations" | "full_text" | "mixed";
  schema: "stable" | "evolving";
  deployment: "embedded" | "managed_cloud" | "self_hosted" | "any";
  latency: "relaxed" | "low" | "ultra_low";
  stack: "any" | "microsoft" | "aws" | "open_source_only";
  needs: Need[];
}
export type Need = "transactions" | "json" | "geo" | "full_text" | "multi_region" | "offline" | "high_availability" | "analytics_sql" | "time_series" | "graph_traversal" | "ttl" | "serverless";

export const DEFAULT_PROFILE: WorkloadProfile = { dataShape: "relational", consistency: "strong", scale: "medium", writes: "balanced", queries: "mixed", schema: "stable", deployment: "any", latency: "low", stack: "any", needs: [] };

export type ToolSupport = "full" | "import" | "planned" | "advisor";
interface Candidate {
  id: string; label: string; tagline: string; family: string; openSource: "yes" | "source-available" | "no"; toolSupport: ToolSupport;
  bestFor: string[]; avoidWhen: string[]; watch: string[]; caps: Record<Cap, number>;
}
const c = (v: number[]): Record<Cap, number> => {
  const keys: Cap[] = ["relational", "document", "keyValue", "timeSeries", "search", "analytics", "graph", "acid", "scaleOut", "readSpeed", "writeSpeed", "flexSchema", "joins", "simpleOps", "embedded", "geo", "multiRegion", "ha", "jsonSupport", "ttl", "serverless"];
  return Object.fromEntries(keys.map((k, i) => [k, v[i]])) as Record<Cap, number>;
};
//                         rel doc kv  ts  srch ana grph acid scl rd  wr  flex join ops emb geo mreg ha  json ttl srvl
export const CANDIDATES: Candidate[] = [
  { id: "postgres", label: "PostgreSQL", tagline: "The safe default: relational integrity with JSONB, geo and extensions", family: "relational", openSource: "yes", toolSupport: "full",
    bestFor: ["Transactional systems of record", "Mixed relational + JSON data", "Geospatial (PostGIS) and rich SQL"], avoidWhen: ["You need effortless multi-region writes", "Petabyte-scale event ingestion"], watch: ["Vertical scaling first — plan read replicas/partitioning early", "Connection pooling (PgBouncer) at high concurrency"],
    caps: c([5, 3, 2, 3, 3, 3, 2, 5, 2, 4, 4, 3, 5, 3, 0, 5, 2, 4, 5, 1, 3]) },
  { id: "mysql", label: "MySQL", tagline: "Ubiquitous, fast web-scale relational workhorse", family: "relational", openSource: "yes", toolSupport: "full",
    bestFor: ["Read-heavy web applications", "Teams with deep MySQL tooling", "Simple OLTP at scale with replicas"], avoidWhen: ["You need advanced SQL features or rich types", "Heavy analytical queries on the same instance"], watch: ["DDL is not transactional", "Use utf8mb4 and InnoDB everywhere"],
    caps: c([5, 2, 2, 2, 2, 2, 1, 5, 3, 4, 4, 2, 4, 4, 0, 3, 2, 4, 3, 1, 3]) },
  { id: "sqlite", label: "SQLite", tagline: "Zero-ops embedded database in a single file", family: "relational", openSource: "yes", toolSupport: "import",
    bestFor: ["Mobile/desktop/edge apps", "Local-first and offline use", "Small sites, tests and prototypes"], avoidWhen: ["Many concurrent writers", "Multi-server access to one dataset"], watch: ["Single writer at a time", "Foreign keys off unless PRAGMA foreign_keys=ON"],
    caps: c([4, 1, 2, 1, 2, 2, 1, 5, 0, 5, 2, 2, 4, 5, 5, 1, 0, 0, 3, 0, 2]) },
  { id: "sqlserver", label: "SQL Server", tagline: "Enterprise relational platform with first-class BI tooling", family: "relational", openSource: "no", toolSupport: "planned",
    bestFor: [".NET / Microsoft-centric stacks", "Enterprise reporting and BI", "Strict HA/DR requirements (Always On)"], avoidWhen: ["Licence cost or Linux-first tooling matters", "You need open-source-only components"], watch: ["Licensing is core-based and complex", "Edition features differ materially"],
    caps: c([5, 2, 1, 2, 3, 4, 2, 5, 2, 4, 4, 2, 5, 3, 0, 3, 3, 5, 3, 0, 2]) },
  { id: "mongodb", label: "MongoDB", tagline: "Flexible documents with built-in horizontal scaling", family: "document", openSource: "source-available", toolSupport: "full",
    bestFor: ["Evolving, nested document data", "Content, catalogs and user profiles", "Horizontal scale via sharding"], avoidWhen: ["Heavily relational data with many-to-many joins", "Multi-collection transactions are the norm"], watch: ["Schema discipline moves into the application (use $jsonSchema)", "Unbounded arrays and 16 MB document limit", "Check current licence terms (SSPL)"],
    caps: c([1, 5, 3, 3, 3, 3, 2, 3, 5, 4, 4, 5, 2, 3, 0, 4, 4, 5, 5, 4, 4]) },
  { id: "redis", label: "Redis", tagline: "In-memory data structures for sub-millisecond access", family: "key-value", openSource: "source-available", toolSupport: "planned",
    bestFor: ["Caching and sessions", "Rate limiting, queues, leaderboards", "Ephemeral data with TTL"], avoidWhen: ["It must be the durable system of record", "Dataset far exceeds memory budget"], watch: ["Persistence is a trade-off (RDB/AOF)", "Check current licence terms"],
    caps: c([0, 2, 5, 3, 2, 1, 1, 2, 3, 5, 5, 4, 0, 3, 1, 3, 2, 3, 3, 5, 3]) },
  { id: "dynamodb", label: "DynamoDB", tagline: "Fully managed, serverless key-value/document store on AWS", family: "key-value", openSource: "no", toolSupport: "advisor",
    bestFor: ["Known access patterns at any scale", "Serverless AWS architectures", "Global tables / multi-region"], avoidWhen: ["Ad-hoc queries and joins", "You cannot enumerate access patterns up front"], watch: ["Single-table design needs upfront modelling", "Costs depend on access pattern, not just size", "AWS lock-in"],
    caps: c([0, 3, 5, 3, 1, 1, 0, 3, 5, 5, 5, 4, 0, 5, 0, 1, 5, 5, 3, 5, 5]) },
  { id: "elasticsearch", label: "Elasticsearch / OpenSearch", tagline: "Distributed search and log analytics engine", family: "search", openSource: "source-available", toolSupport: "advisor",
    bestFor: ["Full-text search and relevance ranking", "Log and observability analytics", "Faceted product search"], avoidWhen: ["It would be the only source of truth", "You need multi-document transactions"], watch: ["Near-real-time, not transactional", "Operationally heavier than a managed SQL database"],
    caps: c([0, 4, 1, 4, 5, 4, 1, 1, 4, 4, 3, 4, 1, 2, 0, 4, 3, 4, 5, 3, 3]) },
  { id: "clickhouse", label: "ClickHouse", tagline: "Columnar OLAP engine for fast analytics at scale", family: "analytics", openSource: "yes", toolSupport: "advisor",
    bestFor: ["Event/clickstream analytics", "Time-series and metrics at scale", "Dashboards over billions of rows"], avoidWhen: ["Row-level updates/deletes are frequent", "OLTP transactions"], watch: ["Eventual, batch-oriented mutations", "Joins are more limited than in OLTP databases"],
    caps: c([2, 1, 1, 5, 2, 5, 0, 1, 5, 5, 4, 2, 3, 2, 0, 2, 3, 4, 3, 4, 3]) },
  { id: "cassandra", label: "Apache Cassandra", tagline: "Masterless wide-column store for write-heavy, always-on workloads", family: "wide-column", openSource: "yes", toolSupport: "advisor",
    bestFor: ["Massive write throughput", "Multi-datacenter active-active", "Time-series with predictable queries"], avoidWhen: ["Ad-hoc queries, joins or aggregations", "Small teams without operational capacity"], watch: ["Query-first data modelling", "Operationally demanding", "Tunable (not strong) consistency by default"],
    caps: c([0, 2, 4, 5, 1, 2, 0, 1, 5, 4, 5, 2, 0, 1, 0, 1, 5, 5, 2, 5, 2]) },
];

function weightsFor(p: WorkloadProfile): Partial<Record<Cap, number>> {
  const w: Partial<Record<Cap, number>> = {};
  const add = (cap: Cap, x: number) => { w[cap] = (w[cap] ?? 0) + x; };
  switch (p.dataShape) {
    case "relational": add("relational", 3); add("joins", 1); break;
    case "document": add("document", 3); add("flexSchema", 1); add("jsonSupport", 1); break;
    case "key_value": add("keyValue", 3); add("readSpeed", 1); break;
    case "time_series": add("timeSeries", 3); add("writeSpeed", 1); break;
    case "search": add("search", 3); break;
    case "analytics": add("analytics", 3); break;
    case "graph": add("graph", 3); add("joins", 1); break;
    case "mixed": add("relational", 1.5); add("document", 1.5); add("jsonSupport", 1); break;
  }
  if (p.consistency === "strong") add("acid", 2.5); else add("scaleOut", 0.5);
  if (p.scale === "small") { add("simpleOps", 1.5); add("embedded", 0.5); } else if (p.scale === "large") add("scaleOut", 2); else if (p.scale === "massive") add("scaleOut", 3.5);
  if (p.writes === "write_heavy") add("writeSpeed", 2); else if (p.writes === "read_heavy") add("readSpeed", 1.5);
  if (p.queries === "key_lookup") add("keyValue", 1.5); else if (p.queries === "joins") add("joins", 2.5); else if (p.queries === "aggregations") add("analytics", 2); else if (p.queries === "full_text") add("search", 2.5);
  if (p.schema === "evolving") add("flexSchema", 1.5); else add("relational", 0.5);
  if (p.deployment === "embedded") add("embedded", 4); else if (p.deployment === "managed_cloud") { add("simpleOps", 1.5); add("serverless", 0.5); }
  if (p.latency === "ultra_low") add("readSpeed", 2.5); else if (p.latency === "low") add("readSpeed", 1.2);
  for (const n of p.needs) {
    if (n === "transactions") add("acid", 2); if (n === "json") add("jsonSupport", 2); if (n === "geo") add("geo", 2);
    if (n === "full_text") add("search", 2); if (n === "multi_region") add("multiRegion", 2.5); if (n === "offline") add("embedded", 2);
    if (n === "high_availability") add("ha", 2); if (n === "analytics_sql") { add("analytics", 2); add("relational", 0.5); }
    if (n === "time_series") add("timeSeries", 2.5); if (n === "graph_traversal") add("graph", 2.5); if (n === "ttl") add("ttl", 2); if (n === "serverless") add("serverless", 2);
  }
  return w;
}

export interface Recommendation {
  id: string; label: string; tagline: string; family: string; score: number; rank: number; fit: "excellent" | "good" | "possible" | "poor";
  why: string[]; watchOuts: string[]; bestFor: string[]; avoidWhen: string[]; toolSupport: ToolSupport; openSource: Candidate["openSource"]; caps: Record<Cap, number>;
}
export interface PolyglotSuggestion { role: string; db: string; reason: string }
export interface AdvisorResult { ranked: Recommendation[]; polyglot: PolyglotSuggestion[]; summary: string; assumptions: string[]; weights: Partial<Record<Cap, number>> }

export function advise(p: WorkloadProfile): AdvisorResult {
  const w = weightsFor(p);
  const entries = Object.entries(w) as [Cap, number][];
  const max = entries.reduce((a, [, x]) => a + x * 5, 0) || 1;
  const ranked: Recommendation[] = CANDIDATES.map((cand): Recommendation => {
    let raw = entries.reduce((a, [cap, x]) => a + x * cand.caps[cap], 0);
    let factor = 1;
    const watch = [...cand.watch];
    if (p.deployment === "embedded" && cand.caps.embedded < 3) factor *= 0.35;
    if ((p.consistency === "strong" || p.needs.includes("transactions")) && cand.caps.acid <= 2) { factor *= 0.65; watch.unshift("Weak multi-record ACID guarantees for your stated consistency needs"); }
    if (p.stack === "open_source_only") { if (cand.openSource === "no") { factor *= 0.2; watch.unshift("Proprietary — conflicts with your open-source-only preference"); } else if (cand.openSource === "source-available") { factor *= 0.85; watch.unshift("Source-available licence — verify current terms against your policy"); } }
    if (p.stack === "microsoft" && cand.id === "sqlserver") raw += max * 0.06;
    if (p.stack === "aws" && cand.id === "dynamodb") raw += max * 0.05;
    const score = Math.round(Math.min(100, (raw / max) * 100 * factor));
    const contrib = entries.map(([cap, x]) => ({ cap, v: x * cand.caps[cap], x })).filter((e) => cand.caps[e.cap] >= 4).sort((a, b) => b.v - a.v).slice(0, 3);
    const why = contrib.map((e) => `Strong ${CAP_LABEL[e.cap]} (${cand.caps[e.cap]}/5) — matters for your profile`);
    for (const [cap, x] of entries) if (x >= 2 && cand.caps[cap] <= 2) watch.push(`Weak at ${CAP_LABEL[cap]} (${cand.caps[cap]}/5), which you weighted heavily`);
    return { id: cand.id, label: cand.label, tagline: cand.tagline, family: cand.family, score, rank: 0, fit: score >= 78 ? "excellent" : score >= 62 ? "good" : score >= 45 ? "possible" : "poor", why, watchOuts: watch.slice(0, 5), bestFor: cand.bestFor, avoidWhen: cand.avoidWhen, toolSupport: cand.toolSupport, openSource: cand.openSource, caps: cand.caps };
  }).sort((a, b) => b.score - a.score).map((r, i) => ({ ...r, rank: i + 1 }));

  const top = ranked[0];
  const polyglot: PolyglotSuggestion[] = [];
  const topCaps = top.caps;
  if ((p.needs.includes("full_text") || p.queries === "full_text") && topCaps.search < 4 && top.id !== "elasticsearch") polyglot.push({ role: "Search index", db: "Elasticsearch / OpenSearch", reason: `${top.label} can do basic text search, but relevance ranking, facets and analyzers belong in a dedicated search engine fed from it.` });
  if ((p.latency === "ultra_low" || p.needs.includes("ttl")) && top.id !== "redis" && topCaps.ttl < 5) polyglot.push({ role: "Cache / ephemeral store", db: "Redis", reason: "Sessions, rate limits and hot reads with TTL are cheaper in memory than on your primary store." });
  if ((p.queries === "aggregations" || p.needs.includes("analytics_sql")) && topCaps.analytics < 4 && top.id !== "clickhouse") polyglot.push({ role: "Analytics offload", db: "ClickHouse (or a warehouse)", reason: `Heavy aggregations compete with OLTP traffic on ${top.label}; replicate events/rows into a columnar store for dashboards.` });
  if (p.needs.includes("time_series") && topCaps.timeSeries < 4 && top.id !== "clickhouse") polyglot.push({ role: "Metrics / time-series", db: "ClickHouse or a time-series extension", reason: "High-volume timestamped data compresses and queries far better in a time-series-optimised engine." });
  if (p.needs.includes("graph_traversal") && topCaps.graph < 4) polyglot.push({ role: "Relationship traversal", db: "A graph database (e.g. Neo4j) — or recursive CTEs for shallow depth", reason: "Deep multi-hop traversals degrade quickly with join-based modelling." });

  const second = ranked[1];
  const summary = `${top.label} fits this profile best (${top.score}/100, ${top.fit}); ${second.label} is the closest alternative (${second.score}).` + (polyglot.length ? ` Consider a polyglot setup: ${polyglot.map((x) => x.db.split(" ")[0]).join(" + ")} alongside it.` : "");
  const assumptions = [
    "Scores are a transparent heuristic over your declared requirements (capability ratings 0–5 × weights) — not a benchmark.",
    "Ratings assume mainstream managed or well-operated self-hosted deployments of current major versions.",
    "Validate the shortlist with a workload-representative prototype before committing.",
  ];
  return { ranked, polyglot, summary, assumptions, weights: w };
}

export function deriveProfile(model: SchemaModel): { profile: Partial<WorkloadProfile>; signals: string[] } {
  const signals: string[] = [];
  const profile: Partial<WorkloadProfile> = {};
  const needs = new Set<Need>();
  const fields = model.entities.flatMap((e) => e.fields);
  if (isRelational(model.engine)) {
    profile.dataShape = "relational"; profile.schema = "stable";
    signals.push(`${model.engine} schema with ${model.entities.length} entities → relational data shape`);
    const fks = model.entities.reduce((a, e) => a + e.constraints.filter((x) => x.kind === "foreign_key").length, 0);
    if (fks > 0) { needs.add("transactions"); signals.push(`${fks} foreign key(s) → integrity and transactions matter`); }
    if (model.relationships.length >= 3) { profile.queries = "joins"; signals.push(`${model.relationships.length} relationships → join-heavy access likely`); }
  } else {
    profile.dataShape = "document";
    signals.push(`Document schema with ${model.entities.length} collection(s) → document data shape`);
    const sparse = fields.filter((f) => (f.presence ?? 1) < 1 || (f.bsonTypes?.length ?? 0) > 1).length;
    if (fields.length && sparse / fields.length > 0.2) { profile.schema = "evolving"; signals.push(`${sparse}/${fields.length} fields are optional or multi-typed → evolving schema`); } else profile.schema = "stable";
    if (model.relationships.length >= 3) { profile.consistency = "strong"; signals.push(`${model.relationships.length} inferred references → cross-collection consistency may matter`); }
  }
  if (fields.some((f) => /json/i.test(f.type) || f.nested)) { needs.add("json"); signals.push("JSON / nested structures present → JSON handling matters"); }
  const ixs = model.entities.flatMap((e) => e.indexes);
  if (ixs.some((i) => i.kind === "ttl" || (i.ttlSeconds ?? 0) > 0)) { needs.add("ttl"); signals.push("TTL index found → automatic expiry needed"); }
  if (ixs.some((i) => /text|fulltext/i.test(`${i.method} ${i.kind}`))) { needs.add("full_text"); signals.push("Text/FULLTEXT index found → full-text search needed"); }
  if (ixs.some((i) => /2d|geo|spatial|gist/i.test(`${i.method} ${i.kind}`))) { needs.add("geo"); signals.push("Geospatial index found → geo queries needed"); }
  const tsEntity = model.entities.find((e) => /(metric|event|log|reading|telemetry|measurement|tick)s?$/i.test(e.shortName) && e.fields.some((f) => /time|date|_at$|ts$/i.test(f.name)));
  if (tsEntity) { needs.add("time_series"); signals.push(`${tsEntity.shortName} looks like append-only timestamped data → time-series need`); }
  const rows = Math.max(0, ...model.entities.map((e) => e.rowEstimate ?? 0));
  if (rows > 100_000_000) { profile.scale = "large"; signals.push(`Largest table ≈ ${rows.toLocaleString()} rows → large scale`); }
  else if (rows > 5_000_000) { profile.scale = "medium"; signals.push(`Largest table ≈ ${rows.toLocaleString()} rows → medium scale`); }
  else if (rows > 0) { profile.scale = "small"; signals.push(`Largest table ≈ ${rows.toLocaleString()} rows → small/medium scale`); }
  profile.needs = [...needs];
  return { profile, signals };
}

export function migrationHint(current: string, target: string): { supported: boolean; message: string } {
  const supported = new Set(["postgres", "mysql", "sqlite", "mongodb"]);
  if (current === target) return { supported: false, message: "You are already on this engine — use Diff & Migrate for schema evolution." };
  if (supported.has(current) && supported.has(target)) return { supported: true, message: "Transform Studio can generate the target schema, field mapping, ETL script and runbook for this move." };
  return { supported: false, message: "Transform Studio does not support this engine pair yet (adapter on the roadmap). Use the schema export and mapping rules as a design starting point." };
}
