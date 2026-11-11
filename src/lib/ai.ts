import { SchemaModel } from "./schema-model";
import { Finding } from "./analysis";

// ─── Architecture assistant ────────────────────────────────────────
// Three analysis modes over the structured model + deterministic findings.
// By default answers come from a built-in, rule-grounded generator (no network,
// no invented objects). If ANTHROPIC_API_KEY or OPENAI_API_KEY is configured,
// the same grounded context is sent to that provider; the model id comes from
// ANTHROPIC_MODEL / OPENAI_MODEL and is reported back to the UI verbatim.

export type AIModelType = "architect" | "optimizer" | "operations";

export interface AIModelMeta {
  id: AIModelType;
  name: string;
  badge: string;
  specialty: string;
  description: string;
  engine?: string; // filled in per answer: "built-in" or the provider model id
}

export const AI_MODELS: Record<AIModelType, AIModelMeta> = {
  architect: { id: "architect", name: "Architecture review", badge: "Topology & integrity", specialty: "Hubs, domain boundaries, normalization vs embedding, failure domains", description: "Holistic review of the schema graph and its integrity rules." },
  optimizer: { id: "optimizer", name: "Query & index tuning", badge: "Access paths", specialty: "Index selectivity, compound key order (ESR), redundancy, write amplification", description: "Index and access-path review grounded in the findings." },
  operations: { id: "operations", name: "Operations & migrations", badge: "Zero-downtime changes", specialty: "Online DDL, lock budgets, partitioning, rollback safety", description: "Sequencing changes safely in production." },
};

function normalizeMode(m: string | undefined): AIModelType {
  if (m === "optimizer" || m === "fable-5.2-max") return "optimizer";
  if (m === "operations" || m === "frontier-dba") return "operations";
  return "architect";
}

export const SUGGESTED_QUESTIONS = [
  "Perform an exhaustive architectural & bottleneck audit",
  "Analyze index selectivity, redundancy & missing covering indexes",
  "Generate a zero-downtime online migration strategy",
  "Evaluate relational normalization vs document embedding for this schema",
  "Design a table partitioning and sharding roadmap for 100M+ rows",
  "Identify high-risk failure modes & lock contention vectors",
  "Which entities are the primary join/delete hubs?",
  "Recommend connection pool and query concurrency limits",
];

export function answerQuestion(
  question: string,
  model: SchemaModel,
  findings: Finding[],
  modelType: AIModelType = "architect"
): { answer: string; citations: string[] } {
  return generateFrontierResponse(question, model, findings, modelType);
}

export const AI_SUGGESTED_PROMPTS = [
  "Perform an exhaustive architectural & bottleneck audit",
  "Analyze index selectivity, redundancy & missing covering indexes",
  "Generate a zero-downtime online migration strategy",
  "Evaluate relational normalization vs document embedding for this schema",
  "Design a table partitioning and sharding roadmap for 100M+ rows",
  "Identify high-risk failure modes & lock contention vectors",
  "Which entities are the primary join/delete hubs?",
  "Recommend connection pool and query concurrency limits",
];

export async function askFrontierArchitect(
  question: string,
  model: SchemaModel,
  findings: Finding[],
  requested: string = "architect"
): Promise<{ answer: string; citations: string[]; model: AIModelMeta }> {
  const modelType = normalizeMode(requested);
  const meta = AI_MODELS[modelType];
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (anthropicKey && process.env.ANTHROPIC_MODEL) {
    try {
      const res = await callAnthropic(anthropicKey, process.env.ANTHROPIC_MODEL, question, model, findings, meta);
      if (res) return { ...res, model: { ...meta, engine: process.env.ANTHROPIC_MODEL } };
    } catch (err) { console.warn("[ai] provider call failed; using built-in generator", err); }
  } else if (openaiKey && process.env.OPENAI_MODEL) {
    try {
      const res = await callOpenAI(openaiKey, process.env.OPENAI_MODEL, question, model, findings, meta);
      if (res) return { ...res, model: { ...meta, engine: process.env.OPENAI_MODEL } };
    } catch (err) { console.warn("[ai] provider call failed; using built-in generator", err); }
  }
  const { answer, citations } = generateFrontierResponse(question, model, findings, modelType);
  return { answer, citations, model: { ...meta, engine: "built-in" } };
}

// ── Internal Frontier Architectural Generation Engine ───────────────────
function generateFrontierResponse(
  question: string,
  model: SchemaModel,
  findings: Finding[],
  modelType: AIModelType
): { answer: string; citations: string[] } {
  const q = question.toLowerCase();
  const citations: string[] = [];
  const entities = model.entities;
  const rels = model.relationships;
  const isDoc = model.engine === "mongodb";

  // Degree calculation for hubs
  const degreeMap = new Map<string, number>();
  for (const e of entities) degreeMap.set(e.name, 0);
  for (const r of rels) {
    degreeMap.set(r.fromEntity, (degreeMap.get(r.fromEntity) ?? 0) + 1);
    degreeMap.set(r.toEntity, (degreeMap.get(r.toEntity) ?? 0) + 1);
  }
  const hubs = [...degreeMap.entries()].sort((a, b) => b[1] - a[1]);
  const topHubs = hubs.slice(0, 4);

  // Critical/High findings
  const criticalFindings = findings.filter((f) => f.severity === "critical" || f.severity === "high");
  const indexFindings = findings.filter((f) => f.category === "index");

  // MODE A: EXHAUSTIVE ARCHITECTURAL & BOTTLENECK AUDIT
  if (/audit|architecture|bottleneck|overview|review|explain.*(database|system|schema)|health/.test(q)) {
    citations.push(...topHubs.map(([n]) => n), ...criticalFindings.map((f) => f.ruleId).slice(0, 4));

    return {
      answer: `### 🏛️ Executive Architecture Audit — ${model.database.toUpperCase()} (${model.engine.toUpperCase()})
**Mode:** ${AI_MODELS[modelType].name} · built-in, rule-grounded
**Overall Stability Grade:** ${criticalFindings.length > 2 ? "⚠️ Grade B- (High-Risk Hotspots Detected)" : "✅ Grade A (Solid Architectural Core)"}

---

#### 1. System Topology & Concurrency Graph
* **Total Entities Mapped:** ${entities.length} (${isDoc ? "Collections" : "Relational Tables"})
* **Active Relationships:** ${rels.length} (${rels.filter((r) => r.provenance === "explicit").length} explicit constraints, ${rels.filter((r) => r.provenance !== "explicit").length} inferred references)
* **Primary Hub Entities:**
${topHubs.map(([name, deg], i) => `  ${i + 1}. \`${name}\` — Connected degree: **${deg}** (${entities.find((e) => e.name === name)?.fields.length ?? 0} attributes)`).join("\n")}

> 💡 **Architectural Assessment:** \`${topHubs[0]?.[0] ?? "The central entity"}\` is your system's critical join and delete nexus. Any schema modification or lock contention here will fan out across the entire graph. Ensure cascade delete propagation is explicitly budgeted.

---

#### 2. Risk & Bottleneck Analysis
${
  criticalFindings.length
    ? criticalFindings
        .map(
          (f) => `* **[${f.severity.toUpperCase()}] ${f.title}** (\`${f.ruleId}\` on \`${f.object}\`)
  * *Mechanism:* ${f.explanation}
  * *Principal Remediation:* ${f.recommendation}`
        )
        .join("\n")
    : "* ✅ **No Critical Anti-Patterns Detected:** Primary keys and structural integrity constraints are correctly declared."
}

---

#### 3. Memory & B-Tree Storage Footprint
* **Index Inventory:** ${entities.reduce((a, e) => a + e.indexes.length, 0)} total index structures mapped across ${entities.length} entities.
${
  indexFindings.length
    ? `* ⚠️ **Optimization Opportunity:** Detected **${indexFindings.length}** index review candidates (e.g. \`${indexFindings[0]?.ruleId}\` on \`${indexFindings[0]?.object}\`). Pruning redundant compound prefixes reduces write amplification on high-churn tables (measure before and after).`
    : "* ✅ Indexes reflect lean selectivity without redundant compound prefix overlaps."
}

---

#### 4. Recommended 90-Day Engineering Roadmap
1. **Week 1–2 (Integrity):** Resolve constraint mismatches and enforce NOT NULL constraints on verified identifier keys.
2. **Week 3–4 (Access Paths):** Clean up duplicate index definitions using non-blocking online operations.
3. **Month 2 (Telemetry):** Enable \`pg_stat_statements\` (or MongoDB Profiler) to validate actual predicate cache hit rates.`,
      citations,
    };
  }

  // MODE B: INDEX SELECTIVITY, COMPOUND ESR & COVERING INDEXES
  if (/index|selectivity|covering|redundant|btree|esr|prefix/.test(q)) {
    citations.push(...indexFindings.map((f) => f.ruleId).slice(0, 5));

    return {
      answer: `### ⚡ Deep Index & Workload Access Path Review
**Mode:** ${AI_MODELS[modelType].name} · compound key selectivity (ESR)

---

#### 1. Compound Index Ordering (Equality → Sort → Range)
In B-tree traversal (${model.engine === "mongodb" ? "MongoDB WiredTiger" : "Relational PostgreSQL/MySQL"}), index efficiency follows strict prefix coverage:
1. **Equality columns first** (e.g. \`tenant_id\`, \`status\`, \`user_id\`)
2. **Sort columns second** (to eliminate expensive in-memory disk-spill Sort nodes)
3. **Range predicates last** (e.g. \`created_at >= NOW() - INTERVAL '7 days'\`)

---

#### 2. Specific Findings in this Schema
${
  indexFindings.length
    ? indexFindings
        .map(
          (f) => `##### \`${f.ruleId}\`: ${f.title} (${f.object})
* **Evidence:** \`${JSON.stringify(f.evidence)}\`
* **Root Cause:** ${f.explanation}
* **Prescription:** ${f.recommendation}
* **Trade-off:** ${f.tradeoff ?? "Slight write amplification vs query acceleration."}`
        )
        .join("\n\n")
    : "* All existing indexes exhibit unique leading column signatures. No duplicate btrees detected."
}

---

#### 3. Production Index Generation Recipe
\`\`\`sql
-- Example: Non-blocking covering index pattern for high-traffic read paths
-- (Leaves table heap undisturbed and avoids access exclusive locks)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_covering_sample
ON public.orders (user_id, status)
INCLUDE (total_cents, created_at);
\`\`\`
> ⚠️ **Principal Rule:** Never drop an index without verifying \`idx_scan = 0\` over a minimum of 14 days of sustained production traffic.`,
      citations,
    };
  }

  // MODE C: ZERO-DOWNTIME ONLINE MIGRATION STRATEGY
  if (/migration|downtime|lock|zero|safe|rollback|concurrent|deploy/.test(q)) {
    citations.push(...entities.slice(0, 3).map((e) => e.name));

    return {
      answer: `### 🛡️ Zero-Downtime Online Migration Playbook
**Framework:** Phased Expand-Contract Architecture
**Engine:** ${model.engine.toUpperCase()} Enterprise Protocol

---

#### Phase 1: Expand (Non-blocking Additive DDL)
1. **Add Columns as Nullable First:**
   Never add \`NOT NULL\` without a default directly to a live table. In PostgreSQL 11+, constant defaults are metadata-only, but historical rows must be considered.
   \`\`\`sql
   ALTER TABLE ${entities[0]?.name ?? "public.orders"} ADD COLUMN IF NOT EXISTS status_v2 text;
   \`\`\`
2. **Create Supporting Indexes Online:**
   \`\`\`sql
   -- CONCURRENTLY avoids AccessExclusiveLock (does not block concurrent reads or writes)
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_v2 ON ${entities[0]?.name ?? "public.orders"} (status_v2);
   \`\`\`
3. **Deferred Foreign Key Validation:**
   \`\`\`sql
   ALTER TABLE ${entities[0]?.name ?? "public.orders"} ADD CONSTRAINT fk_sample_v2
   FOREIGN KEY (user_id) REFERENCES public.users(id) NOT VALID;
   -- Validates rows sequentially with only a ShareUpdateExclusiveLock
   ALTER TABLE ${entities[0]?.name ?? "public.orders"} VALIDATE CONSTRAINT fk_sample_v2;
   \`\`\`

---

#### Phase 2: Dual-Writing & Micro-Batched Backfill
* The application writes to both columns/collections.
* Background worker backfills legacy rows in batches of **1,000–5,000** records with sleep intervals to keep replication lag at zero.

---

#### Phase 3: Contract (Safe Deprecation)
* Switch application reads to the new structure.
* Drop old indexes before dropping columns.
* Retain rollback script with verified script hash.`,
      citations,
    };
  }

  // MODE D: RELATIONAL VS DOCUMENT (EMBEDDING VS REFERENCING)
  if (/embed|reference|mongo|relational|document|normalize|denormalize/.test(q)) {
    citations.push(...rels.map((r) => `${r.fromEntity}→${r.toEntity}`).slice(0, 4));

    return {
      answer: `### 🔄 Document vs. Relational Architecture Analysis
**Domain Strategy:** Embedding vs. Referencing Decision Matrix

---

#### 1. When to EMBED (Co-location Pattern)
* **Bounded Cardinality:** Child records never exceed ~100–200 items per parent (e.g. order line items, address snapshots).
* **Unified Lifecycle:** Child records have no independent business meaning and are always loaded together.
* **Atomic Mutation:** Single-document ACID guarantees update parent and child in one atomic operation without two-phase commit.

#### 2. When to REFERENCE (Normalized Link Pattern)
* **Unbounded Growth:** Logs, event streams, comment feeds, activity history. Any array that grows indefinitely risks WiredTiger's **16MB BSON hard limit**.
* **Shared Ownership:** The entity is referenced by multiple distinct parents (e.g. \`users\`, \`products\`).
* **High-Churn Child Updates:** Updating an embedded child rewrites the entire parent document in memory and triggers disk fragmentation.

---

#### 3. Evaluation of Visible Relationships:
${
  rels.length
    ? rels
        .map(
          (r) => `* **\`${r.fromEntity}\` → \`${r.toEntity}\`** [${r.provenance}, confidence ${Math.round((r.confidence ?? 0.5) * 100)}%]
  * *Verdict:* ${
    /item|line|detail|address/i.test(r.fromEntity)
      ? "Strong candidate for **EMBEDDING** in parent document."
      : "Must remain a **SEPARATE COLLECTION (REFERENCED)** with indexed foreign keys."
  }`
        )
        .join("\n")
    : "* Standalone document collections mapped without explicit inter-collection join paths."
}`,
      citations,
    };
  }

  // MODE E: PARTITIONING & SHARDING AT SCALE (100M+ ROWS)
  if (/partition|shard|scale|massive|million|horizontal|terabyte/.test(q)) {
    citations.push(...entities.slice(0, 3).map((e) => e.name));

    return {
      answer: `### 📈 Large-Scale Partitioning & Sharding Architecture
**Scale Horizon:** 10M–500M+ Records | **Target:** Zero Read/Write Lock Amplification

---

#### 1. Range Partitioning Strategy (Time/Date Axis)
For tables containing event or transactional histories (\`orders\`, \`audit_logs\`, \`events\`):
\`\`\`sql
-- Convert monolithic table to declarative range partitioning by month
CREATE TABLE public.orders_partitioned (
  id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  total_cents integer NOT NULL,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Child monthly tables (enables instant partition DROP instead of costly bulk DELETE)
CREATE TABLE public.orders_2025_01 PARTITION OF public.orders_partitioned
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE public.orders_2025_02 PARTITION OF public.orders_partitioned
  FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
\`\`\`

---

#### 2. Shard Key Selection Criteria (MongoDB or Distributed SQL)
* **High Cardinality:** Never shard on low-cardinality values like \`status\` or \`country\`.
* **Write Dispersion:** Avoid monotonically increasing keys (\`_id\` timestamp or auto-increment) to prevent write-hotspotting on a single chunk.
* **Query Co-location:** Choose the key present in >80% of read queries (typically \`tenant_id\` or \`user_id\`) to ensure single-shard scatter/gather.`,
      citations,
    };
  }

  const meta = AI_MODELS[modelType] ?? AI_MODELS.architect;

  // DEFAULT TARGETED REASONING
  citations.push(...entities.slice(0, 5).map((e) => e.name));
  return {
    answer: `### 🧠 Enterprise Architectural Assessment
**Advising:** ${model.database} (${model.engine.toUpperCase()}) | **Mode:** ${meta.name}

---

#### Core Structural Invariants
* **Topology:** ${entities.length} entities mapped with ${rels.length} relationships.
* **Top Hub Entity:** \`${topHubs[0]?.[0] ?? "primary entity"}\` (degree: ${topHubs[0]?.[1] ?? 0})
* **Integrity Status:** ${findings.length} findings cataloged (${criticalFindings.length} critical/high).

#### Recommended Inquiry Paths:
* *"Perform an exhaustive architectural & bottleneck audit"*
* *"Analyze index selectivity, redundancy & missing covering indexes"*
* *"Generate a zero-downtime online migration strategy"*
* *"Evaluate relational normalization vs document embedding for this schema"*
* *"Design a table partitioning and sharding roadmap for 100M+ rows"*`,
    citations,
  };
}

// ── Optional external providers (grounded context only, never raw rows) ──
function groundedPrompt(question: string, model: SchemaModel, findings: Finding[], meta: AIModelMeta) {
  return `You are a senior database architect. Mode: ${meta.name} (${meta.specialty}).
Answer ONLY from the schema and findings below. Never invent tables, columns, indexes or statistics. Cite object names.
Engine: ${model.engine}; database: ${model.database}
Entities: ${JSON.stringify(model.entities.map((e) => ({ name: e.name, fields: e.fields.map((f) => [f.name, f.type, f.isPrimaryKey ? "pk" : ""]), indexes: e.indexes.map((i) => [i.name, i.columns]) })))}
Relationships: ${JSON.stringify(model.relationships.map((r) => [r.fromEntity, r.fromColumns, r.toEntity, r.provenance]))}
Findings: ${JSON.stringify(findings.map((f) => [f.ruleId, f.severity, f.object, f.title]))}

Question: ${question}
Respond in Markdown with short headed sections.`;
}

async function callAnthropic(apiKey: string, modelId: string, question: string, model: SchemaModel, findings: Finding[], meta: AIModelMeta) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: modelId, max_tokens: 2000, messages: [{ role: "user", content: groundedPrompt(question, model, findings, meta) }] }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const text = data.content?.[0]?.text;
  return text ? { answer: text as string, citations: model.entities.slice(0, 5).map((e) => e.name) } : null;
}

async function callOpenAI(apiKey: string, modelId: string, question: string, model: SchemaModel, findings: Finding[], meta: AIModelMeta) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelId, max_tokens: 2000, messages: [{ role: "user", content: groundedPrompt(question, model, findings, meta) }] }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content;
  return text ? { answer: text as string, citations: model.entities.slice(0, 5).map((e) => e.name) } : null;
}
