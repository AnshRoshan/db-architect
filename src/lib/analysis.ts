import { SchemaModel, Severity, EvidenceLevel } from "./schema-model";
import { isRelational } from "./engines";

// ─── Deterministic rule engine ─────────────────────────────────────
// Every finding: rule_id, category, severity, title, object, evidence,
// explanation, recommendation, confidence (0-100, computed), requires_workload,
// limitations, evidence_level. Confidence is computed from evidence strength,
// never arbitrary: base per rule + adjustments, clamped, documented.

export interface Finding {
  ruleId: string;
  category: "index" | "constraint" | "relationship" | "performance" | "structure" | "document" | "type" | "security";
  severity: Severity;
  title: string;
  object: string;
  evidence: Record<string, unknown>;
  explanation: string;
  recommendation: string;
  confidence: number;
  requiresWorkload: boolean;
  limitations: string[];
  evidenceLevel: EvidenceLevel;
  benefit?: string;
  tradeoff?: string;
}

export interface AnalysisSummary {
  entities: number;
  fields: number;
  indexes: number;
  relationships: number;
  findingsBySeverity: Record<string, number>;
  designScore: number; // 0-100 heuristic, documented as heuristic
  limitations: string[];
}

function conf(base: number, adj: number[] = []): number {
  const v = base + adj.reduce((a, b) => a + b, 0);
  return Math.max(5, Math.min(98, Math.round(v)));
}

const NO_WORKLOAD = "No workload/query statistics were available; recommendation is schema-heuristic and must be validated against real query patterns.";

export function analyzeModel(model: SchemaModel): { findings: Finding[]; summary: AnalysisSummary } {
  const findings: Finding[] = [];
  if (isRelational(model.engine)) {
    findings.push(...pgStructural(model), ...pgIndexes(model), ...pgPerformance(model), ...sqlCommon(model));
    if (model.engine === "mysql") findings.push(...mysqlRules(model));
    if (model.engine === "sqlite") findings.push(...sqliteRules(model));
    // Shared relational rules were authored against PostgreSQL; re-label per engine.
    const prefix = model.engine === "mysql" ? "MY-" : model.engine === "sqlite" ? "SQLITE-" : null;
    if (prefix) for (const f of findings) f.ruleId = f.ruleId.replace(/^PG-/, prefix);
  } else {
    findings.push(...mgDocuments(model), ...mgIndexes(model), ...mgPerformance(model));
  }
  findings.push(...relationshipChecks(model));

  const by: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) by[f.severity] = (by[f.severity] ?? 0) + 1;
  const penalty = (by.critical ?? 0) * 12 + (by.high ?? 0) * 6 + (by.medium ?? 0) * 3 + (by.low ?? 0) * 1;
  const designScore = Math.max(5, Math.min(100, 100 - penalty));
  return {
    findings: findings.sort((a, b) => sevRank(a.severity) - sevRank(b.severity)),
    summary: {
      entities: model.entities.length,
      fields: model.entities.reduce((a, e) => a + e.fields.length, 0),
      indexes: model.entities.reduce((a, e) => a + e.indexes.length, 0),
      relationships: model.relationships.length,
      findingsBySeverity: by,
      designScore,
      limitations: model.sourceMetadata.limitations.length
        ? model.sourceMetadata.limitations
        : ["Schema-evidence only unless statistics/workload provided."],
    },
  };
}

function sevRank(s: Severity): number {
  return { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[s];
}

// ─── PostgreSQL structural ─────────────────────────────────────────
function pgStructural(m: SchemaModel): Finding[] {
  const out: Finding[] = [];
  for (const e of m.entities) {
    if (e.kind !== "table") continue;
    const hasPk = e.constraints.some((c) => c.kind === "primary_key");
    const pkCols = new Set(e.constraints.filter((c) => c.kind === "primary_key").flatMap((c) => c.columns));
    if (!hasPk) {
      out.push({
        ruleId: "PG-CONST-001",
        category: "constraint",
        severity: "high",
        title: "Table without primary key",
        object: e.name,
        evidence: { fields: e.fields.map((f) => f.name) },
        explanation: `${e.name} has no PRIMARY KEY. Without a stable row identifier, updates, deletes, replication and ORM tooling are unreliable.`,
        recommendation: "Add a PRIMARY KEY — typically a generated UUID/identity column, or a verified natural key.",
        confidence: conf(88),
        requiresWorkload: false,
        limitations: [],
        evidenceLevel: "schema",
        benefit: "Row identity, safer replication and deletes.",
        tradeoff: "Adds a unique index (write + storage cost).",
      });
    }
    // nullable identifier-looking columns
    for (const f of e.fields) {
      if (/^(id|uuid|guid)$/i.test(f.name) && f.nullable && !f.isPrimaryKey) {
        out.push({
          ruleId: "PG-CONST-002",
          category: "constraint",
          severity: "medium",
          title: "Nullable identifier column",
          object: `${e.name}.${f.name}`,
          evidence: { column: f.name, type: f.type, nullable: true },
          explanation: `Identifier-like column ${f.name} is nullable. Identifiers should almost always be NOT NULL.`,
          recommendation: "Backfill NULLs, then ALTER COLUMN SET NOT NULL; consider PRIMARY KEY or UNIQUE NOT NULL.",
          confidence: conf(80),
          requiresWorkload: false,
          limitations: [],
          evidenceLevel: "schema",
        });
      }
    }
    // inconsistent types across FK
    for (const c of e.constraints.filter((x) => x.kind === "foreign_key")) {
      const target = m.entities.find((t) => t.name === c.referencedEntity);
      if (!target) continue;
      c.columns.forEach((col, i) => {
        const src = e.fields.find((f) => f.name === col);
        const dstCol = (c.referencedColumns ?? [])[i] ?? (c.referencedColumns ?? [])[0];
        const dst = target.fields.find((f) => f.name === dstCol);
        if (src && dst && normType(src.type) !== normType(dst.type)) {
          out.push({
            ruleId: "PG-TYPE-001",
            category: "type",
            severity: "high",
            title: "Foreign key type mismatch",
            object: `${e.name}.${col}`,
            evidence: { source: `${e.name}.${col} (${src.type})`, target: `${target.name}.${dst.name} (${dst.type})` },
            explanation: `FK column type (${src.type}) differs from referenced column type (${dst.type}). Mismatched types force casts, can defeat index usage and risk failed inserts.`,
            recommendation: `Align both sides to the same type (e.g. uuid ↔ uuid, bigint ↔ bigint) via a planned ALTER COLUMN with USING cast.`,
            confidence: conf(90),
            requiresWorkload: false,
            limitations: [],
            evidenceLevel: "schema",
          });
        }
      });
    }
    // text-as-enum heuristic
    for (const f of e.fields) {
      if (/^(status|state|role|type|kind|category)$/i.test(f.name) && /^text|varchar|character/i.test(f.type) && !f.isPrimaryKey) {
        const hasCheck = e.constraints.some((c) => c.kind === "check" && (c.definition ?? "").includes(f.name));
        if (!hasCheck) {
          out.push({
            ruleId: "PG-TYPE-002",
            category: "type",
            severity: "low",
            title: "Unconstrained status-like text column",
            object: `${e.name}.${f.name}`,
            evidence: { column: f.name, type: f.type },
            explanation: `${f.name} looks like a constrained vocabulary stored as free text with no CHECK constraint or enum. Typos create silent data corruption.`,
            recommendation: "Add a CHECK constraint, a native ENUM, or a lookup table depending on churn.",
            confidence: conf(55),
            requiresWorkload: false,
            limitations: ["Heuristic based on column naming; confirm domain before changing."],
            evidenceLevel: "heuristic",
          });
        }
      }
    }
    // timestamp without timezone
    for (const f of e.fields) {
      if (m.engine === "postgres" && /timestamp(?!.*zone)|datetime/i.test(f.type) && !/with time zone|tz/i.test(f.type)) {
        out.push({
          ruleId: "PG-TYPE-003",
          category: "type",
          severity: "low",
          title: "Timestamp without time zone",
          object: `${e.name}.${f.name}`,
          evidence: { column: f.name, type: f.type },
          explanation: "timestamp without time zone stores no zone; app servers in different zones interpret it differently.",
          recommendation: "Prefer timestamptz for event times; keep wall-clock local times only where the domain demands it.",
          confidence: conf(60),
          requiresWorkload: false,
          limitations: [],
          evidenceLevel: "schema",
        });
        break; // one per table to avoid noise
      }
    }
  }
  // orphan FK-like naming without constraint (heuristic, low confidence)
  const allNames = new Set(m.entities.map((e) => e.name));
  void allNames;
  void pkColsUnused(pkColsCheck(m));
  return out;
}
function pkColsCheck(_m: SchemaModel): unknown {
  return null;
}
function pkColsUnused(_x: unknown): unknown {
  return null;
}

// ─── PostgreSQL index rules ────────────────────────────────────────
function pgIndexes(m: SchemaModel): Finding[] {
  const out: Finding[] = [];
  for (const e of m.entities) {
    const idxs = e.indexes;
    // duplicate indexes
    for (let i = 0; i < idxs.length; i++) {
      for (let j = i + 1; j < idxs.length; j++) {
        const a = idxs[i];
        const b = idxs[j];
        if (sameCols(a.columns, b.columns) && a.method === b.method && (a.predicate ?? null) === (b.predicate ?? null)) {
          out.push({
            ruleId: "PG-INDEX-001",
            category: "index",
            severity: "medium",
            title: "Duplicate indexes",
            object: e.name,
            evidence: { indexes: [a.name, b.name], columns: a.columns },
            explanation: `Indexes ${a.name} and ${b.name} cover identical columns with the same method. One is pure write/storage overhead.`,
            recommendation: `Review usage (pg_stat_user_indexes) then DROP one. Keep the one backing a constraint if applicable.`,
            confidence: conf(85),
            requiresWorkload: true,
            limitations: [NO_WORKLOAD],
            evidenceLevel: "schema",
            tradeoff: "Dropping an index can regress queries that relied on its specific ordering/visibility.",
          });
        } else if (isPrefix(a.columns, b.columns) || isPrefix(b.columns, a.columns)) {
          const [narrow, wide] = a.columns.length <= b.columns.length ? [a, b] : [b, a];
          if (!narrow.unique && !wide.partial && !wide.expression) {
            out.push({
              ruleId: "PG-INDEX-002",
              category: "index",
              severity: "low",
              title: "Potentially redundant (prefix-covered) index",
              object: e.name,
              evidence: { narrower: narrow.name, wider: wide.name, narrowCols: narrow.columns, wideCols: wide.columns },
              explanation: `${narrow.name} (${narrow.columns.join(", ")}) is a left-prefix of ${wide.name} (${wide.columns.join(", ")}). The wider btree can usually serve prefix queries.`,
              recommendation: "Check workload: if no query specifically needs the narrower ordering, drop it. Keep UNIQUE indexes that enforce constraints.",
              confidence: conf(62),
              requiresWorkload: true,
              limitations: [NO_WORKLOAD, "Prefix redundancy assumes btree; GIN/GiST/BRIN behave differently."],
              evidenceLevel: "schema",
            });
          }
        }
      }
    }
    // unindexed FK columns
    for (const c of e.constraints.filter((x) => x.kind === "foreign_key")) {
      const covered = e.indexes.some((ix) => ix.columns[0] === c.columns[0]);
      const pkCovered = e.constraints.some((k) => k.kind === "primary_key" && k.columns[0] === c.columns[0]);
      if (!covered && !pkCovered) {
        out.push({
          ruleId: "PG-INDEX-003",
          category: "index",
          severity: "low",
          title: "Foreign-key column without supporting index — review candidate",
          object: `${e.name}.${c.columns.join(",")}`,
          evidence: { constraint: c.name, columns: c.columns, existingIndexes: e.indexes.map((i) => i.name) },
          explanation: `FK ${c.name} has no index with its leading column. This does NOT automatically mean an index is needed — it matters for joins filtering on the child side and for parent-side DELETE/UPDATE cascades that must probe the child.`,
          recommendation: "Review: if you join/filter on this column or the parent row is frequently deleted/updated, evaluate CREATE INDEX. Otherwise leave it — indexes cost writes.",
          confidence: conf(48),
          requiresWorkload: true,
          limitations: [NO_WORKLOAD, "Only recommend after checking query patterns and parent-write frequency."],
          evidenceLevel: "heuristic",
        });
      }
    }
    // low-selectivity boolean single-col index heuristic
    for (const ix of idxs) {
      if (ix.columns.length === 1 && !ix.unique && !ix.partial) {
        const f = e.fields.find((x) => x.name === ix.columns[0]);
        if (f && /^bool/i.test(f.type)) {
          out.push({
            ruleId: "PG-INDEX-004",
            category: "index",
            severity: "low",
            title: "Low-selectivity single-column index candidate",
            object: `${e.name}.${ix.name}`,
            evidence: { index: ix.name, column: f.name, type: f.type },
            explanation: `Single-column index on boolean ${f.name} alone rarely pays: it selects ~half the table, so the planner will usually seq-scan anyway. Partial indexes (WHERE flag) are typically better.`,
            recommendation: `Evaluate replacing with a partial index, e.g. CREATE INDEX … ON ${e.name}(…) WHERE ${f.name} IS TRUE — only if queries filter that slice.`,
            confidence: conf(58),
            requiresWorkload: true,
            limitations: [NO_WORKLOAD],
            evidenceLevel: "heuristic",
          });
        }
      }
    }
    // composite ordering heuristic: equality cols should precede range cols — flag when low-cardinality-looking first col
    for (const ix of idxs.filter((x) => x.columns.length >= 2 && !x.unique)) {
      const first = e.fields.find((f) => f.name === ix.columns[0]);
      if (first && /^bool/i.test(first.type)) {
        out.push({
          ruleId: "PG-INDEX-005",
          category: "index",
          severity: "low",
          title: "Composite index leading with low-selectivity column",
          object: `${e.name}.${ix.name}`,
          evidence: { index: ix.name, columns: ix.columns },
          explanation: `Composite index leads with boolean ${first.name}. Btree efficiency usually comes from highly selective equality columns first.`,
          recommendation: "Review predicate order against real queries; consider reordering so equality/selective columns lead.",
          confidence: conf(52),
          requiresWorkload: true,
          limitations: [NO_WORKLOAD],
          evidenceLevel: "heuristic",
        });
      }
    }
  }
  return out;
}

function pgPerformance(m: SchemaModel): Finding[] {
  const out: Finding[] = [];
  for (const e of m.entities) {
    if (e.fields.length > 40) {
      out.push({
        ruleId: "PG-PERF-001",
        category: "performance",
        severity: "medium",
        title: "Very wide table",
        object: e.name,
        evidence: { columnCount: e.fields.length },
        explanation: `${e.name} has ${e.fields.length} columns. Very wide tables complicate caching, TOAST behavior and maintainability; often a sign of merged concerns.`,
        recommendation: "Review for vertical partitioning: split rarely-used/large columns (JSON blobs, audit trails) into a companion table.",
        confidence: conf(65),
        requiresWorkload: false,
        limitations: [],
        evidenceLevel: "schema",
        tradeoff: "Splitting adds joins; only worthwhile when access patterns differ.",
      });
    }
    const jsonCols = e.fields.filter((f) => /^json/i.test(f.type));
    if (jsonCols.length > 3) {
      out.push({
        ruleId: "PG-PERF-002",
        category: "performance",
        severity: "low",
        title: "Heavy JSONB usage",
        object: e.name,
        evidence: { jsonColumns: jsonCols.map((f) => f.name) },
        explanation: "Multiple schemaless JSON columns in one row reduce constraint enforcement and make indexing/querying ad-hoc.",
        recommendation: "Promote stable JSON keys to real columns with types + constraints; keep JSONB for genuinely flexible payload; add GIN indexes only where queried.",
        confidence: conf(55),
        requiresWorkload: true,
        limitations: [NO_WORKLOAD],
        evidenceLevel: "schema",
      });
    }
    if (e.constraints.filter((c) => c.kind === "foreign_key").length > 8) {
      out.push({
        ruleId: "PG-PERF-003",
        category: "performance",
        severity: "info",
        title: "Highly connected table",
        object: e.name,
        evidence: { fkCount: e.constraints.filter((c) => c.kind === "foreign_key").length },
        explanation: "Many foreign keys make this a join hub. Not a problem by itself, but deletes/updates fan out and diagrams get dense.",
        recommendation: "Document delete cascades; ensure supporting indexes exist where parent writes are frequent.",
        confidence: conf(70),
        requiresWorkload: false,
        limitations: [],
        evidenceLevel: "schema",
      });
    }
  }
  return out;
}

// ─── Mongo rules ───────────────────────────────────────────────────
function mgDocuments(m: SchemaModel): Finding[] {
  const out: Finding[] = [];
  for (const e of m.entities) {
    for (const f of e.fields) {
      if (f.bsonTypes && f.bsonTypes.length > 1) {
        const sev: Severity = f.bsonTypes.includes("null") && f.bsonTypes.length === 2 ? "low" : "medium";
        out.push({
          ruleId: "MG-DOC-001",
          category: "document",
          severity: sev,
          title: "Inconsistent field types across documents",
          object: `${e.name}.${f.name}`,
          evidence: { bsonTypes: f.bsonTypes, presence: f.presence },
          explanation: `${f.name} appears with multiple BSON types (${f.bsonTypes.join(", ")}). Mixed types break sorting, range queries and typed drivers.`,
          recommendation: "Standardize on one type; migrate legacy values with a document-migration script; add $jsonSchema validation.",
          confidence: conf(78, [f.presence !== undefined ? 5 : 0]),
          requiresWorkload: false,
          limitations: ["Observed from sampled documents only."],
          evidenceLevel: "sample",
        });
      }
      if (f.presence !== undefined && f.presence < 0.5 && f.presence > 0) {
        out.push({
          ruleId: "MG-DOC-002",
          category: "document",
          severity: "low",
          title: "Highly optional field",
          object: `${e.name}.${f.name}`,
          evidence: { presence: f.presence },
          explanation: `${f.name} is present in only ~${Math.round((f.presence ?? 0) * 100)}% of sampled documents. Sparse fields are fine but worth documenting.`,
          recommendation: "Document whether absence means false/unknown; consider defaults or sparse indexes if queried.",
          confidence: conf(60),
          requiresWorkload: false,
          limitations: ["Presence estimated from sample."],
          evidenceLevel: "sample",
        });
      }
      if (f.nested && f.nested.length > 12) {
        out.push({
          ruleId: "MG-DOC-003",
          category: "document",
          severity: "medium",
          title: "Large nested document",
          object: `${e.name}.${f.name}`,
          evidence: { nestedFields: f.nested.length },
          explanation: `Embedded object ${f.name} has ${f.nested.length} sub-fields. Large embedded objects bloat every parent read and risk the 16MB document limit.`,
          recommendation: "Evaluate extracting independently-accessed or growing sub-data into a referenced collection.",
          confidence: conf(62),
          requiresWorkload: true,
          limitations: [NO_WORKLOAD, "Size estimated by shape, not measured bytes."],
          evidenceLevel: "sample",
        });
      }
      if (f.isArray && /log|event|comment|message|history|audit/i.test(f.name)) {
        out.push({
          ruleId: "MG-DOC-004",
          category: "document",
          severity: "high",
          title: "Potentially unbounded array",
          object: `${e.name}.${f.name}`,
          evidence: { field: f.name, arrayOf: f.arrayOf },
          explanation: `Array ${f.name} looks append-only (${f.arrayOf ?? "mixed"}). Unbounded arrays grow documents without limit, cause moves on update and hit the 16MB cap.`,
          recommendation: "Move to a child collection with { parentId, ts } + index, or cap with $slice and archive old entries.",
          confidence: conf(66),
          requiresWorkload: true,
          limitations: ["Growth inferred from naming; confirm with counts/max sizes."],
          evidenceLevel: "heuristic",
          tradeoff: "Referencing costs an extra query; embedding is faster while small.",
        });
      }
    }
    const hasValidator = e.metadata?.validator;
    if (!hasValidator && e.fields.length > 0) {
      out.push({
        ruleId: "MG-VALID-001",
        category: "constraint",
        severity: "medium",
        title: "Collection without validation rules",
        object: e.name,
        evidence: { fields: e.fields.length },
        explanation: `${e.name} has no $jsonSchema validator. Without validation, any shape can be inserted and drift accumulates silently.`,
        recommendation: "Add a validator with required fields, bsonTypes and enums for stable keys; use validationLevel moderate during rollout.",
        confidence: conf(75),
        requiresWorkload: false,
        limitations: [],
        evidenceLevel: "schema",
      });
    }
  }
  return out;
}

function mgIndexes(m: SchemaModel): Finding[] {
  const out: Finding[] = [];
  for (const e of m.entities) {
    for (let i = 0; i < e.indexes.length; i++) {
      for (let j = i + 1; j < e.indexes.length; j++) {
        const a = e.indexes[i];
        const b = e.indexes[j];
        if (sameCols(a.columns, b.columns)) {
          out.push({
            ruleId: "MG-INDEX-001",
            category: "index",
            severity: "medium",
            title: "Duplicate MongoDB indexes",
            object: e.name,
            evidence: { indexes: [a.name, b.name] },
            explanation: `Indexes ${a.name} and ${b.name} cover the same keys. Each costs writes, memory and disk.`,
            recommendation: "Drop one after confirming no query depends on its name/options (TTL, partial filter, collation).",
            confidence: conf(85),
            requiresWorkload: true,
            limitations: [NO_WORKLOAD],
            evidenceLevel: "schema",
          });
        } else if (isPrefix(a.columns, b.columns)) {
          out.push({
            ruleId: "MG-INDEX-002",
            category: "index",
            severity: "low",
            title: "Compound index covers prefix — review single-field index",
            object: e.name,
            evidence: { prefix: a.columns, compound: b.columns },
            explanation: `Compound index on (${b.columns.join(", ")}) can serve queries on its left prefix (${a.columns.join(", ")}). A separate single-field index may be redundant — unless sort direction or ESR ordering matters.`,
            recommendation: "Verify with explain(): if the compound index satisfies equality→sort→range (ESR), drop the redundant prefix index.",
            confidence: conf(60),
            requiresWorkload: true,
            limitations: [NO_WORKLOAD, "Prefix coverage depends on sort direction and selectivity."],
            evidenceLevel: "schema",
          });
        }
      }
    }
    // missing _id uniqueness is automatic; check FK-ish fields without index
    for (const f of e.fields) {
      if (/user_id|_id$|Id$/.test(f.name) && f.name !== "_id") {
        const covered = e.indexes.some((ix) => ix.columns[0] === f.name);
        if (!covered && (f.presence ?? 1) > 0.3) {
          out.push({
            ruleId: "MG-INDEX-003",
            category: "index",
            severity: "low",
            title: "Reference-like field without index — review candidate",
            object: `${e.name}.${f.name}`,
            evidence: { field: f.name },
            explanation: `${f.name} looks like a reference key with no supporting index. Whether it needs one depends on query patterns — do NOT index every *_id blindly.`,
            recommendation: "If you filter/sort/join($lookup) on this field, evaluate an index (possibly compound with time). Otherwise skip it.",
            confidence: conf(45),
            requiresWorkload: true,
            limitations: [NO_WORKLOAD],
            evidenceLevel: "heuristic",
          });
          break;
        }
      }
    }
  }
  return out;
}

function mgPerformance(m: SchemaModel): Finding[] {
  const out: Finding[] = [];
  for (const e of m.entities) {
    if (e.fields.length > 50) {
      out.push({
        ruleId: "MG-PERF-001",
        category: "performance",
        severity: "medium",
        title: "Very wide document shape",
        object: e.name,
        evidence: { fields: e.fields.length },
        explanation: `${e.fields.length} top-level keys means large working set per document; reads pay for fields they don't need.`,
        recommendation: "Split hot vs cold paths: keep hot fields in the main doc, move archival/blob data out; use projection aggressively.",
        confidence: conf(60),
        requiresWorkload: true,
        limitations: [NO_WORKLOAD],
        evidenceLevel: "sample",
      });
    }
  }
  // embedding vs referencing guidance (per relationship)
  for (const r of m.relationships.filter((x) => x.provenance !== "explicit")) {
    out.push({
      ruleId: "MG-PERF-002",
      category: "relationship",
      severity: "info",
      title: "Embedding vs referencing — review inferred reference",
      object: `${r.fromEntity} → ${r.toEntity}`,
      evidence: { from: r.fromColumns, to: r.toColumns, confidence: r.confidence },
      explanation: `Inferred link ${r.fromEntity}.${r.fromColumns.join(",")} → ${r.toEntity} (confidence ${Math.round((r.confidence ?? 0.5) * 100)}%) is NOT a constraint. Embed when child is small, bounded, always read with parent and needs atomic updates; reference when it grows unbounded, is shared, or queried alone.`,
      recommendation: "Confirm with the team whether this is a true reference; document the decision and add validation/index accordingly.",
      confidence: conf(55),
      requiresWorkload: true,
      limitations: ["Inference from field naming/shape only."],
      evidenceLevel: "heuristic",
    });
  }
  return out;
}

function relationshipChecks(m: SchemaModel): Finding[] {
  const out: Finding[] = [];
  // many-to-many detection via junction tables
  for (const e of m.entities) {
    const fks = e.constraints.filter((c) => c.kind === "foreign_key");
    if (fks.length === 2 && e.fields.length <= 6 && isRelational(m.engine)) {
      const targets = fks.map((f) => f.referencedEntity).filter(Boolean) as string[];
      if (targets.length === 2 && targets[0] !== targets[1]) {
        const rel = m.relationships.find((r) => r.fromEntity === e.name);
        void rel;
        out.push({
          ruleId: "PG-REL-001",
          category: "relationship",
          severity: "info",
          title: "Junction table (many-to-many)",
          object: e.name,
          evidence: { links: targets },
          explanation: `${e.name} links ${targets.join(" ↔ ")} with two FKs — the classic many-to-many junction pattern.`,
          recommendation: "Ensure composite PK/UNIQUE on the pair, indexes on both FK columns, and decide ON DELETE behavior explicitly.",
          confidence: conf(85),
          requiresWorkload: false,
          limitations: [],
          evidenceLevel: "schema",
        });
      }
    }
  }
  // self-reference
  for (const r of m.relationships) {
    if (r.fromEntity === r.toEntity) {
      out.push({
        ruleId: "PG-REL-002",
        category: "relationship",
        severity: "info",
        title: "Self-referencing relationship",
        object: r.fromEntity,
        evidence: { columns: r.fromColumns },
        explanation: `Hierarchical pattern on ${r.fromEntity} (${r.fromColumns.join(", ")}). Recursive queries need WITH RECURSIVE or ltree/closure tables at scale.`,
        recommendation: "For deep trees, evaluate ltree, materialized path or closure table instead of adjacency list.",
        confidence: conf(80),
        requiresWorkload: false,
        limitations: [],
        evidenceLevel: "schema",
      });
    }
  }
  return out;
}

// ─── helpers ───────────────────────────────────────────────────────
function sameCols(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}
function isPrefix(short: string[], long: string[]): boolean {
  if (short.length >= long.length) return false;
  return short.every((c, i) => c === long[i]);
}
function normType(t: string): string {
  const s = t.toLowerCase().replace(/\(.*\)/, "").trim();
  const map: Record<string, string> = {
    int: "integer", integer: "integer", int4: "integer", serial: "integer",
    bigint: "bigint", int8: "bigint", bigserial: "bigint",
    smallint: "smallint", int2: "smallint",
    "character varying": "varchar", varchar: "varchar", char: "varchar", text: "text",
    boolean: "boolean", bool: "boolean",
    "timestamp with time zone": "timestamptz", timestamptz: "timestamptz",
    "timestamp without time zone": "timestamp", timestamp: "timestamp",
    "double precision": "double", float8: "double", real: "real", float4: "real",
    numeric: "numeric", decimal: "numeric",
  };
  return map[s] ?? s;
}


// ─── Shared relational rules (all SQL engines) ─────────────────────
function sqlCommon(m: SchemaModel): Finding[] {
  const out: Finding[] = [];
  for (const e of m.entities) {
    if (e.kind !== "table") continue;
    for (const f of e.fields) {
      if (/(price|amount|total|balance|cost|fee|salary|revenue|tax|discount)/i.test(f.name) && /\b(float|double|real)\b/i.test(f.type)) {
        out.push({
          ruleId: "PG-TYPE-020",
          category: "type",
          severity: "medium",
          title: "Floating-point type used for a monetary-looking column",
          object: `${e.name}.${f.name}`,
          evidence: { column: f.name, type: f.type },
          explanation: `${f.name} looks monetary but uses ${f.type}. Binary floating point cannot represent most decimal fractions exactly, so sums and comparisons drift.`,
          recommendation: "Use NUMERIC/DECIMAL with explicit precision, or store integer minor units (cents).",
          confidence: conf(70),
          requiresWorkload: false,
          limitations: ["Detected from column naming; confirm the column really holds currency."],
          evidenceLevel: "heuristic",
        });
      }
    }
  }
  return out;
}

// ─── MySQL-specific rules ──────────────────────────────────────────
function mysqlRules(m: SchemaModel): Finding[] {
  const out: Finding[] = [];
  for (const e of m.entities) {
    if (e.kind !== "table") continue;
    const storage = String(e.metadata?.storageEngine ?? "");
    if (/^myisam$/i.test(storage)) {
      out.push({
        ruleId: "MY-ENGINE-001",
        category: "structure",
        severity: "high",
        title: "Table uses the MyISAM storage engine",
        object: e.name,
        evidence: { storageEngine: storage },
        explanation: "MyISAM has no transactions, no foreign-key enforcement and is not crash-safe. A crash can corrupt the table and concurrent writes lock the whole table.",
        recommendation: "Convert to InnoDB (ALTER TABLE … ENGINE=InnoDB) after verifying FULLTEXT/GIS usage and taking a backup.",
        confidence: conf(92),
        requiresWorkload: false,
        limitations: [],
        evidenceLevel: "schema",
        tradeoff: "Conversion rebuilds the table; plan for lock time and disk space.",
      });
    }
    const cs = String(e.metadata?.charset ?? "");
    if (/^utf8(mb3)?$/i.test(cs)) {
      out.push({
        ruleId: "MY-CHARSET-001",
        category: "type",
        severity: "medium",
        title: "3-byte utf8 character set",
        object: e.name,
        evidence: { charset: cs },
        explanation: "MySQL's utf8/utf8mb3 stores at most 3 bytes per character, so emoji and some CJK characters are rejected or truncated.",
        recommendation: "Migrate to utf8mb4 with a modern collation (e.g. utf8mb4_0900_ai_ci).",
        confidence: conf(88),
        requiresWorkload: false,
        limitations: ["Index key-length limits change with utf8mb4."],
        evidenceLevel: "schema",
      });
    }
    const ts = e.fields.find((f) => /^timestamp\b/i.test(f.type));
    if (ts) {
      out.push({
        ruleId: "MY-TYPE-010",
        category: "type",
        severity: "low",
        title: "MySQL TIMESTAMP column (2038 limit, implicit defaults)",
        object: `${e.name}.${ts.name}`,
        evidence: { column: ts.name, type: ts.type },
        explanation: "TIMESTAMP is limited to 2038-01-19 and, depending on explicit_defaults_for_timestamp, may get implicit DEFAULT/ON UPDATE behaviour.",
        recommendation: "Prefer DATETIME(6) storing UTC for long-lived data, and declare defaults explicitly.",
        confidence: conf(62),
        requiresWorkload: false,
        limitations: ["Severity depends on the data's expected lifetime."],
        evidenceLevel: "schema",
      });
    }
  }
  return out;
}

// ─── SQLite-specific rules ─────────────────────────────────────────
function sqliteRules(m: SchemaModel): Finding[] {
  const out: Finding[] = [];
  const withFks = m.entities.filter((e) => e.constraints.some((c) => c.kind === "foreign_key"));
  if (withFks.length) {
    out.push({
      ruleId: "SQLITE-FK-001",
      category: "constraint",
      severity: "medium",
      title: "Foreign keys are declared but SQLite enforces them only on request",
      object: withFks.map((e) => e.shortName).slice(0, 4).join(", "),
      evidence: { tables: withFks.map((e) => e.name) },
      explanation: "SQLite ignores FOREIGN KEY clauses unless every connection runs PRAGMA foreign_keys = ON. Integrity then depends on application discipline.",
      recommendation: "Enable PRAGMA foreign_keys = ON at connection start (in your driver/ORM config) and test cascades.",
      confidence: conf(86),
      requiresWorkload: false,
      limitations: ["The pragma is per-connection runtime state and cannot be read from the schema."],
      evidenceLevel: "schema",
    });
  }
  if (m.entities.length) {
    out.push({
      ruleId: "SQLITE-TYPE-001",
      category: "type",
      severity: "info",
      title: "Flexible type affinity (consider STRICT tables)",
      object: m.database,
      evidence: { tables: m.entities.length },
      explanation: "Without STRICT tables SQLite stores any value in any column regardless of the declared type, so type bugs surface late.",
      recommendation: "Use CREATE TABLE … STRICT (SQLite 3.37+) for new tables and CHECK constraints for enumerations.",
      confidence: conf(70),
      requiresWorkload: false,
      limitations: [],
      evidenceLevel: "schema",
    });
  }
  return out;
}
