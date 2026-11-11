// Single source of truth for product status. Mirrored in docs/SPEC.md.
export type Status = "shipped" | "in_progress" | "next" | "planned";
export type Priority = "P0" | "P1" | "P2" | "P3";

export interface SpecItem { id: string; area: string; title: string; status: Status; priority: Priority; notes: string }
export interface TopItem { rank: number; title: string; why: string; status: Status; scope: string[] }

export const TOP_10: TopItem[] = [
  { rank: 1, title: "Cross-engine Transformation Studio", status: "shipped", why: "Teams rarely stay on one database. Converting schema + data between engines safely is the highest-value, least-served need.", scope: ["PG/MySQL/SQLite ↔ MongoDB schema conversion", "Embed-vs-reference decisions", "Live data preview", "ETL script + runbook"] },
  { rank: 2, title: "Database Selection Advisor", status: "shipped", why: "Choosing the engine is the most expensive decision. An explainable, workload-driven recommendation prevents the wrong one.", scope: ["10 engines scored on 21 capabilities", "Polyglot suggestions", "Prefill from a scanned schema", "Migration-path hints"] },
  { rank: 3, title: "MySQL support (the most common engine after PostgreSQL)", status: "shipped", why: "MySQL runs a large share of production web workloads.", scope: ["DDL import incl. dumps", "Live read-only introspection", "MySQL-specific rules", "Online-DDL-aware migrations"] },
  { rank: 4, title: "SQLite support", status: "shipped", why: "The most deployed database in the world; ubiquitous in mobile, edge and local-first apps.", scope: ["DDL import", "SQLite-aware analysis and migrations", "Transform source/target"] },
  { rank: 5, title: "SQL Server support", status: "next", why: "Dominant in enterprises; large migration-to-PostgreSQL demand.", scope: ["T-SQL DDL import", "sys.* introspection", "T-SQL migration generation"] },
  { rank: 6, title: "Workload evidence ingestion", status: "next", why: "Index advice is only trustworthy with real query evidence (pg_stat_statements, slow logs, explain plans).", scope: ["pg_stat_statements import", "MySQL slow log / performance_schema", "Mongo profiler + explain()", "Evidence-level upgrades on findings"] },
  { rank: 7, title: "Background job queue & workers", status: "next", why: "Scans currently run inside the request. Large databases need async, cancellable, recoverable jobs.", scope: ["Queue + worker process", "Progress streaming", "Cancellation & retries", "Per-tenant quotas"] },
  { rank: 8, title: "Redis key-model analysis", status: "planned", why: "Redis is the most common cache/secondary store; its implicit key schema is rarely documented.", scope: ["SCAN-based key-pattern sampling", "TTL & memory hot-spot analysis", "Key-schema documentation"] },
  { rank: 9, title: "CI/CD drift detection & PR comments", status: "planned", why: "Keeps the live database, migrations in git and the model in sync.", scope: ["CLI/GitHub Action", "Schema drift alerts", "PR migration risk comments"] },
  { rank: 10, title: "Provider-backed AI assistant + data-quality profiling", status: "planned", why: "Natural-language answers grounded in findings, plus type/null/orphan profiling to de-risk migrations.", scope: ["LLM adapter over structured findings only", "Per-column type histograms", "Orphan & duplicate detection"] },
];

export const SPEC_ITEMS: SpecItem[] = [
  { id: "AUTH-1", area: "Platform", title: "Accounts, sessions, password hashing", status: "shipped", priority: "P0", notes: "scrypt, HTTP-only sessions, 7-day expiry." },
  { id: "AUTH-2", area: "Platform", title: "Workspaces, projects, 5-role RBAC", status: "shipped", priority: "P0", notes: "Enforced server-side per request; tenant isolation verified." },
  { id: "AUTH-3", area: "Platform", title: "Password reset by email, SSO", status: "planned", priority: "P2", notes: "Needs outbound email provider." },
  { id: "CONN-1", area: "Connections", title: "Encrypted saved connections (test/scan/rotate/revoke)", status: "shipped", priority: "P0", notes: "AES-256-GCM; secrets never returned by APIs." },
  { id: "CONN-2", area: "Connections", title: "SSRF guard with explicit allowlist", status: "shipped", priority: "P0", notes: "DB_ARCHITECT_HOST_ALLOWLIST for private networks." },
  { id: "CONN-3", area: "Connections", title: "SSH tunnel / private link", status: "planned", priority: "P3", notes: "" },
  { id: "ENG-1", area: "Engines", title: "PostgreSQL import + live introspection", status: "shipped", priority: "P0", notes: "" },
  { id: "ENG-2", area: "Engines", title: "MongoDB import + bounded sampling", status: "shipped", priority: "P0", notes: "BSON class detection; array element shapes." },
  { id: "ENG-3", area: "Engines", title: "MySQL import + live introspection", status: "shipped", priority: "P0", notes: "Live path implemented; verified against SQL fixtures (no MySQL server in CI sandbox)." },
  { id: "ENG-4", area: "Engines", title: "SQLite import", status: "shipped", priority: "P1", notes: "File-based — DDL import only." },
  { id: "ENG-5", area: "Engines", title: "SQL Server adapter", status: "next", priority: "P1", notes: "" },
  { id: "ENG-6", area: "Engines", title: "Redis key-model adapter", status: "planned", priority: "P2", notes: "" },
  { id: "VIS-1", area: "Visualization", title: "Interactive SVG diagram (ELK layout, drag, collapse, export)", status: "shipped", priority: "P0", notes: "Layouts persist per scan." },
  { id: "VIS-2", area: "Visualization", title: "Diagram for transformed target designs", status: "shipped", priority: "P1", notes: "Save a plan as a schema version, then open it." },
  { id: "ANA-1", area: "Analysis", title: "Deterministic rules with evidence & limitations", status: "shipped", priority: "P0", notes: "PG, MySQL, SQLite, Mongo rule sets." },
  { id: "ANA-2", area: "Analysis", title: "Runtime/workload evidence (pg_stat_statements, explain)", status: "next", priority: "P1", notes: "Findings currently schema/heuristic evidence only." },
  { id: "DIFF-1", area: "Migrations", title: "Schema diff with rename candidates", status: "shipped", priority: "P0", notes: "" },
  { id: "DIFF-2", area: "Migrations", title: "Migration generation: PG, MySQL, SQLite, Mongo", status: "shipped", priority: "P0", notes: "Transaction-safe index handling; MySQL non-transactional DDL flagged." },
  { id: "DIFF-3", area: "Migrations", title: "Editable scripts, static validation, history, hashes", status: "shipped", priority: "P1", notes: "Nothing is ever executed by the product." },
  { id: "DIFF-4", area: "Migrations", title: "Dry-run against a disposable database", status: "planned", priority: "P2", notes: "Requires sandbox provisioning." },
  { id: "TRF-1", area: "Transformation", title: "Schema conversion across PG/MySQL/SQLite/Mongo", status: "shipped", priority: "P0", notes: "Canonical type map with lossy-conversion flags." },
  { id: "TRF-2", area: "Transformation", title: "Embed-vs-reference & junction handling (SQL→Mongo)", status: "shipped", priority: "P0", notes: "Growth-aware heuristics with explanations." },
  { id: "TRF-3", area: "Transformation", title: "Document flattening & child tables (Mongo→SQL)", status: "shipped", priority: "P0", notes: "Arrays, nested objects, inferred references → deferred FKs." },
  { id: "TRF-4", area: "Transformation", title: "Live data preview (masked, bounded, never stored)", status: "shipped", priority: "P0", notes: "Synthetic or consented live sample." },
  { id: "TRF-5", area: "Transformation", title: "Generated ETL scripts + runbook + validation queries", status: "shipped", priority: "P0", notes: "Idempotent, batched, source read-only." },
  { id: "TRF-6", area: "Transformation", title: "In-product execution of ETL", status: "planned", priority: "P3", notes: "Deliberately out of scope until approval workflows exist." },
  { id: "ADV-1", area: "Advisor", title: "Workload-based database recommendation", status: "shipped", priority: "P0", notes: "10 engines × 21 capabilities, explainable." },
  { id: "ADV-2", area: "Advisor", title: "Profile derivation from a scanned schema", status: "shipped", priority: "P1", notes: "" },
  { id: "REP-1", area: "Reports", title: "HTML / Markdown / JSON reports", status: "shipped", priority: "P0", notes: "" },
  { id: "REP-2", area: "Reports", title: "PDF export", status: "planned", priority: "P3", notes: "" },
  { id: "AI-1", area: "AI", title: "Grounded assistant (deterministic)", status: "shipped", priority: "P1", notes: "Cites rule ids and objects." },
  { id: "AI-2", area: "AI", title: "LLM provider adapter", status: "planned", priority: "P2", notes: "Structured findings only; no raw data." },
  { id: "OPS-1", area: "Operations", title: "Async scan queue, cancellation, retries", status: "next", priority: "P1", notes: "Scans are currently synchronous." },
  { id: "OPS-2", area: "Operations", title: "Self-healing schema bootstrap + health endpoint", status: "shipped", priority: "P0", notes: "" },
  { id: "OPS-3", area: "Operations", title: "Unit/golden tests (vitest)", status: "shipped", priority: "P0", notes: "Parsers, transform, advisor, migrations, ETL syntax." },
  { id: "OPS-4", area: "Operations", title: "Rate limiting, quotas, metrics export", status: "planned", priority: "P2", notes: "" },
];

export type Support = "full" | "partial" | "planned" | "none";
export const MATRIX_ENGINES = ["PostgreSQL", "MySQL", "SQLite", "MongoDB", "SQL Server", "Redis"] as const;
export const SUPPORT_MATRIX: { capability: string; values: Support[] }[] = [
  { capability: "Schema import (DDL / JSON / YAML)", values: ["full", "full", "full", "full", "planned", "none"] },
  { capability: "Live read-only introspection", values: ["full", "full", "none", "full", "planned", "planned"] },
  { capability: "Analysis rules", values: ["full", "full", "full", "full", "planned", "planned"] },
  { capability: "Diagram", values: ["full", "full", "full", "full", "planned", "planned"] },
  { capability: "Migration generation", values: ["full", "full", "full", "full", "planned", "none"] },
  { capability: "Transform source", values: ["full", "full", "full", "full", "planned", "none"] },
  { capability: "Transform target", values: ["full", "full", "full", "full", "planned", "none"] },
  { capability: "Advisor recommendation", values: ["full", "full", "full", "full", "full", "full"] },
];
