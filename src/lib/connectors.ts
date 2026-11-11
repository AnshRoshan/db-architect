import { Engine, ENGINES } from "./engines";
import type { SchemaModel } from "./schema-model";
import type { Row } from "./transform";
import {
  validateHost, validateMongoUri, maskConnection,
  testPostgresConnection, samplePostgres,
  testMysqlConnection, introspectMysql, sampleMysql, listMysqlDatabases,
  testMongoConnection, introspectMongo, sampleMongo,
  type SampleEntity, type SampleWhere, type MysqlConnConfig,
} from "./introspection";
import { introspectPostgres, listPostgresSchemas, resolveSchemaSelection, type DiscoveredNamespace } from "./pg-introspection";
import { discoverRedis, introspectRedis, testRedisConnection } from "./redis-introspection";

// Database adapter registry: one interface per engine so scans, tests, discovery
// and the transformation preview never branch on engine inside route handlers.
type Cfg = Record<string, unknown>;
export interface TestResult { ok: boolean; version?: string; collections?: number; keys?: number; latencyMs: number; error?: string }
/** What a server contains before anything is scanned: schemas, databases or logical dbs. */
export interface Discovery { kind: string; namespaces: DiscoveredNamespace[]; note?: string }
export interface Adapter {
  engine: Engine;
  live: boolean;
  validate(c: Cfg): { ok: boolean; reason?: string };
  /** Fields that get encrypted at rest. */
  credentials(c: Cfg): Cfg;
  display(c: Cfg): { host: string; masked: string; database: string; username: string | null; port: number | null };
  test(creds: Cfg): Promise<TestResult>;
  discover(creds: Cfg): Promise<Discovery>;
  introspect(creds: Cfg, opts?: { sampleSize?: number }): Promise<SchemaModel>;
  sample(creds: Cfg, entity: SampleEntity, limit: number, where?: SampleWhere): Promise<Row[]>;
}

const s = (v: unknown, d = "") => (v === undefined || v === null ? d : String(v));

/** Combine per-database models (MySQL "schemas" are databases) into one store model. */
export function mergeModels(models: SchemaModel[], database: string): SchemaModel {
  const [first, ...rest] = models;
  const merged: SchemaModel = { ...first, database, entities: [...first.entities], relationships: [...first.relationships], dependencies: [...first.dependencies], namespaces: [...first.namespaces], warnings: [...first.warnings], sourceMetadata: { ...first.sourceMetadata, limitations: [...first.sourceMetadata.limitations] } };
  for (const m of rest) {
    merged.entities.push(...m.entities);
    merged.relationships.push(...m.relationships);
    merged.dependencies.push(...m.dependencies);
    for (const ns of m.namespaces) if (!merged.namespaces.includes(ns)) merged.namespaces.push(ns);
    merged.warnings.push(...m.warnings);
    for (const l of m.sourceMetadata.limitations) if (!merged.sourceMetadata.limitations.includes(l)) merged.sourceMetadata.limitations.push(l);
  }
  merged.catalog = { namespaces: merged.namespaces.map((name) => ({ name, tables: merged.entities.filter((e) => e.namespace === name && e.kind === "table").length, views: merged.entities.filter((e) => e.namespace === name && e.kind !== "table").length })) };
  return merged;
}

async function introspectMysqlSelection(c: MysqlConnConfig & { schemaSelection?: string }): Promise<SchemaModel> {
  const selection = (c.schemaSelection ?? "").trim();
  // "public" is the legacy default stored for every connection and means "the connected database" for MySQL.
  if (!selection || selection === "public" || selection === c.database) return introspectMysql(c);
  const available = (await listMysqlDatabases(c)).map((d) => d.name);
  const { selected } = resolveSchemaSelection(selection, available);
  if (!selected.length) throw new Error(`None of the requested databases exist (asked for: ${selection}). Available: ${available.join(", ") || "none"}.`);
  if (selected.length === 1) return introspectMysql({ ...c, database: selected[0] });
  const models: SchemaModel[] = [];
  for (const database of selected.slice(0, 25)) models.push(await introspectMysql({ ...c, database }));
  const merged = mergeModels(models, c.database || selected[0]);
  if (selected.length > 25) merged.warnings.push(`${selected.length} databases matched; the first 25 were scanned.`);
  return merged;
}

function sqlAdapter(engine: "postgres" | "mysql"): Adapter {
  const port = ENGINES[engine].defaultPort!;
  const cfg = (c: Cfg) => ({ host: s(c.host).trim(), port: Number(c.port ?? port), database: s(c.database, engine === "postgres" ? "postgres" : ""), username: s(c.username), password: s(c.password), sslMode: s(c.sslMode, "prefer"), schemaSelection: s(c.schemaSelection ?? c.schema, engine === "postgres" ? "*" : "") });
  return {
    engine, live: true,
    validate(c) {
      const x = cfg(c);
      const h = validateHost(x.host);
      if (!h.ok) return h;
      if (!x.password) return { ok: false, reason: "Password is required" };
      if (!x.username) return { ok: false, reason: "Username is required" };
      if (engine === "mysql" && !x.database) return { ok: false, reason: "Database name is required for MySQL" };
      return { ok: true };
    },
    credentials: (c) => cfg(c),
    display(c) { const x = cfg(c); return { host: x.host, masked: maskConnection(engine, x.host, x.database, x.username), database: x.database, username: x.username, port: x.port }; },
    test: (c) => (engine === "postgres" ? testPostgresConnection(cfg(c)) : testMysqlConnection(cfg(c))),
    async discover(c) {
      if (engine === "postgres") return { kind: "schema", namespaces: await listPostgresSchemas(cfg(c)) };
      return { kind: "database", namespaces: await listMysqlDatabases(cfg(c)), note: "In MySQL a schema is a database. Select several to model them as one store." };
    },
    introspect: (c) => (engine === "postgres" ? introspectPostgres(cfg(c)) : introspectMysqlSelection(cfg(c))),
    sample: (c, e, n, w) => (engine === "postgres" ? samplePostgres(cfg(c), e, n, w) : sampleMysql(cfg(c), e, n, w)),
  };
}

const mongo: Adapter = {
  engine: "mongodb", live: true,
  validate: (c) => validateMongoUri(s(c.uri)),
  credentials: (c) => ({ uri: s(c.uri), database: s(c.database), sampleSize: Number(c.sampleSize ?? 200) }),
  display(c) { return { host: s(c.uri).replace(/\/\/[^@/\s]+@/, "//***@").slice(0, 500), masked: maskConnection("mongodb", "atlas/host", s(c.database), null), database: s(c.database), username: null, port: null }; },
  test: (c) => testMongoConnection({ uri: s(c.uri), database: s(c.database) }),
  async discover(c) {
    const r = await testMongoConnection({ uri: s(c.uri), database: s(c.database) });
    if (!r.ok) throw new Error(r.error ?? "Could not connect");
    return { kind: "database", namespaces: [{ name: s(c.database) || "(default database)", tables: r.collections ?? 0, views: 0 }], note: "MongoDB is sampled one database at a time. Add each database as its own datastore." };
  },
  introspect: (c, o) => introspectMongo({ uri: s(c.uri), database: s(c.database), sampleSize: Math.max(10, Math.min(Number(o?.sampleSize ?? c.sampleSize ?? 200), 1000)) }),
  sample: (c, e, n, w) => sampleMongo({ uri: s(c.uri), database: s(c.database) }, e, n, w),
};

const redisCfg = (c: Cfg) => ({ host: s(c.host).trim(), port: Number(c.port ?? 6379), username: s(c.username), password: s(c.password), db: Number(c.db ?? c.database ?? 0) || 0, tls: s(c.sslMode) === "require" || c.tls === true, maxKeys: Number(c.maxKeys ?? c.sampleSize ?? 2000) || 2000, match: s(c.match), schemaSelection: /db\d|\*/.test(s(c.schemaSelection)) ? s(c.schemaSelection) : "", name: s(c.name) });
const redis: Adapter = {
  engine: "redis", live: true,
  validate: (c) => validateHost(redisCfg(c).host),
  credentials: (c) => ({ ...redisCfg(c), sslMode: redisCfg(c).tls ? "require" : "disable" }),
  display(c) { const x = redisCfg(c); return { host: x.host, masked: maskConnection("redis", `${x.host}:${x.port}`, String(x.db), x.username || null), database: `db${x.db}`, username: x.username || null, port: x.port }; },
  test: (c) => testRedisConnection(redisCfg(c)),
  async discover(c) { return { kind: "logical db", namespaces: await discoverRedis(redisCfg(c)), note: "Each logical database (SELECT n) is a separate keyspace." }; },
  introspect: (c, o) => introspectRedis({ ...redisCfg(c), ...(o?.sampleSize && !c.maxKeys ? { maxKeys: Math.max(o.sampleSize, 2000) } : {}) }),
  sample: async () => { throw new Error("Row sampling is not available for Redis — key shapes are captured during the scan."); },
};

const sqlite: Adapter = {
  engine: "sqlite", live: false,
  validate: () => ({ ok: false, reason: "SQLite is file-based and cannot be reached over the network. Upload a .sql schema dump (sqlite3 .schema) instead." }),
  credentials: () => ({}),
  display: () => ({ host: "file", masked: "sqlite://file", database: "", username: null, port: null }),
  test: async () => ({ ok: false, latencyMs: 0, error: "SQLite has no network connection — upload a schema dump." }),
  discover: async () => { throw new Error("SQLite has no network connection — upload a schema dump."); },
  introspect: async () => { throw new Error("SQLite live introspection is not available — upload a schema dump."); },
  sample: async () => { throw new Error("SQLite live sampling is not available."); },
};

export const ADAPTERS: Record<Engine, Adapter> = { postgres: sqlAdapter("postgres"), mysql: sqlAdapter("mysql"), sqlite, mongodb: mongo, redis };
export function getAdapter(engine: Engine): Adapter { return ADAPTERS[engine]; }
