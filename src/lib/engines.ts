// Engine registry — pure (no Node imports) so it is safe in client bundles.
export type Engine = "postgres" | "mysql" | "sqlite" | "mongodb" | "redis";
export type SqlEngine = "postgres" | "mysql" | "sqlite";
export type EngineFamily = "relational" | "document" | "keyvalue";

export interface EngineMeta {
  id: Engine;
  label: string;
  short: string;
  family: EngineFamily;
  defaultPort: number | null;
  live: boolean; // live read-only introspection supported
  color: string;
  tagline: string;
  /** What a namespace is called in this engine (schema, database, keyspace…). */
  namespaceLabel: string;
  /** What an entity is called in this engine. */
  entityLabel: string;
  /** Can be a source/target of the Transformation Studio and Diff & Migrate. */
  transformable: boolean;
}

export const ENGINES: Record<Engine, EngineMeta> = {
  postgres: { id: "postgres", label: "PostgreSQL", short: "PG", family: "relational", defaultPort: 5432, live: true, color: "#336791", tagline: "Advanced relational · many schemas · JSONB · extensions", namespaceLabel: "schema", entityLabel: "table", transformable: true },
  mysql: { id: "mysql", label: "MySQL", short: "MY", family: "relational", defaultPort: 3306, live: true, color: "#00758f", tagline: "Ubiquitous relational · InnoDB · web workloads", namespaceLabel: "database", entityLabel: "table", transformable: true },
  sqlite: { id: "sqlite", label: "SQLite", short: "SQ", family: "relational", defaultPort: null, live: false, color: "#0f80cc", tagline: "Embedded, serverless, single-file", namespaceLabel: "database", entityLabel: "table", transformable: true },
  mongodb: { id: "mongodb", label: "MongoDB", short: "MG", family: "document", defaultPort: 27017, live: true, color: "#13aa52", tagline: "Document model · flexible schema", namespaceLabel: "database", entityLabel: "collection", transformable: true },
  redis: { id: "redis", label: "Redis", short: "RD", family: "keyvalue", defaultPort: 6379, live: true, color: "#dc382d", tagline: "Key-value · caches, sessions, queues, counters", namespaceLabel: "logical db", entityLabel: "key pattern", transformable: false },
};

export const ENGINE_LIST: EngineMeta[] = Object.values(ENGINES);
/** Engines that can take part in schema transformation and migration generation. */
export const TRANSFORMABLE_ENGINES: EngineMeta[] = ENGINE_LIST.filter((e) => e.transformable);

export function isEngine(v: unknown): v is Engine {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ENGINES, v);
}
export function parseEngine(v: unknown, fallback: Engine = "postgres"): Engine {
  return isEngine(v) ? v : fallback;
}
export function isRelational(e: string): boolean {
  return isEngine(e) && ENGINES[e].family === "relational";
}
export function isKeyValue(e: string): boolean {
  return isEngine(e) && ENGINES[e].family === "keyvalue";
}
export function isTransformable(e: string): boolean {
  return isEngine(e) && ENGINES[e].transformable;
}
export function engineLabel(e: string): string {
  return isEngine(e) ? ENGINES[e].label : e;
}
export function engineColor(e: string): string {
  return isEngine(e) ? ENGINES[e].color : "#94a3b8";
}
export function namespaceLabel(e: string, plural = false): string {
  const base = isEngine(e) ? ENGINES[e].namespaceLabel : "namespace";
  return plural ? `${base}s` : base;
}

/** Heuristic dialect detection for pasted/uploaded SQL. */
export function detectSqlDialect(sql: string): SqlEngine {
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
  if (/CREATE SCHEMA/i.test(s)) pg += 2;
  if (/\bGENERATED\b.*\bAS IDENTITY\b/i.test(s)) pg += 2;
  if (my > pg && my >= lite) return "mysql";
  if (lite > pg && lite > my) return "sqlite";
  return "postgres";
}
