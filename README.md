<div align="center">

# DB Architect

**Database-agnostic architecture intelligence.**
Every schema. Every datastore. One architecture.

[![CI](https://github.com/AnshRoshan/db-architect/actions/workflows/ci.yml/badge.svg)](https://github.com/AnshRoshan/db-architect/actions/workflows/ci.yml)
[![CodeQL](https://github.com/AnshRoshan/db-architect/actions/workflows/codeql.yml/badge.svg)](https://github.com/AnshRoshan/db-architect/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-6366f1.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000.svg)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org)
[![Bun](https://img.shields.io/badge/bun-1.4-fbf0df.svg)](https://bun.sh)

</div>

---

## About

DB Architect turns the **actual structure** of your databases into engineering
knowledge you can defend in a design review.

Most tools stop at a diagram. DB Architect starts there and keeps going: it
reads every schema on the server, models the whole system — the Postgres, the
Mongo, the Redis and how data flows between them — and then produces
**evidence-backed findings**, **reviewable migrations**, **cross-engine
transformation plans**, and an **explainable answer** to the question every
architect eventually gets asked: *which database should this workload use?*

It is a different shape of tool on purpose:

| Most schema tools | DB Architect |
|---|---|
| One database at a time | A system of datastores, their roles and the flows between them |
| `public` only | Every schema, selected by name, glob or exclusion, with cross-schema foreign keys intact |
| Diagram as the product | Diagram as the starting point for analysis, migration and transformation |
| "Best practice" checklists | Deterministic rules with a rule id, a severity, an evidence level and stated limitations |
| A generated answer | A transparent score you can audit, with the watch-outs spelled out |

The ground rules are non-negotiable, and they are what make the output
trustworthy:

1. **Deterministic rules first, AI explains** — never the reverse.
2. **Evidence levels on every finding** — `schema`, `statistics`, `workload`,
   `sample`, or `heuristic` — with the limitations stated outright.
3. **Read-only by default** — migrations and ETL scripts are generated for you
   to review. Nothing is ever executed against your database.
4. **Metadata first** — schemas, shapes and key patterns are stored. Rows are
   not. Live previews are masked, bounded, consent-gated and never persisted.
5. **Engine-neutral core** — one canonical `SchemaModel`; engine specifics live
   in adapters, dialect generators and rule sets.

### Who it is for

- **Backend and platform engineers** who have to reason about a schema they did
  not design.
- **DBA and data engineers** planning a migration, a split, or a polyglot
  topology.
- **Engineering leads and architects** who need a defensible recommendation
  about where a workload should live.

---

## Features

### Discover every schema, not just `public`

PostgreSQL introspection reads `pg_catalog` by OID, so cross-schema and
composite foreign keys are exact. Views, materialized views, partitioned tables
and enums keep their identity. Choose what to scan by name, list, glob
(`tenant_*`) or exclusion (`*, !audit`), and keep the foreign keys that leave
your selection — flagged rather than dropped.

### See the whole system

A database is rarely one schema and a system is rarely one database. DB
Architect models three levels:

```
project (the system)
  └─ datastore        name · engine · role · optional saved connection
       └─ version     one captured schema model, analysed and diagrammed
            └─ namespace   schema (PostgreSQL) · database (MySQL) · logical db (Redis)
                 └─ entity table · view · collection · key pattern
  └─ data flow        declared movement between two stores
```

Give each store a role — system of record, service database, read replica,
cache, sessions, queue, search index, analytics, archive — and the analyzer
surfaces what no single-database tool can see: entities stored twice, a
reference nothing enforces, a cache whose keys never expire, a store with no
system of record behind it.

### Evidence-backed analysis

Deterministic rules with a stable id, a severity, a confidence score, an
evidence level and a stated limitation. A heuristic is never dressed up as a
measured fact. Findings can be triaged, accepted or dismissed, and the audit
trail is kept.

### Diagrams you can work in

ELK-laid-out SVG with draggable nodes, schema colours, filters, relationship
highlighting, saved layouts, and true SVG and PNG export.

### Cross-engine transformation

Moving between SQL and documents is a modelling decision, not a type
conversion. The studio explains each decision, flags lossy conversions with a
reason, and shows rows turning into target rows or documents.

| Direction | What the planner decides |
|---|---|
| SQL → SQL | Canonical type families, defaults, index and constraint naming |
| SQL → MongoDB | Embed vs. reference with reasons, junctions → id arrays, PK → `_id`, `$jsonSchema` validators |
| MongoDB → SQL | Nested objects flattened or JSON, arrays → child tables or native arrays, inferred references → deferred FKs with orphan checks |

Output is a plan, the DDL or `mongosh` script, a standalone ETL script, a
runbook and validation queries. A plan can be saved as a new schema version and
re-enter the diagram and analysis loop.

### Reviewable migrations

Dialect-correct `up`/`down` scripts with risk classification, online-DDL
patterns, static validation and hashes. Nothing auto-executes. MySQL's
non-transactional DDL is flagged; SQLite rebuilds are called out.

### The Database Advisor

Describe the workload — data shape, consistency, scale, traffic, query mix,
volatility, latency, deployment, ecosystem, must-haves — and get a transparent
ranking of ten engines scored across 21 capabilities, with per-engine
strengths, honest watch-outs, a capability heat-map, polyglot suggestions and a
migration-path hint.

It is a **heuristic, not a benchmark**, and the UI says so.

### Redis has a schema too

Keys are sampled with `SCAN` (never `KEYS`), grouped into patterns, and
described by data type, value shape, TTL coverage, size and memory. Rules flag
missing TTLs, oversized keys, unstable key types and eviction risk.

### A grounded assistant

Three modes — architecture review, query and index tuning, operations and
migrations — answer from the structured model and the findings, citing rule ids.
Without a provider configured it uses the built-in rule-grounded generator. With
`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` set, the same grounded context goes to
that provider and the model id is shown verbatim in the UI.

### Reports and artifacts

HTML, Markdown and JSON reports containing the diagram, the inventory, the
findings and the analysis limitations — plus `schema.md`, `findings.json`,
`diagram.svg` and `migration-up.sql` for your pipeline.

---

## Supported engines

| Capability | PostgreSQL | MySQL | SQLite | MongoDB | Redis |
|---|---|---|---|---|---|
| Schema import | Yes | Yes | Yes | Yes | Yes (key dump) |
| Live introspection | All schemas | Many databases | — (file) | Yes | Yes |
| Analysis rules | Yes | Yes | Yes | Yes | Yes |
| Diagram | Yes | Yes | Yes | Yes | Yes |
| Migration generation | Yes | Yes (non-transactional DDL flagged) | Yes (rebuild guidance) | Yes | — |
| Transform source / target | Yes | Yes | Yes | Yes | — |
| Advisor | Yes | Yes | Yes | Yes | Yes |

The advisor additionally scores SQL Server, DynamoDB, Elasticsearch/OpenSearch,
ClickHouse and Cassandra. Engines are added in order of real-world usage, and
the top few are finished before the next one starts.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19, Tailwind CSS 4, `framer-motion`, `lucide-react`, `next-themes` |
| Language | TypeScript 7 (`strict`), with the TS 6 API alongside for typescript-eslint |
| Data | PostgreSQL via Drizzle ORM; `pg`, `mysql2`, `mongodb`, `ioredis` clients |
| Diagram layout | ELK (`elkjs`) |
| Tests | Vitest + Testing Library (jsdom) + Playwright for E2E |
| Tooling | ESLint 10 flat config, `drizzle-kit`, Bun |

---

## Getting started

### Requirements

- [Bun](https://bun.sh) 1.4+ (or Node.js 20.9+ with npm)
- PostgreSQL 14+ — optional for the demo, required for live features

### Install and run

```bash
git clone https://github.com/AnshRoshan/db-architect.git
cd db-architect

bun install --frozen-lockfile

cp .env.example .env.local     # set DATABASE_URL
bun run dev
```

Open <http://localhost:3000>.

> **No database yet?** The landing page has a one-click **demo workspace** with a
> seeded PostgreSQL (8 schemas), a MongoDB and a Redis. Sign-up, workspaces and
> live connections need `DATABASE_URL`.

The application schema is **bootstrapped automatically** on first use — there is
no `drizzle-kit push` step to remember.

---

## Scripts

| Command | What it does |
|---|---|
| `bun run dev` | Dev server on `:3000` |
| `bun run build` | Production build |
| `bun run start` | Serve the production build |
| `bun run lint` | ESLint across the repo |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test` | Vitest suite |
| `bun run test:watch` | Vitest in watch mode |
| `bun run check` | lint + typecheck + tests in one go |
| `bun run e2e` | HTTP-level end-to-end suite (needs a running app) |
| `bun run e2e:auth` | Browser-level auth flow (needs a running app) |
| `bun run db:generate` / `db:push` / `db:studio` | Drizzle schema tooling |

The same commands work with `npm run` if you prefer npm.

---

## Configuration

Everything lives in `.env.local`. See [`.env.example`](.env.example) for the
annotated list.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | For live features | Application PostgreSQL connection string |
| `DB_ARCHITECT_SECRET` | Production | Key that seals connection credentials (AES-256-GCM) |
| `DB_ARCHITECT_HOST_ALLOWLIST` | No | Hosts permitted past the SSRF guard |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | No | Provider-backed assistant |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | No | Provider-backed assistant |

---

## API

All endpoints live under `/api/v1` and are authenticated with a bearer token
issued at sign-in.

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/auth` | Sign up, sign in, demo sign-in |
| `GET/POST /api/v1/projects` | Workspaces |
| `GET/POST /api/v1/organizations` | Tenancy, members, roles |
| `GET/POST /api/v1/connections` | Saved connections |
| `POST /api/v1/connections/test` | Test a connection |
| `GET /api/v1/connections/schemas` | Discover schemas before scanning |
| `GET/POST /api/v1/scans` | Schema versions |
| `POST /api/v1/import` | Import a DDL / JSON / key dump |
| `GET/POST /api/v1/architecture` | Stores, roles, flows, cross-store links |
| `GET/POST /api/v1/findings` | Findings and their triage state |
| `GET/POST /api/v1/diffs` | Version-to-version diff |
| `GET/POST /api/v1/migrations` | Migration plans |
| `POST /api/v1/transform` | Cross-engine transformation plan |
| `GET /api/v1/dashboard` | Workspace overview |
| `GET/POST /api/v1/diagrams` | Saved diagram layouts |
| `GET /api/v1/reports` | HTML / Markdown / JSON reports |
| `POST /api/v1/ai` | Grounded assistant |
| `GET /api/health` | Liveness and schema readiness |

---

## Project layout

```
src/
  app/
    page.tsx                 landing page
    app/page.tsx             workspace shell
    api/v1/**                REST surface
  components/
    app-shell/               sidebar, top bar, command palette
    views/                   dashboard, architecture, explorer, analysis, …
    motion.tsx               motion primitives
    ui.tsx                   shared design-system primitives
  db/
    schema.ts                Drizzle schema
    index.ts                 lazily-created pool
  lib/
    schema-model.ts          the canonical model
    dsl.ts                   SQL DDL / Mongo JSON / YAML parsing
    analysis.ts              deterministic rules
    architecture.ts          stores, roles, flows, cross-store links
    transform.ts             cross-engine planning and row transforms
    diff-migrate.ts          diff and migration generation
    advisor.ts               explainable engine scoring
    connectors.ts            adapter registry
    introspection.ts         MySQL / Mongo / guarded live access
    pg-introspection.ts      PostgreSQL via pg_catalog
    redis-model.ts           key-pattern inference
    redis-introspection.ts   live Redis sampling
  db/                        storage
docs/SPEC.md                 full specification and design rationale
tests/                       Vitest suite
e2e/                         HTTP and browser end-to-end scripts
```

---

## Testing

```bash
bun run test
```

The suite covers dialect detection and parsing (PostgreSQL, MySQL, SQLite,
MongoDB), analysis rules, every transform direction, ETL script syntax,
advisor rankings, migration safety, the architecture model, the Redis key
model, the grounded assistant, and DOM behaviour including session transport.

End-to-end scripts need a running app:

```bash
bun run dev
BASE_URL=http://127.0.0.1:3000 bun run e2e
```

---

## Security

Read-only by default. Credentials are sealed with AES-256-GCM and never
returned by an API. Passwords use scrypt; session tokens are 256-bit random
values stored only as SHA-256 hashes. Live introspection is blocked from
metadata, loopback and private ranges unless explicitly allowlisted. Every
request is tenant-scoped and RBAC is enforced server-side.

Known limitations are documented rather than hidden — see
[SECURITY.md](SECURITY.md).

---

## Roadmap

| # | Item | Status |
|---|---|---|
| 1 | Cross-engine Transformation Studio | Shipped |
| 2 | Database Selection Advisor | Shipped |
| 3 | MySQL support | Shipped |
| 4 | SQLite support | Shipped |
| 5 | Redis key-model analysis | Shipped |
| 6 | Multi-schema PostgreSQL + multi-store architecture | Shipped |
| 7 | SQL Server support | Next |
| 8 | Workload evidence ingestion (`pg_stat_statements`, slow logs, explain, Mongo profiler) | Next |
| 9 | Background job queue and workers for async, cancellable, retried scans | Next |
| 10 | CI/CD drift detection and PR comments | Planned |

The in-app **Roadmap** view renders the same data from
[`src/lib/roadmap.ts`](src/lib/roadmap.ts).

---

## Contributing

Issues and pull requests are welcome — start with
[CONTRIBUTING.md](CONTRIBUTING.md). The short version: deterministic rules
first, evidence on every finding, read-only by default, and never reuse a
rule id.

```bash
bun run check   # lint + typecheck + tests
```

---

## Documentation

- [`docs/SPEC.md`](docs/SPEC.md) — product definition, architecture, rule
  catalogue, security model and the honest list of known gaps
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to add an engine, and the
  principles a change must not break
- [`SECURITY.md`](SECURITY.md) — threat model, reporting, known limitations
- [`SUPPORT.md`](SUPPORT.md) — where to ask for help

---

## License

[MIT](LICENSE) © Ansh Roshan

---

<div align="center">
  <sub>Deterministic rules first. Evidence over guesswork. Nothing is ever executed against your database.</sub>
</div>

