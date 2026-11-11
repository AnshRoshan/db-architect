# DB Architect

Database-agnostic architecture intelligence. Converts a database's actual structure into diagrams, evidence-backed findings, reviewable migrations, cross-engine transformation plans, and an explainable recommendation of which database a workload should use.

## Stack

- Next.js 16 (App Router, Turbopack)
- React 19, TypeScript 5
- Tailwind CSS 4
- PostgreSQL via Drizzle ORM
- Vitest + Testing Library

## Getting started

```bash
bun install --minimum-release-age=0
cp .env.example .env.local   # set DATABASE_URL
bun run dev
```

Open http://localhost:3000.

## Scripts

- `bun run dev` - start dev server
- `bun run build` - production build
- `bun run lint` - lint
- `bun run typecheck` - TypeScript check
- `bunx vitest run` - tests

## Notes

- Requires a PostgreSQL instance for live features. The UI ships with demo data so most views work without one.
- Read-only by default: migrations and ETL are generated as reviewable artifacts, never executed.
