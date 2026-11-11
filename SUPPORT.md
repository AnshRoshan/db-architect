# Support

## Where to ask

| I want to… | Go to |
|---|---|
| Report a bug | [Open an issue](https://github.com/AnshRoshan/db-architect/issues/new?template=bug_report.yml) |
| Suggest a feature | [Open an issue](https://github.com/AnshRoshan/db-architect/issues/new?template=feature_request.yml) |
| Ask a usage question | [Discussions](https://github.com/AnshRoshan/db-architect/discussions) |
| Report a vulnerability | [Security advisories](https://github.com/AnshRoshan/db-architect/security/advisories/new) — not a public issue |

There is no paid support channel. The project is maintained in the open and
responses land best when the report includes a minimal reproduction — a DDL
dump, a JSON document, or a Redis key dump that triggers the behaviour.

## Before you file

1. Search the [issues](https://github.com/AnshRoshan/db-architect/issues) — parser
   and rule bugs are often already known.
2. Check [docs/SPEC.md](docs/SPEC.md) for the intended behaviour, the engine
   support matrix and the honest list of known gaps.
3. Remove credentials from anything you attach. The app never needs a password
   to reproduce a parsing, rule or migration bug.

## Common questions

**Do I need a database to try it?**
No. The landing page has a one-click demo workspace with a seeded PostgreSQL
(8 schemas), MongoDB and Redis. Live connections, workspaces and sign-in need
`DATABASE_URL` pointing at a PostgreSQL instance.

**The build fails with "DATABASE_URL is required".**
The connection pool is created lazily now, so the build itself should succeed.
If you see this at runtime, set `DATABASE_URL` in `.env.local`.

**Which engines are actually live?**
PostgreSQL, MySQL, MongoDB and Redis have live read-only introspection.
SQLite is import-only. The full matrix is in
[docs/SPEC.md](docs/SPEC.md#6-engine-support-matrix).

**Does it write to my database?**
No. Analysis is read-only, live previews run inside read-only transactions, and
migrations and ETL scripts are generated for you to review and run yourself.

**Which version do I want?**
`main` is the latest work. Tagged releases are the stable choice.

## Debugging checklist

```bash
bun run lint        # ESLint
bun run typecheck   # tsc --noEmit
bun run test        # Vitest
bun run build       # next build
bun run dev         # dev server on :3000
```

`GET /api/health` returns `{ ok, schemaReady, tables }` and confirms the
application schema was bootstrapped. A `schemaReady: false` means the
`users`, `sessions`, `projects` and `schema_scans` tables are missing — the
app creates them itself on first use, so check that the database user has DDL
rights.
