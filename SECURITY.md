# Security Policy

## Supported versions

DB Architect is under active development. Security fixes land on `main` and are
released with the next tag.

| Version | Supported |
|---|---|
| `main` / latest release | Yes |
| Older commits and forks | No — upgrade to the latest release |

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub Security Advisories:

**[Report a vulnerability](https://github.com/AnshRoshan/db-architect/security/advisories/new)**

Include:

- the affected version or commit,
- a description of the issue and its impact,
- reproduction steps or a proof of concept,
- any suggested remediation.

You can expect an acknowledgement within a few days. If a fix is warranted we
will agree a disclosure timeline with you, and credit you in the advisory unless
you prefer to stay anonymous.

## Threat model in one paragraph

DB Architect reads database *metadata*. It is designed so that a compromised
or careless deployment does not become a data-exfiltration path: connections are
read-only, live previews are masked, bounded and consent-gated, and stored
credentials are encrypted with AES-256-GCM. The application database holds
workspace, session and finding data — not your rows.

## Security properties the code maintains

- **Read-only by default.** Analysis never writes to a source database. Migrations
  and ETL scripts are generated as artifacts and are never executed by the app.
- **Encrypted credentials.** Connection passwords are sealed with AES-256-GCM.
  No API response ever returns a secret. Set `DB_ARCHITECT_SECRET` in production
  — the `DATABASE_URL` digest fallback exists only for local development.
- **SSRF protection.** Connection hosts in metadata, loopback and private ranges
  are rejected unless explicitly allowlisted via `DB_ARCHITECT_HOST_ALLOWLIST`.
  The application's own database is treated as an explicitly trusted target.
- **Password storage.** User passwords are hashed with scrypt. Session tokens are
  256-bit random values, stored only as SHA-256 hashes, and issued as HTTP-only
  cookies.
- **Tenant isolation.** Every query is scoped to the caller's organisation and
  project. RBAC (`owner`, `admin`, `architect`, `developer`, `viewer`) is
  enforced server-side on every request.
- **Audit logging.** Sensitive operations, including `transform.preview_live`,
  are written to the audit log.
- **Data minimisation.** Schemas, shapes and key patterns are persisted. Rows are
  not. Live previews are masked and never stored.

## Known limitations

These are documented rather than hidden. Please do not report them as
vulnerabilities — report only if you find a way around the mitigation.

- **TLS certificate verification is relaxed** for live connections
  (`rejectUnauthorized: false`). Prefer `sslMode: "prefer"` and run your own
  trust store if the connection crosses an untrusted network.
- **Cross-store links are name-based heuristics.** A link is a candidate, never
  a constraint, and the UI labels it as such.
- **Live Redis and MySQL paths have not been exercised against real servers** in
  the build sandbox. The code paths are implemented and type-checked; treat
  first use on a production connection as a rehearsal.
- **`DB_ARCHITECT_SECRET` falls back to a `DATABASE_URL` digest** when unset.
  Always set it explicitly in a deployment.

## Out of scope

- Vulnerabilities in third-party dependencies with no reachable code path in
  this application — report those to the upstream project.
- Findings from automated scanners without a demonstrated impact.
- Denial of service caused by intentionally pointing the app at a hostile
  database.
