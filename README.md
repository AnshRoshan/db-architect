# DB Architect

Database-agnostic architecture intelligence. DB Architect reads the databases you actually run — a PostgreSQL with ten schemas, a second service database, a Redis in front — and turns them into diagrams, evidence-backed findings, reviewable migrations, cross-engine transformation plans, an explainable database recommendation, and a map of how the whole system fits together.

## What it does

| Area | Summary |
|---|---|
| **Every schema** | Discover all schemas on a server, select by list, glob (`tenant_*`) or exclusion (`*, !audit`), and keep foreign keys that cross schema boundaries. Views, materialized views and partitioned tables keep their identity. |
| **Every database** | A project is a *system of datastores*. Each store has an engine and a role (system of record, service database, cache, replica…). Declare how data flows between them. |
| **Architecture analysis** | Schema dependency graph inside each store; references, duplicated entities and cached copies inferred across stores; `ARCH-*` and `PG-SCHEMA-*` rules. |
| **Engines** | PostgreSQL, MySQL, SQLite, MongoDB and Redis (key-pattern model with TTL coverage and big-key detection). |
| **Analysis** | Deterministic rules with severity, confidence, evidence level and limitations. |
| **Diagrams** | ELK-laid-out interactive SVG with schema colours, filters, saved layouts, export. |
| **Transform / Migrate** | Cross-engine transformation plans with data preview and ETL scripts; dialect-correct migrations. Nothing is ever executed. |
| **Advisor** | Workload-driven ranking of ten engines across 21 capabilities. |

See [`docs/SPEC.md`](docs/SPEC.md) for the full specification; section 10 covers schemas, datastores and architecture.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 5 · Tailwind CSS 4 · PostgreSQL via Drizzle ORM · Vitest + Testing Library

## Getting started

```bash
npm install
cp .env.example .env        # set DATABASE_URL
npm run dev
```

Open http://localhost:3000 and choose **Open the live demo**: it signs you into a workspace with a pre-analysed sample system (PostgreSQL with 8 schemas + MongoDB + Redis). The application schema is created on first request; no migration step is required.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Application database (required). |
| `DB_ARCHITECT_SECRET` | Key material for encrypting saved connection credentials. Set a dedicated value in production. |
| `DB_ARCHITECT_HOST_ALLOWLIST` | Comma-separated private/loopback hosts that may be scanned (blocked by default). |

## Checks

```bash
npx tsc --noEmit            # types
npx vitest run              # 74 unit and DOM tests
npm run build               # production build
node e2e/architecture.e2e.mjs   # 50 HTTP checks against a running app (see the file header)
```

The end-to-end script exercises the demo system, architecture editing, imports, and — when a PostgreSQL database loaded with the multi-schema fixture is reachable — live schema discovery and multi-schema scans.

## Notes

- **Read-only by default.** Analysis never writes to a source; migrations and ETL are generated as reviewable artifacts.
- **Metadata first.** Schemas, shapes and key patterns are stored; rows and values are not.
- **Verification status.** Live PostgreSQL multi-schema introspection is verified end to end. The live Redis and MySQL multi-database paths are implemented and type-checked, and their model builders are unit-tested, but they have not been run against real servers here.
- Cross-store links are inferred from names and are shown as candidates with a confidence, never as constraints. Data flows are declared by you, not observed.
