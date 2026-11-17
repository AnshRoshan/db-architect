import { load as yamlLoad } from "js-yaml";
import { analyzeModel, type Finding } from "./analysis";
import { analyzeArchitecture, FLOW_KINDS, isStoreRole, namespaceGraph, type ArchFinding, type ArchitectureReport, type FlowInput, type StoreInput, type StoreRole } from "./architecture";
import { diffModels, generateMigration, validateMigration, type SchemaDiff } from "./diff-migrate";
import { parseDsl, parseMongoJson, parseSqlDdl, validateModel } from "./dsl";
import { detectSqlDialect, engineLabel, isEngine, type Engine } from "./engines";
import { parseRedisDump } from "./redis-model";
import type { SchemaModel } from "./schema-model";

// â”€â”€â”€ AI Handoff, Portable Agent Skills & Round-Trip Verification â”€â”€â”€
// Lets teams using ChatGPT Plus, Claude Pro, Claude Code, Cursor, Codex or
// Gemini export clean, metadata-only context & Agent Skills (zero rows, zero
// credentials), and bring any AI proposal BACK into DB Architect for strict
// deterministic verification before applying anything.

export type HandoffFormat = "prompt_pack" | "skill_md" | "claude_md" | "cursor_mdc" | "agents_md" | "context_json";
export type HandoffTask = "redesign" | "fix_findings" | "migrate_engine" | "optimize_queries" | "security_tenancy" | "custom";
export type HandoffDetail = "compact" | "standard" | "full";
export type HandoffScope = "system" | "store";

export interface HandoffStoreInput {
  id: string;
  name: string;
  engine: string;
  role: string;
  description?: string | null;
  model: SchemaModel | null;
  findings: Finding[];
  designScore: number | null;
}

export interface HandoffExportInput {
  projectName: string;
  projectDescription?: string | null;
  stores: HandoffStoreInput[];
  flows: FlowInput[];
  architecture: ArchitectureReport;
  focusStoreId?: string | null;
  format: HandoffFormat;
  task: HandoffTask;
  scope: HandoffScope;
  detail: HandoffDetail;
  productRequirements?: string;
  targetEngine?: string;
}

export interface HandoffBundle {
  format: HandoffFormat;
  filename: string;
  mimeType: string;
  content: string;
  estimatedTokens: number;
  installHint: string;
  stats: {
    stores: number;
    schemas: number;
    entities: number;
    findings: number;
    rowsExported: 0;
    secretsExported: 0;
  };
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

const TASK_INSTRUCTIONS: Record<HandoffTask, { title: string; directive: string }> = {
  redesign: {
    title: "Architecture & Database Redesign",
    directive: "Redesign the schema and/or multi-datastore architecture to satisfy the product requirements while resolving the deterministic findings. Explain every structural trade-off, ownership boundary, data flow (CDC/outbox/cache-aside), and cutover step.",
  },
  fix_findings: {
    title: "Resolve Critical & High Findings",
    directive: "Fix every critical, high, and medium deterministic finding listed below (missing primary keys, schema cycles, duplicate indexes, type mismatches, non-expiring cache keys, undeclared cross-store copies) with minimal breaking changes and zero-downtime DDL.",
  },
  migrate_engine: {
    title: "Engine Migration Plan & Target Schema",
    directive: "Convert the database schema cleanly to the requested target engine. Account for lossy type conversions, embed-vs-reference decisions, deferred foreign keys, CDC/backfill strategy, and validation queries.",
  },
  optimize_queries: {
    title: "Query, Index & Keyspace Optimization",
    directive: "Review B-tree / GIN / compound index ordering (ESR), redundant indexes, unindexed foreign keys, partitioning candidates, and Redis keyspace TTL/memory sizing. Never recommend dropping an index without workload caveats.",
  },
  security_tenancy: {
    title: "Security, Multi-Tenancy & Compliance Hardening",
    directive: "Harden the database for multi-tenant isolation (tenant_id + PostgreSQL RLS), credential/PII protection, GDPR erasure across all stores, immutable audit logging, and least-privilege schema roles.",
  },
  custom: {
    title: "Custom Architecture Consultation",
    directive: "Follow the user's specific requirements below while respecting every schema, cross-store boundary and deterministic finding provided.",
  },
};

const PROPOSAL_CONTRACT = `\`\`\`db-architect-proposal
{
  "format": "db-architect/proposal/v1",
  "title": "Short title of your redesign",
  "summary": "2-3 sentence summary of key architectural changes and trade-offs",
  "targetEngine": "postgres",
  "rationale": [
    "Why change 1 fixes finding X or satisfies requirement Y"
  ],
  "sql": "CREATE SCHEMA IF NOT EXISTS auth;\\nCREATE TABLE auth.users (...);",
  "architectureChanges": {
    "stores": [
      { "name": "commerce-core", "engine": "postgres", "role": "primary", "description": "Authoritative OLTP store" }
    ],
    "flows": [
      { "from": "commerce-core", "to": "commerce-content", "kind": "cdc", "description": "Stream catalog updates via outbox/Debezium" }
    ]
  },
  "migrationNotes": [
    "Apply indexes CONCURRENTLY outside transactions",
    "Backfill nullable columns before SET NOT NULL"
  ]
}
\`\`\``;

function renderStoreCompact(s: HandoffStoreInput, detail: HandoffDetail): string {
  const L: string[] = [];
  const m = s.model;
  L.push(`### Datastore: \`${s.name}\` (${engineLabel(s.engine)} Â· role: \`${s.role}\`${s.designScore != null ? ` Â· design score: ${s.designScore}/100` : ""})`);
  if (s.description) L.push(`> ${s.description}`);
  if (!m) {
    L.push(`_No schema captured yet._`, ``);
    return L.join("\n");
  }
  const nsGraph = namespaceGraph(m);
  L.push(`- Database: \`${m.database}\`${m.version ? ` (v${m.version.split(" ")[0]})` : ""} Â· Namespaces (${m.namespaces.length}): ${m.namespaces.map((n) => `\`${n}\``).join(", ")}`);
  if (nsGraph.edges.length) {
    L.push(`- Cross-schema FKs: ${nsGraph.edges.map((e) => `\`${e.from}â†’${e.to}\` (Ã—${e.count})`).join(", ")}${nsGraph.cycles.length ? ` Â· âš ï¸ CYCLES: ${nsGraph.cycles.map(([a, b]) => `\`${a}â‡„${b}\``).join(", ")}` : ""}`);
  }
  if (m.catalog?.enums?.length) {
    L.push(`- Enums: ${m.catalog.enums.map((e) => `\`${e.namespace}.${e.name}\`(${e.values.join("|")})`).join(", ")}`);
  }
  if (m.catalog?.settings?.maxmemoryPolicy) {
    L.push(`- Settings: maxmemory-policy=\`${m.catalog.settings.maxmemoryPolicy}\``);
  }
  L.push(``);

  for (const e of m.entities) {
    const pkCols = new Set(e.constraints.filter((c) => c.kind === "primary_key").flatMap((c) => c.columns));
    const fkByCol = new Map<string, string>();
    for (const c of e.constraints.filter((x) => x.kind === "foreign_key")) {
      for (const col of c.columns) fkByCol.set(col, `${c.referencedEntity ?? "?"}(${(c.referencedColumns ?? ["id"]).join(",")})${c.onDelete ? ` ON DELETE ${c.onDelete}` : ""}`);
    }
    if (detail === "compact") {
      const cols = e.fields.map((f) => `${f.name}:${f.type}${f.isPrimaryKey || pkCols.has(f.name) ? " [PK]" : ""}${!f.nullable ? "" : "?"}${fkByCol.has(f.name) ? ` â†’${fkByCol.get(f.name)}` : ""}`).join(", ");
      const ttlMeta = e.kind === "keyspace" ? (e.metadata?.ttl as { known?: number; with?: number; avg?: number } | undefined) : undefined;
      const ttlHint = ttlMeta?.known ? ` | TTL: ${ttlMeta.with}/${ttlMeta.known}${ttlMeta.avg ? ` (~${ttlMeta.avg}s)` : " none"}` : "";
      L.push(`- **\`${e.name}\`** (${e.kind}${e.rowEstimate != null ? `, ~${e.rowEstimate}` : ""}): ${cols}${ttlHint}`);
      if (e.indexes.length) L.push(`  - indexes: ${e.indexes.map((ix) => `${ix.name}(${ix.columns.join(",")})${ix.unique ? " UQ" : ""}${ix.partial ? " PARTIAL" : ""}`).join("; ")}`);
    } else {
      L.push(`#### \`${e.name}\` (${e.kind}${e.rowEstimate != null ? ` Â· ~${e.rowEstimate.toLocaleString("en-US")} ${e.kind === "keyspace" ? "keys" : "rows"}` : ""})`);
      if (e.comment) L.push(`> ${e.comment}`);
      L.push(`| Column | Type | Null | Default | Key / Ref |`);
      L.push(`|---|---|---|---|---|`);
      for (const f of e.fields) {
        const flags = [f.isPrimaryKey || pkCols.has(f.name) ? "PK" : "", f.isUnique ? "UQ" : "", fkByCol.has(f.name) ? `FK â†’ ${fkByCol.get(f.name)}` : ""].filter(Boolean).join(", ");
        L.push(`| \`${f.name}\` | \`${f.type}\` | ${f.nullable ? "yes" : "NO"} | ${f.defaultValue ? `\`${f.defaultValue}\`` : "â€”"} | ${flags || "â€”"} |`);
      }
      if (e.indexes.length) L.push(`Indexes: ${e.indexes.map((ix) => `\`${ix.name}\` (${ix.columns.join(", ")})${ix.unique ? " UNIQUE" : ""}${ix.includeColumns?.length ? ` INCLUDE(${ix.includeColumns.join(",")})` : ""}${ix.predicate ? ` ${ix.predicate}` : ""} [${ix.method ?? "btree"}]`).join("; ")}`);
      const checks = e.constraints.filter((c) => c.kind === "check" && c.definition);
      if (checks.length) L.push(`Checks: ${checks.map((c) => `\`${c.name}\` (${c.definition})`).join("; ")}`);
      if (e.kind === "keyspace" && detail === "full") L.push(`Redis metadata: \`${JSON.stringify(e.metadata)}\``);
      L.push(``);
    }
  }
  if (s.findings.length) {
    const shown = detail === "compact" ? s.findings.filter((f) => f.severity !== "info").slice(0, 12) : s.findings.slice(0, 30);
    if (shown.length) {
      L.push(``, `**Open deterministic findings in \`${s.name}\` (${s.findings.length} total):**`);
      for (const f of shown) {
        L.push(`- [${f.severity.toUpperCase()}] \`${f.ruleId}\` on \`${f.object}\`: ${f.title} (${f.evidenceLevel}, ${f.confidence}%) â€” ${detail === "full" ? `${f.explanation} Action: ${f.recommendation}` : f.recommendation}`);
      }
    }
  }
  L.push(``);
  return L.join("\n");
}

function renderArchitectureSection(arch: ArchitectureReport, flows: FlowInput[], stores: HandoffStoreInput[]): string {
  if (stores.length <= 1) return "";
  const nameOf = (id: string) => stores.find((s) => s.id === id)?.name ?? id;
  const L: string[] = [
    `## System Architecture (${arch.totals.stores} datastores Â· ${arch.totals.engines} engines Â· score ${arch.score}/100)`,
    ``,
    `### Declared Data Flows (${flows.length})`,
    ...(flows.length ? flows.map((f) => `- \`${nameOf(f.fromStoreId)}\` â†’ \`${nameOf(f.toStoreId)}\` (\`${f.kind}\`)${f.description ? `: ${f.description}` : ""}`) : [`- None declared yet.`]),
    ``,
    `### Inferred Cross-Store Links (${arch.links.length} candidates â€” NOT database constraints)`,
    ...(arch.links.length
      ? arch.links.slice(0, 20).map((l) => `- [${l.kind}] \`${nameOf(l.fromStoreId)}.${l.fromEntity}${l.fromField ? `.${l.fromField}` : ""}\` â†’ \`${nameOf(l.toStoreId)}.${l.toEntity}${l.toField ? `.${l.toField}` : ""}\` (${Math.round(l.confidence * 100)}%${l.typeMismatch ? ", âš ï¸ TYPE MISMATCH" : ""})`)
      : [`- None inferred.`]),
    ``,
    `### Cross-Store Architecture Findings (${arch.findings.length})`,
    ...(arch.findings.length ? arch.findings.map((f) => `- [${f.severity.toUpperCase()}] \`${f.ruleId}\` (${f.object}): ${f.title} â€” ${f.recommendation}`) : [`- None.`]),
    ``,
  ];
  return L.join("\n");
}

export function buildHandoffExport(input: HandoffExportInput): HandoffBundle {
  const activeStores = input.scope === "store" && input.focusStoreId
    ? input.stores.filter((s) => s.id === input.focusStoreId)
    : input.stores;
  const stores = activeStores.length ? activeStores : input.stores;
  const slug = slugify(input.projectName);
  const schemasCount = stores.reduce((a, s) => a + (s.model?.namespaces.length ?? 0), 0);
  const entitiesCount = stores.reduce((a, s) => a + (s.model?.entities.length ?? 0), 0);
  const findingsCount = stores.reduce((a, s) => a + s.findings.length, 0) + (input.scope === "system" ? input.architecture.findings.length : 0);
  const stats = { stores: stores.length, schemas: schemasCount, entities: entitiesCount, findings: findingsCount, rowsExported: 0 as const, secretsExported: 0 as const };

  if (input.format === "context_json") {
    const payload = {
      format: "db-architect/context/v1",
      exportedAt: new Date().toISOString(),
      privacy: { metadataOnly: true, rowsExported: 0, credentialsExported: 0 },
      project: { name: input.projectName, description: input.projectDescription ?? null },
      task: input.task,
      productRequirements: input.productRequirements?.trim() || null,
      targetEngine: input.targetEngine || null,
      architecture: input.scope === "system" ? { score: input.architecture.score, totals: input.architecture.totals, flows: input.flows, links: input.architecture.links, findings: input.architecture.findings } : null,
      stores: stores.map((s) => ({ id: s.id, name: s.name, engine: s.engine, role: s.role, designScore: s.designScore, model: s.model, findings: s.findings })),
      proposalContract: { format: "db-architect/proposal/v1", supportedInputs: ["db-architect-proposal JSON block", "SQL DDL", "YAML/JSON DSL", "MongoDB collections JSON", "Redis key JSON"] },
    };
    const content = JSON.stringify(payload, null, 2);
    return {
      format: "context_json",
      filename: `db-architect-${slug}-context.json`,
      mimeType: "application/json",
      content,
      estimatedTokens: estimateTokens(content),
      installHint: "Feed into custom scripts, MCP tools, API pipelines, or attach directly as a file in ChatGPT / Claude.",
      stats,
    };
  }

  const schemaBlocks = stores.map((s) => renderStoreCompact(s, input.detail)).join("\n");
  const archBlock = input.scope === "system" ? renderArchitectureSection(input.architecture, input.flows, input.stores) : "";
  const taskMeta = TASK_INSTRUCTIONS[input.task];

  if (input.format === "skill_md") {
    const content = `---
name: db-architect-${slug}
description: Database architecture, multi-schema boundaries, cross-store contracts and safe migration skill for ${input.projectName}. Use whenever modifying schemas, writing queries, adding indexes, touching Redis keys, or planning migrations.
version: 1.0.0
metadata:
  generator: db-architect
  stores: ${stores.length}
  schemas: ${schemasCount}
  entities: ${entitiesCount}
  metadata_only: true
---

# DB Architect Skill â€” ${input.projectName}

You are operating with verified structural metadata exported from **DB Architect** (zero production rows or credentials included).

## Non-Negotiable Guardrails
1. **Never invent tables, columns, indexes or constraints** that are not listed below unless explicitly proposing a migration.
2. **Respect schema boundaries:** Always schema-qualify tables in PostgreSQL (\`schema.table\`) and never introduce circular foreign keys between schemas.
3. **Respect datastore ownership:** Only write authoritative state to the owning store; keep derived copies synced via CDC/outbox or cache-aside with explicit TTLs.
4. **Online migrations only:**
   - Create/drop PostgreSQL indexes with \`CREATE/DROP INDEX CONCURRENTLY\` outside \`BEGINâ€¦COMMIT\`.
   - Add foreign keys and CHECK constraints with \`NOT VALID\` followed by \`VALIDATE CONSTRAINT\`.
   - Never add \`NOT NULL\` without a default on populated tables; use expand-backfill-contract.
   - Never use floating-point types (\`float\`, \`double precision\`) for monetary columns.
5. **Redis discipline:** Every cache/session key must set an explicit TTL at write time and use \`object:{id}\` naming; never run \`KEYS *\`.

${archBlock}## Verified Datastores & Schemas

${schemaBlocks}
## Returning Proposals to DB Architect
When proposing a database redesign or schema improvement, include a fenced \`db-architect-proposal\` block so the user can paste it back into **DB Architect â†’ AI Handoff â†’ Verify Proposal** for automated deterministic scoring, regression checking and migration generation:

${PROPOSAL_CONTRACT}
`;
    return {
      format: "skill_md",
      filename: "SKILL.md",
      mimeType: "text/markdown",
      content,
      estimatedTokens: estimateTokens(content),
      installHint: `Save to .claude/skills/db-architect-${slug}/SKILL.md (Claude Code) or .codex/skills/db-architect-${slug}/SKILL.md (Codex).`,
      stats,
    };
  }

  if (input.format === "cursor_mdc") {
    const content = `---
description: Database architecture, multi-schema contracts, Redis TTL rules and safe migration guidelines for ${input.projectName} (generated by DB Architect)
globs:
  - "**/*.sql"
  - "**/migrations/**"
  - "**/schema*"
  - "**/db/**"
  - "**/prisma/**"
  - "**/drizzle/**"
alwaysApply: false
---

# Database Architecture Rules â€” ${input.projectName}

- Always schema-qualify PostgreSQL tables (\`schema.table\`) and preserve existing schema boundaries.
- Never execute destructive \`DROP TABLE\` / \`DROP COLUMN\` without expand-contract deprecation.
- Use \`CREATE INDEX CONCURRENTLY\` (outside transactions) and \`ADD CONSTRAINT ... NOT VALID\` + \`VALIDATE CONSTRAINT\`.
- Never store currency in \`float\` / \`double precision\`; use \`numeric(p,s)\` or integer minor units.
- Every Redis cache/session key must set a TTL at write time.

${archBlock}## Current Datastores & Schemas

${schemaBlocks}`;
    return {
      format: "cursor_mdc",
      filename: "db-architect.mdc",
      mimeType: "text/markdown",
      content,
      estimatedTokens: estimateTokens(content),
      installHint: "Save to .cursor/rules/db-architect.mdc inside your repository.",
      stats,
    };
  }

  if (input.format === "claude_md" || input.format === "agents_md") {
    const fname = input.format === "claude_md" ? "CLAUDE.md" : "AGENTS.md";
    const content = `# ${input.projectName} â€” Database Architecture Reference (${fname})
> Generated by DB Architect (metadata-only Â· ${stores.length} datastore(s) Â· ${schemasCount} schema(s) Â· ${entitiesCount} entities).

## Engineering Invariants
- **Schema boundaries:** Always qualify tables with their schema name; do not introduce circular cross-schema FKs.
- **Data ownership:** Respect each datastore's role. Keep derived copies synced through declared flows (${input.flows.map((f) => f.kind).join(", ") || "CDC / cache-aside"}).
- **Zero-downtime DDL:** \`CONCURRENTLY\` indexes outside transactions; \`NOT VALID\` + \`VALIDATE CONSTRAINT\` for FKs/checks; nullable-first backfills.
- **Exact types:** Use \`numeric\` or integer cents for money, \`timestamptz\` for timestamps, \`bigint\` or \`uuid\` for high-growth PKs.
- **Redis hygiene:** Always set TTL on ephemeral keys; cap queues/streams.

${archBlock}## Datastores & Schemas

${schemaBlocks}`;
    return {
      format: input.format,
      filename: fname,
      mimeType: "text/markdown",
      content,
      estimatedTokens: estimateTokens(content),
      installHint: input.format === "claude_md" ? "Drop into your repository root (or append to CLAUDE.md) for Claude Code." : "Drop into your repository root as AGENTS.md for Codex, Windsurf, Copilot or other coding agents.",
      stats,
    };
  }

  // Default: ChatGPT / Claude Web Copy-Paste Prompt Pack with round-trip proposal contract
  const reqSection = input.productRequirements?.trim()
    ? `## Product Requirements & Goals\n${input.productRequirements.trim()}\n${input.targetEngine && input.targetEngine !== "keep" ? `\n- **Requested Target Engine:** ${engineLabel(input.targetEngine)}\n` : ""}`
    : input.targetEngine && input.targetEngine !== "keep"
      ? `## Target Goal\n- **Requested Target Engine:** ${engineLabel(input.targetEngine)}\n`
      : "";

  const content = `# DB Architect Handoff Prompt â€” ${input.projectName}
**Task:** ${taskMeta.title}
**Privacy:** Metadata only (0 production rows, 0 credentials).

## Role & Instructions
You are a principal database architect. ${taskMeta.directive}

Rules:
1. Base every recommendation strictly on the schemas, cross-store topology and deterministic findings below. Do not invent unseen tables or pretend you measured query telemetry.
2. Call out trade-offs, migration lock risks, and what must be verified with \`EXPLAIN ANALYZE\` or staging parity checks.
3. End your response with a single fenced \`db-architect-proposal\` JSON block following the exact schema below so I can paste your reply straight back into DB Architect for deterministic scoring, regression checking, and migration diffing.

${reqSection}
${archBlock}## Current Datastores & Schemas

${schemaBlocks}
## Required Output Format (for DB Architect Round-Trip Verification)
After your explanation, include this exact fenced block with the complete proposed target SQL DDL (all tables you want in the target schema, including unchanged tables you are keeping) and any architecture changes:

${PROPOSAL_CONTRACT}
`;
  return {
    format: "prompt_pack",
    filename: `db-architect-${slug}-prompt.md`,
    mimeType: "text/markdown",
    content,
    estimatedTokens: estimateTokens(content),
    installHint: "Copy and paste directly into ChatGPT, Claude, or Gemini â€” then paste the AI's reply into the Verify AI Response tab.",
    stats,
  };
}

// â”€â”€â”€ Round-Trip Proposal Parser & Deterministic Verifier â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface ProposedArchChanges {
  stores?: { name: string; engine: string; role: string; description?: string }[];
  flows?: { from: string; to: string; kind: string; description?: string }[];
}

export interface ParsedProposal {
  sourceKind: "proposal_json" | "sql_ddl" | "yaml_dsl" | "mongo_json" | "redis_json";
  title: string;
  summary: string;
  rationale: string[];
  migrationNotes: string[];
  model: SchemaModel;
  parseWarnings: string[];
  architectureChanges: ProposedArchChanges | null;
}

export interface VerifiedProposal {
  parsed: ParsedProposal;
  validation: { errors: string[]; warnings: string[] };
  baseline: {
    database: string;
    engine: string;
    entities: number;
    namespaces: number;
    designScore: number;
    findingCount: number;
  } | null;
  proposed: {
    database: string;
    engine: string;
    entities: number;
    namespaces: number;
    designScore: number;
    findingCount: number;
    findings: Finding[];
  };
  comparison: {
    scoreDelta: number | null;
    findingsFixed: Finding[];
    regressions: Finding[];
    persistingCount: number;
  };
  diff: SchemaDiff | null;
  migration: { up: string; down: string; risks: string[]; validation: { ok: boolean; checks: string[] } } | null;
  architecturePreview: {
    beforeScore: number;
    afterScore: number;
    scoreDelta: number;
    resolvedArchFindings: ArchFinding[];
    newArchFindings: ArchFinding[];
    proposedStores: { name: string; engine: string; role: string; description?: string }[];
    proposedFlows: { from: string; to: string; kind: string; description?: string }[];
  } | null;
}

function extractFencedBlocks(raw: string): { lang: string; body: string }[] {
  const blocks: { lang: string; body: string }[] = [];
  const re = /```([a-zA-Z0-9_-]*)\s*\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    blocks.push({ lang: (m[1] ?? "").toLowerCase(), body: m[2].trim() });
  }
  return blocks;
}

function parseJsonLoose(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseProposal(rawInput: string, fallbackDb = "proposed_db", engineHint?: Engine): ParsedProposal {
  const raw = rawInput.trim();
  if (!raw) throw new Error("Paste an AI response or upload a proposal file first.");

  const blocks = extractFencedBlocks(raw);

  // 1) Look for an explicit `db-architect-proposal` JSON block (or raw JSON matching it)
  const proposalBlock =
    blocks.find((b) => b.lang === "db-architect-proposal") ??
    blocks.find((b) => (b.lang === "json" || b.lang === "") && /"db-architect\/proposal|"proposedSchema"|"architectureChanges"|"sql"\s*:/i.test(b.body));
  const proposalObj = proposalBlock ? parseJsonLoose(proposalBlock.body) : raw.startsWith("{") ? parseJsonLoose(raw) : null;

  if (proposalObj && (proposalObj.format === "db-architect/proposal/v1" || typeof proposalObj.sql === "string" || typeof proposalObj.ddl === "string" || proposalObj.proposedSchema || proposalObj.architectureChanges)) {
    const title = String(proposalObj.title ?? "AI Architecture Proposal").slice(0, 180);
    const summary = String(proposalObj.summary ?? "").slice(0, 1000);
    const rationale = Array.isArray(proposalObj.rationale) ? proposalObj.rationale.map(String).slice(0, 20) : [];
    const migrationNotes = Array.isArray(proposalObj.migrationNotes) ? proposalObj.migrationNotes.map(String).slice(0, 20) : [];
    const archRaw = proposalObj.architectureChanges && typeof proposalObj.architectureChanges === "object" ? (proposalObj.architectureChanges as Record<string, unknown>) : null;
    const architectureChanges: ProposedArchChanges | null = archRaw
      ? {
          stores: Array.isArray(archRaw.stores)
            ? archRaw.stores
                .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && typeof (x as Record<string, unknown>).name === "string")
                .map((x) => ({
                  name: String(x.name).trim().slice(0, 200),
                  engine: isEngine(x.engine) ? x.engine : "postgres",
                  role: isStoreRole(x.role) ? x.role : "service",
                  description: x.description ? String(x.description).slice(0, 500) : undefined,
                }))
            : undefined,
          flows: Array.isArray(archRaw.flows)
            ? archRaw.flows
                .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && typeof (x as Record<string, unknown>).from === "string" && typeof (x as Record<string, unknown>).to === "string")
                .map((x) => ({
                  from: String(x.from).trim(),
                  to: String(x.to).trim(),
                  kind: FLOW_KINDS.some((k) => k.id === x.kind) ? String(x.kind) : "cdc",
                  description: x.description ? String(x.description).slice(0, 500) : undefined,
                }))
            : undefined,
        }
      : null;

    const targetEng = isEngine(proposalObj.targetEngine) ? proposalObj.targetEngine : engineHint;
    const sqlText = typeof proposalObj.sql === "string" ? proposalObj.sql : typeof proposalObj.ddl === "string" ? proposalObj.ddl : "";
    if (sqlText.trim()) {
      const parsed = parseSqlDdl(sqlText, fallbackDb, targetEng && targetEng !== "mongodb" && targetEng !== "redis" ? targetEng : undefined);
      return { sourceKind: "proposal_json", title, summary, rationale, migrationNotes, model: parsed.model, parseWarnings: parsed.warnings, architectureChanges };
    }
    if (proposalObj.proposedSchema && typeof proposalObj.proposedSchema === "object") {
      const sub = proposalObj.proposedSchema as Record<string, unknown>;
      if (sub.engine === "redis" || Array.isArray(sub.keys)) {
        const parsed = parseRedisDump(JSON.stringify(sub), fallbackDb);
        return { sourceKind: "proposal_json", title, summary, rationale, migrationNotes, model: parsed.model, parseWarnings: parsed.warnings, architectureChanges };
      }
      if (Array.isArray(sub.collections)) {
        const parsed = parseMongoJson(JSON.stringify(sub), fallbackDb);
        return { sourceKind: "proposal_json", title, summary, rationale, migrationNotes, model: parsed.model, parseWarnings: parsed.warnings, architectureChanges };
      }
      const parsed = parseDsl(JSON.stringify(sub), "proposal.json");
      return { sourceKind: "proposal_json", title, summary, rationale, migrationNotes, model: parsed.model, parseWarnings: parsed.warnings, architectureChanges };
    }
    if (architectureChanges && ((architectureChanges.stores?.length ?? 0) > 0 || (architectureChanges.flows?.length ?? 0) > 0)) {
      // Architecture-only proposal (no SQL DDL changed) â€” construct a lightweight empty placeholder model
      const m = parseSqlDdl("", fallbackDb, "postgres").model;
      return { sourceKind: "proposal_json", title, summary, rationale, migrationNotes, model: m, parseWarnings: ["Proposal contains architecture changes only (no table DDL)."], architectureChanges };
    }
  }

  // 2) Fenced SQL blocks anywhere in a ChatGPT/Claude prose answer
  const sqlBlocks = blocks.filter((b) => ["sql", "postgres", "postgresql", "mysql", "sqlite", "ddl"].includes(b.lang) || (!b.lang && /\bCREATE\s+(?:TABLE|SCHEMA|INDEX|TYPE)\b/i.test(b.body)));
  if (sqlBlocks.length) {
    const combined = sqlBlocks.map((b) => b.body).join("\n\n");
    const dialect = engineHint && engineHint !== "mongodb" && engineHint !== "redis" ? engineHint : detectSqlDialect(combined);
    const parsed = parseSqlDdl(combined, fallbackDb, dialect);
    return {
      sourceKind: "sql_ddl",
      title: `SQL Proposal (${engineLabel(parsed.detectedEngine)})`,
      summary: `Extracted ${sqlBlocks.length} SQL block(s) containing ${parsed.model.entities.length} entities across ${parsed.model.namespaces.length} schema(s).`,
      rationale: [],
      migrationNotes: [],
      model: parsed.model,
      parseWarnings: parsed.warnings,
      architectureChanges: null,
    };
  }

  // 3) Fenced YAML or JSON DSL / Mongo / Redis blocks
  const dataBlock = blocks.find((b) => ["yaml", "yml", "json"].includes(b.lang));
  const candidate = dataBlock ? dataBlock.body : raw;
  const trimmed = candidate.trimStart();

  if (/"engine"\s*:\s*"redis"|"keys"\s*:\s*\[/.test(trimmed.slice(0, 2000))) {
    const parsed = parseRedisDump(candidate, fallbackDb);
    return { sourceKind: "redis_json", title: "Redis Keyspace Proposal", summary: `Parsed ${parsed.model.entities.length} key pattern(s).`, rationale: [], migrationNotes: [], model: parsed.model, parseWarnings: parsed.warnings, architectureChanges: null };
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    if (/"collections"|"sample"|"validator"/.test(trimmed)) {
      const parsed = parseMongoJson(candidate, fallbackDb);
      return { sourceKind: "mongo_json", title: "MongoDB Schema Proposal", summary: `Parsed ${parsed.model.entities.length} collection(s).`, rationale: [], migrationNotes: [], model: parsed.model, parseWarnings: parsed.warnings, architectureChanges: null };
    }
    const parsed = parseDsl(candidate, "proposal.json");
    return { sourceKind: "yaml_dsl", title: "DSL Schema Proposal", summary: `Parsed ${parsed.model.entities.length} entities.`, rationale: [], migrationNotes: [], model: parsed.model, parseWarnings: parsed.warnings, architectureChanges: null };
  }
  if (/\bCREATE\s+(?:TABLE|SCHEMA|INDEX)\b/i.test(candidate)) {
    const dialect = engineHint && engineHint !== "mongodb" && engineHint !== "redis" ? engineHint : detectSqlDialect(candidate);
    const parsed = parseSqlDdl(candidate, fallbackDb, dialect);
    return { sourceKind: "sql_ddl", title: `SQL Proposal (${engineLabel(parsed.detectedEngine)})`, summary: `Parsed ${parsed.model.entities.length} entities across ${parsed.model.namespaces.length} schema(s).`, rationale: [], migrationNotes: [], model: parsed.model, parseWarnings: parsed.warnings, architectureChanges: null };
  }
  // Last attempt: YAML DSL
  try {
    const doc = yamlLoad(candidate);
    if (doc && typeof doc === "object") {
      const parsed = parseDsl(candidate, "proposal.yaml");
      if (parsed.model.entities.length) {
        return { sourceKind: "yaml_dsl", title: "YAML Schema Proposal", summary: `Parsed ${parsed.model.entities.length} entities.`, rationale: [], migrationNotes: [], model: parsed.model, parseWarnings: parsed.warnings, architectureChanges: null };
      }
    }
  } catch {
    // fall through
  }
  throw new Error("Could not find a db-architect-proposal JSON block, SQL DDL (CREATE TABLEâ€¦), YAML DSL, MongoDB JSON or Redis key dump in the pasted response.");
}

export function verifyProposal(opts: {
  rawInput: string;
  baselineModel: SchemaModel | null;
  projectStores?: StoreInput[];
  projectFlows?: FlowInput[];
}): VerifiedProposal {
  const baseline = opts.baselineModel;
  const parsed = parseProposal(rawInputClean(opts.rawInput), baseline?.database ?? "proposed_db", baseline?.engine);
  const validation = validateModel(parsed.model);
  const proposedHasEntities = parsed.model.entities.length > 0;
  const before = baseline ? analyzeModel(baseline) : null;
  const after = proposedHasEntities ? analyzeModel(parsed.model) : null;

  const keyOf = (f: Finding) => `${f.ruleId}|${f.object}`;
  const beforeMap = new Map((before?.findings ?? []).map((f) => [keyOf(f), f]));
  const afterMap = new Map((after?.findings ?? []).map((f) => [keyOf(f), f]));

  const findingsFixed = before && after ? [...beforeMap.entries()].filter(([k]) => !afterMap.has(k)).map(([, f]) => f) : [];
  const regressions = before && after ? [...afterMap.entries()].filter(([k]) => !beforeMap.has(k)).map(([, f]) => f) : [];
  const persistingCount = before && after ? [...afterMap.keys()].filter((k) => beforeMap.has(k)).length : 0;

  let diff: SchemaDiff | null = null;
  let migration: VerifiedProposal["migration"] = null;
  if (baseline && proposedHasEntities && baseline.engine === parsed.model.engine && baseline.engine !== "redis") {
    diff = diffModels(baseline, parsed.model);
    if (diff.changes.length > 0) {
      const gen = generateMigration(baseline.engine, diff, baseline, parsed.model);
      migration = { ...gen, validation: validateMigration(gen.up, baseline.engine) };
    }
  }

  let architecturePreview: VerifiedProposal["architecturePreview"] = null;
  if (parsed.architectureChanges && opts.projectStores?.length) {
    const beforeArch = analyzeArchitecture(opts.projectStores, opts.projectFlows ?? []);
    const simStores: StoreInput[] = opts.projectStores.map((s) => ({ ...s }));
    for (const ps of parsed.architectureChanges.stores ?? []) {
      const existing = simStores.find((s) => s.name.toLowerCase() === ps.name.toLowerCase());
      if (existing) {
        existing.role = ps.role;
        existing.description = ps.description ?? existing.description;
      } else {
        simStores.push({ id: `proposed:${ps.name}`, name: ps.name, engine: ps.engine, role: ps.role, description: ps.description, model: null });
      }
    }
    const idByName = new Map(simStores.map((s) => [s.name.toLowerCase(), s.id]));
    const simFlows: FlowInput[] = [...(opts.projectFlows ?? [])];
    for (const pf of parsed.architectureChanges.flows ?? []) {
      const fromId = idByName.get(pf.from.toLowerCase());
      const toId = idByName.get(pf.to.toLowerCase());
      if (fromId && toId && fromId !== toId && !simFlows.some((f) => f.fromStoreId === fromId && f.toStoreId === toId && f.kind === pf.kind)) {
        simFlows.push({ id: `proposed:${fromId}>${toId}:${pf.kind}`, fromStoreId: fromId, toStoreId: toId, kind: pf.kind, description: pf.description });
      }
    }
    const afterArch = analyzeArchitecture(simStores, simFlows);
    const aKey = (f: ArchFinding) => `${f.ruleId}|${f.object}`;
    const bSet = new Set(beforeArch.findings.map(aKey));
    const aSet = new Set(afterArch.findings.map(aKey));
    architecturePreview = {
      beforeScore: beforeArch.score,
      afterScore: afterArch.score,
      scoreDelta: afterArch.score - beforeArch.score,
      resolvedArchFindings: beforeArch.findings.filter((f) => !aSet.has(aKey(f))),
      newArchFindings: afterArch.findings.filter((f) => !bSet.has(aKey(f))),
      proposedStores: parsed.architectureChanges.stores ?? [],
      proposedFlows: parsed.architectureChanges.flows ?? [],
    };
  }

  return {
    parsed,
    validation,
    baseline: baseline && before
      ? { database: baseline.database, engine: baseline.engine, entities: baseline.entities.length, namespaces: baseline.namespaces.length, designScore: before.summary.designScore, findingCount: before.findings.length }
      : null,
    proposed: {
      database: parsed.model.database,
      engine: parsed.model.engine,
      entities: parsed.model.entities.length,
      namespaces: parsed.model.namespaces.length,
      designScore: after?.summary.designScore ?? (before?.summary.designScore ?? 100),
      findingCount: after?.findings.length ?? 0,
      findings: after?.findings ?? [],
    },
    comparison: {
      scoreDelta: before && after ? after.summary.designScore - before.summary.designScore : null,
      findingsFixed,
      regressions,
      persistingCount,
    },
    diff,
    migration,
    architecturePreview,
  };
}

function rawInputClean(s: string): string {
  return s.replace(/^\uFEFF/, "").trim();
}
