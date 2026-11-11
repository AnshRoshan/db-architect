# Contributing to DB Architect

Thanks for taking the time to contribute. This project is about making database
structure legible and defensible, so contributions that improve accuracy,
evidence quality or honesty are the most valuable.

## Principles the codebase follows

These are not style preferences — they are the reason the output can be trusted.
A change that violates one of them will be asked to change.

1. **Deterministic rules first, AI explains.** A finding must be derivable from
   the schema, statistics, workload, samples or a named heuristic. The assistant
   may explain a finding; it must never invent one.
2. **Every finding carries its evidence level.** `schema`, `statistics`,
   `workload`, `sample` or `heuristic` — plus a stated limitation. A heuristic
   is never presented as a measured fact.
3. **Read-only by default.** The product never executes migrations or ETL
   against a source database. It generates reviewable artifacts.
4. **Metadata first.** Schemas, shapes and key patterns are stored. Rows are
   not. Live previews are masked, bounded, consent-gated and never persisted.
5. **Engine-neutral core.** One canonical `SchemaModel`. Engine specifics live
   in adapters, dialect generators and rule sets — never in the core.

## Getting set up

```bash
bun install --frozen-lockfile
cp .env.example .env.local   # set DATABASE_URL
bun run dev
```

The app runs without a database for most screens (there is a seeded demo
workspace), but live connections, workspaces and authentication need
PostgreSQL.

### TypeScript 7 and the TypeScript 6 API side by side

TypeScript 7 does not expose a programmatic API yet, and `typescript-eslint`
still needs the TS 6 one. The repo therefore installs both, following
Microsoft's [side-by-side guide](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0):

```jsonc
"devDependencies": {
  "@typescript/native": "npm:typescript@^7.0.2",   // the `tsc` binary - TS 7
  "typescript": "npm:@typescript/typescript6@^6.0.2" // the `typescript` module - TS 6 API
}
```

So `bun run typecheck` and `next build` type-check with **TS 7**, while ESLint
resolves `typescript` to the **TS 6** API that `typescript-eslint` supports.
Do not "simplify" this back to a single `typescript` entry — `typescript-eslint`
throws on TS 7 and linting stops working.

## Before you open a pull request

```bash
bun run check   # lint + typecheck + tests
bun run build   # production build
```

CI runs the same commands, plus CodeQL. All three must pass.

## Where things live

| Area | Path | Notes |
|---|---|---|
| Canonical model | `src/lib/schema-model.ts` | Changing this affects every engine |
| Parsers | `src/lib/dsl.ts` | SQL DDL, Mongo JSON, YAML/JSON DSL |
| Rules | `src/lib/analysis.ts` | Deterministic findings with rule ids |
| Architecture | `src/lib/architecture.ts` | Stores, roles, flows, cross-store links |
| Live introspection | `src/lib/introspection.ts`, `pg-introspection.ts`, `redis-introspection.ts` | Read-only, SSRF-guarded |
| Transforms | `src/lib/transform.ts`, `diff-migrate.ts`, `sql-dialects.ts` | Type mapping, DDL generation |
| Advisor | `src/lib/advisor.ts` | Transparent scoring, not a benchmark |
| API | `src/app/api/v1/**` | REST surface consumed by the workspace |
| UI | `src/components/**` | Design tokens in `src/app/globals.css` |
| Spec | `docs/SPEC.md` | Update alongside any behaviour change |

## Adding a database engine

An engine is a complete vertical slice. In order:

1. Parser support in `src/lib/dsl.ts` (or a new parser module).
2. Canonical type rows in `src/lib/type-map.ts`.
3. DDL generation in `src/lib/sql-dialects.ts` if the engine is relational.
4. Rules in `src/lib/analysis.ts` with a stable rule-id prefix.
5. Adapter entry in `src/lib/connectors.ts` and the registry in
   `src/lib/engines.ts`.
6. Advisor entry in `src/lib/advisor.ts`.
7. Fixtures in `src/lib/fixtures.ts` and tests in `tests/engine.test.ts`.
8. Documentation: the support matrix in `docs/SPEC.md` and this file's
   engine table.

Partial support is fine and honest — mark the engine `live: false` and say so in
the matrix rather than shipping a half-working introspection path.

## Rules and rule ids

Rule ids are a public contract. `PG-SCHEMA-001`, `ARCH-004`, `RD-TTL-002` and
friends are referenced by findings, reports and saved state. **Never renumber or
reuse an id.** Add a new id instead. If you change what an existing rule means,
call that out explicitly in the pull request — it can invalidate saved findings.

## Tests

- `tests/engine.test.ts` — parsers, rules, transforms, migrations, advisor.
- `tests/architecture.test.ts` — stores, flows, cross-store links, Redis model.
- `tests/ai.test.ts` — the grounded assistant and its evidence discipline.
- `tests/ui.test.tsx`, `tests/views.test.tsx`, `tests/auth-flow.test.tsx` — DOM
  behaviour, including session transport.

Use the fixture helpers in `src/lib/fixtures.ts` and
`src/lib/fixtures-polyglot.ts` rather than inline SQL, so the same shapes are
exercised across suites.

End-to-end scripts live in `e2e/` and need a running app:

```bash
bun run dev                 # in one terminal
BASE_URL=http://127.0.0.1:3000 bun run e2e
```

## Style

- TypeScript with `strict` on. No `any` unless it is genuinely unavoidable and
  explained.
- Follow the surrounding code. The codebase favours dense, readable modules
  over premature abstraction.
- No comments that restate the code. Comments explain *why* a decision was
  made — especially where the obvious implementation would be wrong.

## Commit messages

Short, imperative, and specific about the behaviour that changed:

```
fix: keep DEFAULT values when parsing MySQL dumps
feat: add Redis key-pattern analysis to the explorer
docs: explain the ARCH-004 rule in the spec
```

## Reporting bugs

Use the bug report template. A minimal DDL or JSON input that reproduces the
problem is worth more than a long description. Never paste credentials — the
app does not need them to reproduce a parsing or rule bug.

## Security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
