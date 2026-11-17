import { SchemaModel } from "./schema-model";
import { Finding } from "./analysis";
import { namespaceGraph, type ArchitectureReport, type FlowInput } from "./architecture";

// ─── Architecture assistant ────────────────────────────────────────
// Three analysis modes over the structured model, deterministic findings and
// (when available) the project's multi-datastore architecture.
// By default answers come from a built-in, rule-grounded generator (no network,
// no invented objects). If ANTHROPIC_API_KEY or OPENAI_API_KEY is configured,
// the same grounded context is sent to that provider.

export type AIModelType = "architect" | "optimizer" | "operations";

export interface AIModelMeta {
  id: AIModelType;
  name: string;
  badge: string;
  specialty: string;
  description: string;
  engine?: string;
}

export interface SystemAIContext {
  architecture: ArchitectureReport;
  flows: FlowInput[];
}

export const AI_MODELS: Record<AIModelType, AIModelMeta> = {
  architect: { id: "architect", name: "Architecture review", badge: "Topology & integrity", specialty: "Multi-schema boundaries, cross-store coupling, hubs, normalization vs embedding", description: "Holistic review of the schema graph, schemas and cross-store topology." },
  optimizer: { id: "optimizer", name: "Query & index tuning", badge: "Access paths", specialty: "Index selectivity, compound key order (ESR), redundancy, Redis TTL/memory", description: "Index, keyspace and access-path review grounded in the findings." },
  operations: { id: "operations", name: "Operations & migrations", badge: "Zero-downtime changes", specialty: "Online DDL, lock budgets, partitioning, CDC cutover, rollback safety", description: "Sequencing schema and multi-store changes safely in production." },
};

function normalizeMode(m: string | undefined): AIModelType {
  if (m === "optimizer" || m === "fable-5.2-max") return "optimizer";
  if (m === "operations" || m === "frontier-dba") return "operations";
  return "architect";
}

export const SUGGESTED_QUESTIONS = [
  "Perform an exhaustive architectural & bottleneck audit",
  "Analyze multi-schema boundaries, cycles and cross-store dependencies",
  "Analyze index selectivity, redundancy & missing covering indexes",
  "Generate a zero-downtime online migration strategy",
  "Evaluate relational normalization vs document embedding for this schema",
  "Design a table partitioning and sharding roadmap for 100M+ rows",
  "Which entities are the primary join/delete hubs?",
  "Audit Redis keyspaces, TTL coverage and eviction risks",
];

export const AI_SUGGESTED_PROMPTS = SUGGESTED_QUESTIONS;

export function answerQuestion(
  question: string,
  model: SchemaModel,
  findings: Finding[],
  modelType: AIModelType = "architect",
  system?: SystemAIContext
): { answer: string; citations: string[] } {
  return generateFrontierResponse(question, model, findings, modelType, system);
}

export async function askFrontierArchitect(
  question: string,
  model: SchemaModel,
  findings: Finding[],
  requested: string = "architect",
  system?: SystemAIContext
): Promise<{ answer: string; citations: string[]; model: AIModelMeta }> {
  const modelType = normalizeMode(requested);
  const meta = AI_MODELS[modelType];
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (anthropicKey && process.env.ANTHROPIC_MODEL) {
    try {
      const res = await callAnthropic(anthropicKey, process.env.ANTHROPIC_MODEL, question, model, findings, meta, system);
      if (res) return { ...res, model: { ...meta, engine: process.env.ANTHROPIC_MODEL } };
    } catch (err) { console.warn("[ai] provider call failed; using built-in generator", err); }
  } else if (openaiKey && process.env.OPENAI_MODEL) {
    try {
      const res = await callOpenAI(openaiKey, process.env.OPENAI_MODEL, question, model, findings, meta, system);
      if (res) return { ...res, model: { ...meta, engine: process.env.OPENAI_MODEL } };
    } catch (err) { console.warn("[ai] provider call failed; using built-in generator", err); }
  }
  const { answer, citations } = generateFrontierResponse(question, model, findings, modelType, system);
  return { answer, citations, model: { ...meta, engine: "built-in" } };
}

function generateFrontierResponse(
  question: string,
  model: SchemaModel,
  findings: Finding[],
  modelType: AIModelType,
  system?: SystemAIContext
): { answer: string; citations: string[] } {
  const q = question.toLowerCase();
  const citations: string[] = [];
  const entities = model.entities;
  const rels = model.relationships;
  const isDoc = model.engine === "mongodb";
  const isRedis = model.engine === "redis";
  const nsGraph = namespaceGraph(model);

  const degreeMap = new Map<string, number>();
  for (const e of entities) degreeMap.set(e.name, 0);
  for (const r of rels) {
    degreeMap.set(r.fromEntity, (degreeMap.get(r.fromEntity) ?? 0) + 1);
    degreeMap.set(r.toEntity, (degreeMap.get(r.toEntity) ?? 0) + 1);
  }
  const hubs = [...degreeMap.entries()].sort((a, b) => b[1] - a[1]);
  const topHubs = hubs.slice(0, 5);
  const primaryTable = entities.find((e) => e.kind === "table") ?? entities[0];
  const sampleRef = rels[0];

  const criticalFindings = findings.filter((f) => f.severity === "critical" || f.severity === "high");
  const indexFindings = findings.filter((f) => f.category === "index");
  const schemaFindings = findings.filter((f) => /-SCHEMA-/.test(f.ruleId));

  // TARGETED RULE LOOKUP (e.g. "How do I fix PG-SCHEMA-001?" or "explain ARCH-001")
  const ruleMatch = question.match(/\b((?:PG|MY|SQLITE|MG|RD|ARCH)-[A-Z]+-\d{3}|ARCH-\d{3})\b/i);
  if (ruleMatch) {
    const rid = ruleMatch[1].toUpperCase();
    const matched = findings.filter((f) => f.ruleId.toUpperCase() === rid);
    const archMatched = system?.architecture.findings.filter((f) => f.ruleId.toUpperCase() === rid) ?? [];
    if (matched.length || archMatched.length) {
      citations.push(rid, ...matched.map((f) => f.object).slice(0, 4), ...archMatched.map((f) => f.object).slice(0, 4));
      const blocks = [
        ...matched.map((f) => `#### \`${f.ruleId}\` · [${f.severity.toUpperCase()}] ${f.title} (\`${f.object}\`)\n* **Evidence (${f.evidenceLevel}, ${f.confidence}% confidence):** \`${JSON.stringify(f.evidence)}\`\n* **Why it matters:** ${f.explanation}\n* **Recommended action:** ${f.recommendation}${f.limitations.length ? `\n* **Limitations:** ${f.limitations.join("; ")}` : ""}`),
        ...archMatched.map((f) => `#### \`${f.ruleId}\` · [${f.severity.toUpperCase()}] ${f.title} (\`${f.object}\`)\n* **Evidence:** \`${JSON.stringify(f.evidence)}\`\n* **Why it matters:** ${f.explanation}\n* **Recommended action:** ${f.recommendation}`),
      ];
      return { answer: `### Finding Breakdown — \`${rid}\`\n\n${blocks.join("\n\n")}`, citations };
    }
  }

  // TARGETED ENTITY LOOKUP (when user asks specifically about a table/collection/keyspace in the model)
  const mentionedEntities = entities.filter((e) => {
    const full = e.name.toLowerCase();
    const short = e.shortName.toLowerCase();
    return q.includes(full) || (short.length >= 4 && new RegExp(`\\b${short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(q));
  });
  if (mentionedEntities.length === 1 && !/audit|migration|partition|shard|compare|all/i.test(q)) {
    const e = mentionedEntities[0];
    const eFindings = findings.filter((f) => f.object === e.name || f.object.startsWith(`${e.name}.`) || f.object.includes(e.shortName));
    const outgoing = rels.filter((r) => r.fromEntity === e.name);
    const incoming = rels.filter((r) => r.toEntity === e.name);
    const xLinks = system?.architecture.links.filter((l) => l.fromEntity === e.name || l.toEntity === e.name) ?? [];
    citations.push(e.name, ...eFindings.map((f) => f.ruleId).slice(0, 4));
    return {
      answer: `### Entity Deep Dive — \`${e.name}\` (${e.kind} · ${model.engine})

* **Namespace:** \`${e.namespace}\` · **Fields:** ${e.fields.length} · **Indexes:** ${e.indexes.length} · **Constraints:** ${e.constraints.length}${e.rowEstimate != null ? ` · **Row/key estimate:** ~${e.rowEstimate.toLocaleString("en-US")}` : ""}
* **Key structure:** ${e.fields.filter((f) => f.isPrimaryKey).map((f) => `\`${f.name}\` (${f.type})`).join(", ") || "⚠️ No primary key declared"}
* **Relationships:** ${outgoing.length} outgoing (${outgoing.map((r) => `→ \`${r.toEntity}\``).join(", ") || "none"}), ${incoming.length} incoming (${incoming.map((r) => `← \`${r.fromEntity}\``).join(", ") || "none"})
${xLinks.length ? `* **Cross-store links:** ${xLinks.map((l) => `${l.kind}: \`${l.fromEntity}\` → \`${l.toEntity}\` (${Math.round(l.confidence * 100)}%)`).join("; ")}` : ""}

#### Findings on \`${e.name}\` (${eFindings.length})
${eFindings.length ? eFindings.map((f) => `* **[${f.severity.toUpperCase()}] \`${f.ruleId}\` — ${f.title}**: ${f.recommendation}`).join("\n") : "* No open findings directly on this entity."}

#### Columns / Fields
${e.fields.slice(0, 20).map((f) => `* \`${f.name}\` \`${f.type}\` ${f.nullable ? "nullable" : "**NOT NULL**"}${f.isPrimaryKey ? " [PK]" : ""}${f.defaultValue ? ` default \`${f.defaultValue}\`` : ""}`).join("\n")}`,
      citations,
    };
  }

  // MODE S: MULTI-SCHEMA & MULTI-DATASTORE SYSTEM ARCHITECTURE
  if (/multi.?schema|cross.?schema|cross.?store|polyglot|datastore|cycle|schema.*boundar|system.*arch|redis.*store|all.*store/.test(q) || (system && system.architecture.stores.length > 1 && /system|stores|topology|flow|sync|duplicate/.test(q))) {
    const arch = system?.architecture;
    citations.push(...nsGraph.namespaces.slice(0, 4).map((n) => n.name), ...(arch?.findings.map((f) => f.ruleId).slice(0, 4) ?? []));
    const nsLines = nsGraph.namespaces.filter((n) => !n.external).map((n) => `* \`${n.name}\` — ${n.entities} entities (${n.inbound} inbound FKs, ${n.outbound} outbound FKs)`).join("\n");
    const cycleLine = nsGraph.cycles.length ? nsGraph.cycles.map(([a, b]) => `\`${a} ⇄ ${b}\``).join(", ") : "None detected";
    const storeSection = arch
      ? `\n#### 2. Multi-Datastore System (${arch.totals.stores} stores · ${arch.totals.engines} engines · score ${arch.score}/100)\n${arch.stores.map((s) => `* **${s.name}** (\`${s.engine}\`, role: *${s.role}*) — ${s.namespaces.filter((n) => !n.external).length} namespace(s), ${s.entities} entities, ${s.linkCount} cross-store link(s)`).join("\n")}\n\n**Declared Data Flows (${system?.flows.length ?? 0}):** ${system?.flows.length ? system.flows.map((f) => `${arch.stores.find((s) => s.id === f.fromStoreId)?.name ?? f.fromStoreId} → ${arch.stores.find((s) => s.id === f.toStoreId)?.name ?? f.toStoreId} (\`${f.kind}\`)`).join("; ") : "None declared"}\n\n**Architecture Findings (${arch.findings.length}):**\n${arch.findings.length ? arch.findings.map((f) => `* **[${f.severity.toUpperCase()}] \`${f.ruleId}\` — ${f.title}** (\`${f.object}\`): ${f.recommendation}`).join("\n") : "* No cross-store issues detected."}`
      : "";
    return {
      answer: `### Multi-Schema & System Architecture Review — ${model.database}

#### 1. Schema Boundaries inside \`${model.database}\` (${nsGraph.namespaces.filter((n) => !n.external).length} namespace(s))
${nsLines || "* Single namespace"}
* **Cross-schema edges:** ${nsGraph.edges.length} (${nsGraph.edges.slice(0, 6).map((e) => `\`${e.from} → ${e.to}\` (${e.count})`).join(", ") || "none"})
* **Schema cycles:** ${cycleLine}
${schemaFindings.length ? `\n**Schema-level findings:**\n${schemaFindings.map((f) => `* **[${f.severity.toUpperCase()}] \`${f.ruleId}\`** (${f.object}): ${f.recommendation}`).join("\n")}` : ""}
${storeSection}`,
      citations,
    };
  }

  // MODE R: REDIS KEYSPACE, TTL & EVICTION AUDIT
  if (isRedis || /\b(redis|ttl|keyspaces?|evict(ion)?|big.?keys?|caching)\b/.test(q)) {
    const rdFindings = findings.filter((f) => f.ruleId.startsWith("RD-"));
    const archCache = system?.architecture.findings.filter((f) => f.ruleId === "ARCH-006") ?? [];
    const policy = model.catalog?.settings?.maxmemoryPolicy ?? "unknown";
    citations.push(...entities.slice(0, 4).map((e) => e.shortName), ...rdFindings.map((f) => f.ruleId).slice(0, 4));
    const ksLines = isRedis
      ? entities.slice(0, 12).map((e) => {
          const meta = (e.metadata ?? {}) as { redisType?: string; ttl?: { known?: number; with?: number; avg?: number }; size?: { max: number } | null };
          const ttlStr = (meta.ttl?.known ?? 0) === 0 ? "TTL unknown" : (meta.ttl?.with ?? 0) === 0 ? "⚠️ no TTL" : `${meta.ttl?.with}/${meta.ttl?.known} expire (avg ${meta.ttl?.avg ?? 0}s)`;
          return `* \`${e.shortName}\` (\`${meta.redisType ?? "?"}\`) — ${ttlStr}${meta.size?.max ? `, max ${meta.size.max.toLocaleString("en-US")} items/bytes` : ""}`;
        }).join("\n")
      : "* Selected version is not Redis — switch the top-bar selector to your Redis datastore to inspect key patterns directly.";
    return {
      answer: `### Redis Keyspace, TTL & Memory Audit — ${model.database}

* **Eviction policy (\`maxmemory-policy\`):** \`${policy}\`
* **Key patterns modeled:** ${isRedis ? entities.length : 0}

#### Keyspaces
${ksLines}

#### Keyspace Findings (${rdFindings.length + archCache.length})
${[...rdFindings, ...archCache].length ? [...rdFindings, ...archCache].map((f) => `* **[${f.severity.toUpperCase()}] \`${f.ruleId}\` — ${f.title}** (\`${f.object}\`): ${f.recommendation}`).join("\n") : "* No TTL, big-key or eviction issues flagged."}`,
      citations,
    };
  }

  // MODE A: EXHAUSTIVE ARCHITECTURAL & BOTTLENECK AUDIT
  if (/audit|architecture|bottleneck|overview|review|explain.*(database|system|schema)|health|hub/.test(q)) {
    citations.push(...topHubs.map(([n]) => n), ...criticalFindings.map((f) => f.ruleId).slice(0, 4));
    const archSummary = system && system.architecture.stores.length > 1
      ? `\n* **System footprint:** ${system.architecture.totals.stores} datastores across ${system.architecture.totals.engines} engines, ${system.architecture.totals.links} inferred cross-store link(s), architecture score **${system.architecture.score}/100**.`
      : "";
    return {
      answer: `### Executive Architecture Audit — ${model.database.toUpperCase()} (${model.engine.toUpperCase()})
**Mode:** ${AI_MODELS[modelType].name} · built-in, rule-grounded
**Overall Risk Profile:** ${criticalFindings.length > 2 ? "High-Risk Hotspots Detected" : criticalFindings.length > 0 ? "Moderate Structural Risk" : "Solid Structural Core"}

---

#### 1. System Topology & Multi-Schema Graph
* **Namespaces / Schemas:** ${model.namespaces.length} (\`${model.namespaces.slice(0, 10).join("`, `")}\`)${nsGraph.cycles.length ? ` · ⚠️ Cycles: ${nsGraph.cycles.map(([a, b]) => `\`${a} ⇄ ${b}\``).join(", ")}` : ""}
* **Total Entities Mapped:** ${entities.length} (${isDoc ? "Collections" : isRedis ? "Key patterns" : "Tables / Views"})
* **Active Relationships:** ${rels.length} (${rels.filter((r) => r.provenance === "explicit").length} explicit constraints, ${rels.filter((r) => r.provenance !== "explicit").length} inferred references)${archSummary}
* **Primary Hub Entities:**
${topHubs.map(([name, deg], i) => `  ${i + 1}. \`${name}\` — degree **${deg}** (${entities.find((e) => e.name === name)?.fields.length ?? 0} fields)`).join("\n")}

> **Hub Assessment:** \`${topHubs[0]?.[0] ?? primaryTable?.name ?? "The central entity"}\` is the highest-degree nexus in this graph. Schema changes and cascading deletes here fan out widest.

---

#### 2. High-Severity & Critical Findings (${criticalFindings.length})
${
  criticalFindings.length
    ? criticalFindings
        .map(
          (f) => `* **[${f.severity.toUpperCase()}] ${f.title}** (\`${f.ruleId}\` on \`${f.object}\`)
  * *Evidence (${f.evidenceLevel}, ${f.confidence}%):* ${f.explanation}
  * *Remediation:* ${f.recommendation}`
        )
        .join("\n")
    : "* No critical or high-severity anti-patterns detected in this version."
}

---

#### 3. Index & Storage Footprint
* **Index Inventory:** ${entities.reduce((a, e) => a + e.indexes.length, 0)} indexes across ${entities.length} entities.
${
  indexFindings.length
    ? `* Detected **${indexFindings.length}** index review candidates (e.g. \`${indexFindings[0]?.ruleId}\` on \`${indexFindings[0]?.object}\`). Validate against real query telemetry before dropping or adding indexes.`
    : "* No duplicate or prefix-redundant indexes detected."
}

---

#### 4. Prioritized Remediation Sequence
1. **Structural integrity first:** Fix missing primary keys, foreign-key type mismatches and invalid indexes.
2. **Schema & store boundaries:** Break schema cycles (${nsGraph.cycles.length} detected) and declare sync flows for any entities shared across datastores.
3. **Workload validation:** Measure with \`pg_stat_statements\` / slow-query logs / MongoDB Profiler before applying heuristic index changes.`,
      citations,
    };
  }

  // MODE B: INDEX SELECTIVITY, COMPOUND ESR & COVERING INDEXES
  if (/index|selectivity|covering|redundant|btree|esr|prefix/.test(q)) {
    citations.push(...indexFindings.map((f) => f.ruleId).slice(0, 5));
    const sampleEntity = entities.find((e) => e.constraints.some((c) => c.kind === "foreign_key")) ?? primaryTable;
    const sampleFkCol = sampleEntity?.constraints.find((c) => c.kind === "foreign_key")?.columns[0] ?? sampleEntity?.fields[1]?.name ?? "id";
    const sampleExtraCol = sampleEntity?.fields.find((f) => !f.isPrimaryKey && f.name !== sampleFkCol)?.name ?? "created_at";
    const recipe = isDoc
      ? `db.getCollection("${sampleEntity?.shortName ?? "items"}").createIndex({ "${sampleFkCol}": 1, "${sampleExtraCol}": -1 });`
      : `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${sampleEntity?.shortName ?? "table"}_${sampleFkCol}_cov\nON ${sampleEntity?.name ?? "public.table"} (${sampleFkCol})\nINCLUDE (${sampleExtraCol});`;
    return {
      answer: `### Deep Index & Access Path Review — ${model.database}
**Mode:** ${AI_MODELS[modelType].name} · compound key selectivity (ESR)

---

#### 1. Compound Index Ordering (Equality → Sort → Range)
1. **Equality columns first** (e.g. \`tenant_id\`, \`${sampleFkCol}\`)
2. **Sort columns second** (avoids disk-spill sorts)
3. **Range predicates last** (e.g. timestamp bounds)

---

#### 2. Specific Index Findings (${indexFindings.length})
${
  indexFindings.length
    ? indexFindings
        .map(
          (f) => `##### \`${f.ruleId}\`: ${f.title} (\`${f.object}\`)
* **Evidence (${f.evidenceLevel}, ${f.confidence}%):** \`${JSON.stringify(f.evidence)}\`
* **Root Cause:** ${f.explanation}
* **Action:** ${f.recommendation}
* **Trade-off:** ${f.tradeoff ?? "Write amplification vs. read acceleration."}`
        )
        .join("\n\n")
    : "* No duplicate, invalid or prefix-redundant indexes detected in this schema."
}

---

#### 3. Example Covering Index for \`${sampleEntity?.name ?? model.database}\`
\`\`\`${isDoc ? "javascript" : "sql"}
${recipe}
\`\`\`
> **Rule:** Never drop an index without verifying zero scans across primary AND read replicas over at least 14 days.`,
      citations,
    };
  }

  // MODE C: ZERO-DOWNTIME ONLINE MIGRATION STRATEGY
  if (/migration|downtime|lock|zero|safe|rollback|concurrent|deploy|cutover/.test(q)) {
    citations.push(...entities.slice(0, 3).map((e) => e.name));
    const targetTbl = sampleRef?.fromEntity ?? primaryTable?.name ?? "schema.table";
    const parentTbl = sampleRef?.toEntity ?? primaryTable?.name ?? "schema.parent";
    const fkCol = sampleRef?.fromColumns[0] ?? "parent_id";
    return {
      answer: `### Zero-Downtime Online Migration Playbook — ${model.database}
**Framework:** Expand-Contract · **Engine:** ${model.engine.toUpperCase()}

---

#### Phase 1: Expand (Non-blocking Additive Changes)
1. **Add nullable columns or constant defaults first** — never add \`NOT NULL\` without a default directly on a live table:
   \`\`\`sql
   ALTER TABLE ${targetTbl} ADD COLUMN IF NOT EXISTS new_field text;
   \`\`\`
2. **Create supporting indexes online (outside \`BEGIN…COMMIT\`):**
   \`\`\`sql
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${(targetTbl.split(".").pop() ?? "t")}_new_field ON ${targetTbl} (new_field);
   \`\`\`
3. **Add constraints without a full table write lock:**
   \`\`\`sql
   ALTER TABLE ${targetTbl} ADD CONSTRAINT fk_${(targetTbl.split(".").pop() ?? "t")}_verify
     FOREIGN KEY (${fkCol}) REFERENCES ${parentTbl}(id) NOT VALID;
   ALTER TABLE ${targetTbl} VALIDATE CONSTRAINT fk_${(targetTbl.split(".").pop() ?? "t")}_verify;
   \`\`\`

---

#### Phase 2: Dual-Write & Batched Backfill
* Deploy app code writing to both old and new shapes behind a feature flag.
* Backfill in batches of 1,000–5,000 rows, pausing between batches so replication lag stays bounded.

---

#### Phase 3: Validate, Switch & Contract
* Run parity queries (row counts + checksums + orphan checks).
* Switch reads to the new structure; keep the old column/table until the rollback window closes, then drop indexes before dropping columns.`,
      citations,
    };
  }

  // MODE D: RELATIONAL VS DOCUMENT (EMBEDDING VS REFERENCING)
  if (/embed|reference|mongo|relational|document|normalize|denormalize/.test(q)) {
    citations.push(...rels.map((r) => `${r.fromEntity}→${r.toEntity}`).slice(0, 4));
    return {
      answer: `### Document vs. Relational Modelling — ${model.database}

#### 1. Embed when
* Child cardinality is bounded (<100–200 items per parent), always read with the parent, and deleted with it (\`ON DELETE CASCADE\`).

#### 2. Reference when
* Growth is unbounded (events, logs, comments, audit trails — risks MongoDB's 16 MB limit), shared across parents, or queried independently.

#### 3. Evaluation of Visible Relationships (${rels.length})
${
  rels.length
    ? rels
        .slice(0, 14)
        .map(
          (r) => `* **\`${r.fromEntity}\` → \`${r.toEntity}\`** [${r.provenance}, ${Math.round((r.confidence ?? 0.5) * 100)}%] — ${
            /item|line|detail|address/i.test(r.fromEntity)
              ? "Candidate for **embedding** in parent document."
              : "Keep as a **separate collection/table (referenced)** with indexed keys."
          }`
        )
        .join("\n")
    : "* Standalone entities without explicit join paths."
}`,
      citations,
    };
  }

  // MODE E: PARTITIONING & SHARDING AT SCALE
  if (/partition|shard|scale|massive|million|horizontal|terabyte/.test(q)) {
    const growthCandidates = entities.filter((e) => /(event|log|audit|order|invoice|payment|activity|metric)s?$/i.test(e.shortName));
    const exampleTbl = growthCandidates[0] ?? primaryTable;
    const timeCol = exampleTbl?.fields.find((f) => /at$|date|time|ts$/i.test(f.name))?.name ?? "created_at";
    citations.push(...(growthCandidates.length ? growthCandidates : entities).slice(0, 4).map((e) => e.name));
    return {
      answer: `### Partitioning & Sharding Roadmap — ${model.database}

#### 1. Highest-Priority Partitioning Candidates in \`${model.database}\`
${growthCandidates.length ? growthCandidates.map((e) => `* \`${e.name}\` (${e.fields.length} columns${e.rowEstimate ? `, ~${e.rowEstimate.toLocaleString("en-US")} rows` : ""}) — range-partition by time column`).join("\n") : `* \`${exampleTbl?.name ?? model.database}\` (no append-only table names detected; confirm write volume first)`}

\`\`\`sql
-- Declarative monthly range partitioning for ${exampleTbl?.name ?? "public.events"}
CREATE TABLE ${exampleTbl?.name ?? "public.events"}_part (
  LIKE ${exampleTbl?.name ?? "public.events"} INCLUDING DEFAULTS INCLUDING CONSTRAINTS
) PARTITION BY RANGE (${timeCol});
\`\`\`

#### 2. Shard Key Selection & Key Rules at 100M+ Rows
* Include the partition key (\`${timeCol}\`) in the \`PRIMARY KEY\` and every \`UNIQUE\` constraint.
* Drop expired partitions (\`DROP TABLE …\`) instead of running \`DELETE\` (avoids vacuum bloat).
* For multi-tenant sharding, pick a high-cardinality co-location key (\`tenant_id\` / \`user_id\`), never low-cardinality \`status\`.`,
      citations,
    };
  }

  const meta = AI_MODELS[modelType] ?? AI_MODELS.architect;
  citations.push(...entities.slice(0, 5).map((e) => e.name));
  return {
    answer: `### Grounded Assessment — ${model.database} (${model.engine.toUpperCase()})
**Mode:** ${meta.name}

* **Schemas / Namespaces:** ${model.namespaces.length} (\`${model.namespaces.slice(0, 8).join("`, `")}\`)
* **Entities & Links:** ${entities.length} entities, ${rels.length} relationships
* **Top Hub:** \`${topHubs[0]?.[0] ?? primaryTable?.name ?? "—"}\` (degree ${topHubs[0]?.[1] ?? 0})
* **Open Findings:** ${findings.length} (${criticalFindings.length} critical/high)
${system && system.architecture.stores.length > 1 ? `* **System Architecture:** ${system.architecture.totals.stores} datastores · ${system.architecture.totals.links} cross-store links · score ${system.architecture.score}/100` : ""}

Try asking about a specific table (e.g. \`${primaryTable?.name ?? "users"}\`), a specific rule (e.g. \`${findings[0]?.ruleId ?? "PG-SCHEMA-001"}\`), multi-schema boundaries, indexes, partitioning, Redis TTLs, or open **AI Handoff** to export this exact context to ChatGPT / Claude / Cursor.`,
    citations,
  };
}

function groundedPrompt(question: string, model: SchemaModel, findings: Finding[], meta: AIModelMeta, system?: SystemAIContext) {
  const archChunk = system && system.architecture.stores.length > 1
    ? `\nSystem Architecture (${system.architecture.totals.stores} stores, score ${system.architecture.score}/100):\nStores: ${JSON.stringify(system.architecture.stores.map((s) => ({ name: s.name, engine: s.engine, role: s.role, namespaces: s.namespaces.length, entities: s.entities })))}\nFlows: ${JSON.stringify(system.flows)}\nArch Findings: ${JSON.stringify(system.architecture.findings.map((f) => [f.ruleId, f.severity, f.object, f.title]))}`
    : "";
  return `You are a senior database architect. Mode: ${meta.name} (${meta.specialty}).
Answer ONLY from the schema, findings and architecture below. Never invent tables, columns, indexes or statistics. Cite object names and rule IDs.
Engine: ${model.engine}; database: ${model.database}; namespaces: ${JSON.stringify(model.namespaces)}
Entities: ${JSON.stringify(model.entities.map((e) => ({ name: e.name, kind: e.kind, fields: e.fields.map((f) => [f.name, f.type, f.isPrimaryKey ? "pk" : ""]), indexes: e.indexes.map((i) => [i.name, i.columns]) })))}
Relationships: ${JSON.stringify(model.relationships.map((r) => [r.fromEntity, r.fromColumns, r.toEntity, r.provenance]))}
Findings: ${JSON.stringify(findings.map((f) => [f.ruleId, f.severity, f.object, f.title, f.evidenceLevel]))}${archChunk}

Question: ${question}
Respond in Markdown with short headed sections.`;
}

async function callAnthropic(apiKey: string, modelId: string, question: string, model: SchemaModel, findings: Finding[], meta: AIModelMeta, system?: SystemAIContext) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: modelId, max_tokens: 2000, messages: [{ role: "user", content: groundedPrompt(question, model, findings, meta, system) }] }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const text = data.content?.[0]?.text;
  return text ? { answer: text as string, citations: model.entities.slice(0, 5).map((e) => e.name) } : null;
}

async function callOpenAI(apiKey: string, modelId: string, question: string, model: SchemaModel, findings: Finding[], meta: AIModelMeta, system?: SystemAIContext) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelId, max_tokens: 2000, messages: [{ role: "user", content: groundedPrompt(question, model, findings, meta, system) }] }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content;
  return text ? { answer: text as string, citations: model.entities.slice(0, 5).map((e) => e.name) } : null;
}
