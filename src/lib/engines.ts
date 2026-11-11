// Engine registry — pure (no Node imports) so it is safe in client bundles.
export type Engine = "postgres" | "mysql" | "sqlite" | "mongodb";
export type EngineFamily = "relational" | "document";

export interface EngineMeta {
  id: Engine;
  label: string;
  short: string;
  family: EngineFamily;
  defaultPort: number | null;
  live: boolean; // live read-only introspection supported
  color: string;
  tagline: string;
}

export const ENGINES: Record<Engine, EngineMeta> = {
  postgres: { id: "postgres", label: "PostgreSQL", short: "PG", family: "relational", defaultPort: 5432, live: true, color: "#336791", tagline: "Advanced relational · JSONB · extensions" },
  mysql: { id: "mysql", label: "MySQL", short: "MY", family: "relational", defaultPort: 3306, live: true, color: "#00758f", tagline: "Ubiquitous relational · InnoDB · web workloads" },
  sqlite: { id: "sqlite", label: "SQLite", short: "SQ", family: "relational", defaultPort: null, live: false, color: "#0f80cc", tagline: "Embedded, serverless, single-file" },
  mongodb: { id: "mongodb", label: "MongoDB", short: "MG", family: "document", defaultPort: 27017, live: true, color: "#13aa52", tagline: "Document model · flexible schema" },
};

export const ENGINE_LIST: EngineMeta[] = Object.values(ENGINES);

export function isEngine(v: unknown): v is Engine {
  return typeof v === "string" && v in ENGINES;
}
export function parseEngine(v: unknown, fallback: Engine = "postgres"): Engine {
  return isEngine(v) ? v : fallback;
}
export function isRelational(e: string): boolean {
  return isEngine(e) && ENGINES[e].family === "relational";
}
export function engineLabel(e: string): string {
  return isEngine(e) ? ENGINES[e].label : e;
}

/** Heuristic dialect detection for pasted/uploaded SQL. */
export function detectSqlDialect(sql: string): Exclude<Engine, "mongodb"> {
  const s = sql.slice(0, 200_000);
  let my = 0, lite = 0, pg = 0;
  if (/`/.test(s)) my += 2;
  if (/ENGINE\s*=\s*(InnoDB|MyISAM|MEMORY)/i.test(s)) my += 3;
  if (/AUTO_INCREMENT/i.test(s)) my += 2;
  if (/\bUNSIGNED\b/i.test(s)) my += 1;
  if (/CHARSET\s*=|COLLATE\s*=|\/\*!\d+/i.test(s)) my += 2;
  if (/LOCK TABLES/i.test(s)) my += 1;
  if (/AUTOINCREMENT/i.test(s)) lite += 3;
  if (/\bPRAGMA\b/i.test(s)) lite += 3;
  if (/WITHOUT ROWID/i.test(s)) lite += 3;
  if (/sqlite_/i.test(s)) lite += 2;
  if (/::[a-z]/i.test(s)) pg += 2;
  if (/\b(big)?serial\b/i.test(s)) pg += 2;
  if (/gen_random_uuid|nextval|timestamptz|jsonb|CREATE EXTENSION|uuid_generate/i.test(s)) pg += 2;
  if (/\bpublic\./i.test(s)) pg += 1;
  if (/\bGENERATED\b.*\bAS IDENTITY\b/i.test(s)) pg += 2;
  if (my > pg && my >= lite) return "mysql";
  if (lite > pg && lite > my) return "sqlite";
  return "postgres";
}
