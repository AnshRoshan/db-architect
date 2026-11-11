# DB Architect — Specification & Project Context

> Living document. The in-app **Roadmap** view renders the same data from `src/lib/roadmap.ts`.
> Update both when status changes. Last updated with: multi-engine foundation, Transformation Studio, Database Advisor, landing page.

## 1. Product definition

DB Architect is **database-agnostic** architecture intelligence. It converts a database's *actual* structure into
engineering knowledge: diagrams, evidence-backed findings, reviewable migrations, cross-engine transformation plans,
and an explainable answer to *"which database should this workload use?"*.

Principles (non-negotiable):

1. **Deterministic rules first, AI explains** — never the reverse.
2. **Evidence levels** on every finding (`schema | statistics | workload | sample | heuristic`) and explicit limitations.
3. **Read-only by default.** The product never executes migrations or ETL. It generates reviewable artifacts.
4. **Metadata first.** Schemas and shapes are stored; rows are not. Live previews are masked, bounded, consent-gated, audit-logged and never persisted.
5. **Engine-neutral core.** One canonical `SchemaModel`; engine specifics live in adapters, dialect generators and rule sets.
6. **Common engines first.** Add databases in order of real-world usage; finish the top few before starting the next.

## 2. Top 10 priorities

| # | Item | Status |
|---|------|--------|
| 1 | Cross-engine Transformation Studio | **Shipped** |
| 2 | Database Selection Advisor | **Shipped** |
| 3 | MySQL support | **Shipped** (live path unit-verified via fixtures; no MySQL server in the build sandbox) |
| 4 | SQLite support (import/analysis/migrations/transform) | **Shipped** |
| 5 | SQL Server support | Next |
| 6 | Workload evidence ingestion (pg_stat_statements, slow logs, explain, Mongo profiler) | Next |
| 7 | Background job queue & workers (async, cancellable, retried scans) | Next |
| 8 | Redis key-model analysis | Planned |
| 9 | CI/CD drift detection & PR comments | Planned |
| 10 | Provider-backed AI assistant + data-quality profiling | Planned |

## 3. Architecture

```
src/lib/
  engines.ts        engine registry, dialect detection (pure — safe for client bundles)
  schema-model.ts   canonical model, stable ids
  dsl.ts            YAML/JSON DSL, SQL DDL parser (PG/MySQL/SQLite dialects), Mongo JSON + shape inference
  type-map.ts       canonical type families, per-engine rendering, lossy flags, default mapping
  sql-dialects.ts   quoting, CREATE TABLE/INDEX, DDL generator, MySQL/SQLite migrations
  analysis.ts       deterministic rules (PG, MySQL, SQLite, Mongo)
  diff-migrate.ts   diff, PG/Mongo migrations, dispatcher, static validation
  transform.ts      plan + row transformation (SQL↔SQL, SQL→Mongo, Mongo→SQL), masking, sanitising
  etl-script.ts     standalone Node ETL generator (read-only source, idempotent target)
  synth.ts          deterministic synthetic data from a schema
  advisor.ts        explainable database-selection scoring (10 engines × 21 capabilities)
  connectors.ts     adapter registry (validate / test / introspect / sample)
  introspection.ts  PG, MySQL, Mongo introspection + bounded read-only sampling, SSRF guard
  auth.ts, secrets.ts, bootstrap.ts   sessions, RBAC, AES-256-GCM, self-healing schema
src/app/            "/" landing page · "/app" workspace · "/api/v1/*" REST
src/components/     connect-panel, transform-studio, advisor-panel, roadmap-panel, diagram-studio, …
tests/              vitest golden/unit suite
```

### Adapter interface

```ts
interface Adapter {
  engine; live;
  validate(cfg); credentials(cfg); display(cfg);
  test(creds); introspect(creds, opts); sample(creds, entity, limit, where?);
}
```

Adding an engine = parser + type-map rows + dialect/DDL + rule set + adapter + advisor entry + fixtures + tests.

## 4. Transformation Studio

**Directions:** relational ↔ relational (PG/MySQL/SQLite), relational → MongoDB, MongoDB → relational.
Same-engine changes use Diff & Migrate.

| Concern | Behaviour |
|---|---|
| Types | Canonical families; each rendering flagged `lossy` with a reason (e.g. `timestamptz → datetime(6)` drops the offset) |
| Defaults | `now()`, `gen_random_uuid()`, booleans translated; unsupported defaults dropped with a note |
| SQL → Mongo | Owned, bounded, single-parent children are **embedded**; growth-named (`*_log`, `*_events`, …) or shared tables stay collections; pure junctions become id arrays; PK → `_id`; NULL omitted; `$jsonSchema` validators; indexes carried over |
| Mongo → SQL | Nested objects flattened (depth-limited) or JSON; arrays → child tables (`(parent_id, position)` PK), JSON, or native PG arrays; inferred references become **deferred** FKs with orphan checks; mixed types → text with a warning |
| Names | Index/constraint names qualified with the table (schema-global in PG/SQLite) |
| Output | Decisions with reasons, field-level mapping, DDL/mongosh, ETL script, runbook, validation queries |
| Persistence | A plan can be saved as a new schema version → diagram, analysis, diff |
| Live preview | Synthetic (default) or saved connection; read-only txn; ≤10 rows/table; sensitive-looking text masked; keys preserved; explicit consent; audit-logged; never stored |

Known limits: views/procedures are not transformed; CHECK expressions are copied verbatim (PG-specific syntax is warned); Mongo→SQL schema reflects *sampled* shapes only.

## 5. Database Advisor

Inputs: data shape, consistency, scale, traffic, queries, schema volatility, latency, deployment, ecosystem, must-haves.
Scoring: `Σ weight(profile) × capability(engine)` normalised to 0–100, with explicit factors for embedded use,
ACID needs and licence policy. Output: ranking, per-engine strengths / watch-outs / best-for / avoid-when,
polyglot suggestions (search, cache, analytics, time-series, graph), capability heat-map, migration-path hint.
**It is a heuristic, not a benchmark**, and says so.

Engines scored: PostgreSQL, MySQL, SQLite, SQL Server, MongoDB, Redis, DynamoDB, Elasticsearch/OpenSearch, ClickHouse, Cassandra.

## 6. Engine support matrix

| Capability | PostgreSQL | MySQL | SQLite | MongoDB | SQL Server | Redis |
|---|---|---|---|---|---|---|
| Schema import | ✅ | ✅ | ✅ | ✅ | ⏳ | — |
| Live introspection | ✅ | ✅ | — (file) | ✅ | ⏳ | ⏳ |
| Analysis rules | ✅ | ✅ | ✅ | ✅ | ⏳ | ⏳ |
| Diagram | ✅ | ✅ | ✅ | ✅ | ⏳ | ⏳ |
| Migration generation | ✅ | ✅ (non-transactional DDL flagged) | ✅ (rebuild guidance) | ✅ | ⏳ | — |
| Transform source / target | ✅ | ✅ | ✅ | ✅ | ⏳ | — |
| Advisor | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## 7. Security model

- Passwords: scrypt. Sessions: random 256-bit tokens, SHA-256 hashed at rest, HTTP-only, 7 days.
- RBAC (owner/admin/architect/developer/viewer) enforced server-side on every request; tenant-scoped queries.
- Connection credentials: AES-256-GCM; key from `DB_ARCHITECT_SECRET` (falls back to a `DATABASE_URL` digest for local dev — **set a dedicated secret in production**).
- SSRF: metadata/loopback/private ranges blocked; opt-in via `DB_ARCHITECT_HOST_ALLOWLIST`.
- TLS: `prefer` tries TLS then falls back only if unsupported; `require` enforces it. Certificate verification is currently relaxed (`rejectUnauthorized:false`) — tracked for hardening.
- Audit log for sensitive operations incl. `transform.preview_live`.

## 7b. Design system & motion

- **Session durability:** only a definitive `user:null`/401 from the identity endpoint signs you out — network flakes and failing feature endpoints never do; identity is re-probed once on boot failure with a 'still signed in' recovery screen; `ErrorBoundary` turns render exceptions into a recoverable screen instead of an invisible "logout". AuthScreen probes the fresh session (header+bearer, X-Auth-Check) before admitting; a login can't leave you on a stale credential.

- **Session transport:** login returns a 256-bit token that is *both* set as an HTTP-only `Secure; SameSite=None` cookie and stored client-side, then attached as `Authorization: Bearer` by a single fetch interceptor (`src/lib/client-session.ts`). Preview deployments embedded in iframes were losing Lax cookies, so sign-in "succeeded" while every later call returned 401. 401s now clear the token and return to the sign-in screen. Covered by 2 DOM tests.
- **App shell:** grouped, collapsible sidebar (`components/app-shell/sidebar.tsx`) with spring `layoutId` active indicator, inline theme control and user card; breadcrumb top bar with project switcher, version selector, search and add-schema; ⌘K command palette (`command-palette.tsx`) searching views, projects, schema versions and actions, with full keyboard navigation.
- **Theming:** `next-themes` (class strategy) + Tailwind v4 `@custom-variant dark`. Semantic tokens (`bg-canvas`, `bg-elevated`, `bg-muted`, `text-ink`, `text-ink-muted`, `border-line`) defined in `globals.css`; components never hardcode light colours. Toggle (`ThemeToggle`) in the landing nav, app header, sidebar and auth screen; uses the View Transitions API when available; persists to `localStorage`; defaults to system.
- **Motion:** `framer-motion` with `MotionConfig reducedMotion="user"` + a CSS `prefers-reduced-motion` guard. Primitives in `components/motion.tsx`: `Reveal`, `RevealGroup/Item` (scroll-triggered stagger), `CountUp`, `Tilt`, `Typewriter`, `Magnetic`, `ViewFade`. App shell: `layoutId` nav indicator, animated view transitions, spring toasts/dialogs, animated score ring, staggered cards, flowing selected edges in the diagram.
- **Hero:** `HeroScene` cycles introspect → findings → transform every ~9 s (schema draws itself, particles flow along FKs, findings spring in, a document types out). Static for reduced-motion users.
- **Tests:** `tests/ui.test.tsx` (jsdom) verifies the toggle cycle light→dark→system (class + persistence), the segmented radiogroup, motion primitives and landing scenes.

## 8. Testing

`npx vitest run` — 44 tests (32 engine + 8 UI/DOM incl. session transport): dialect detection, MySQL/SQLite/PG parsing (incl. regression for dropped DEFAULTs),
analysis relabelling, every transform direction, ETL scripts `node --check`ed for 8 engine pairs, advisor
rankings, migrations (transaction safety, MySQL non-transactional DDL).

Not yet covered: live MySQL/Mongo integration tests (need service containers), UI end-to-end, load tests.

## 9. Known gaps (honest list)

- Scans run synchronously in the request (queue/worker is priority #7).
- No workload evidence ingestion yet — index advice is schema/heuristic evidence only.
- AI assistant is deterministic (no LLM provider adapter yet).
- No password reset email / SSO.
- Data-quality profiling (type histograms, orphan counts on live data) is planned.
