import { Engine, ENGINES } from "./engines";
import type { SchemaModel } from "./schema-model";
import type { Row } from "./transform";
import {
  validateHost, validateMongoUri, maskConnection,
  testPostgresConnection, introspectPostgres, samplePostgres,
  testMysqlConnection, introspectMysql, sampleMysql,
  testMongoConnection, introspectMongo, sampleMongo,
  type SampleEntity, type SampleWhere,
} from "./introspection";

// Database adapter registry: one interface per engine so scans, tests and the
// transformation preview never branch on engine inside route handlers.
type Cfg = Record<string, unknown>;
export interface TestResult { ok: boolean; version?: string; collections?: number; latencyMs: number; error?: string }
export interface Adapter {
  engine: Engine;
  live: boolean;
  validate(c: Cfg): { ok: boolean; reason?: string };
  /** Fields that get encrypted at rest. */
  credentials(c: Cfg): Cfg;
  display(c: Cfg): { host: string; masked: string; database: string; username: string | null; port: number | null };
  test(creds: Cfg): Promise<TestResult>;
  introspect(creds: Cfg, opts?: { sampleSize?: number }): Promise<SchemaModel>;
  sample(creds: Cfg, entity: SampleEntity, limit: number, where?: SampleWhere): Promise<Row[]>;
}

const s = (v: unknown, d = "") => (v === undefined || v === null ? d : String(v));

function sqlAdapter(engine: "postgres" | "mysql"): Adapter {
  const port = ENGINES[engine].defaultPort!;
  const cfg = (c: Cfg) => ({ host: s(c.host).trim(), port: Number(c.port ?? port), database: s(c.database, engine === "postgres" ? "postgres" : ""), username: s(c.username), password: s(c.password), sslMode: s(c.sslMode, "prefer"), schemaSelection: s(c.schemaSelection ?? c.schema, "public") });
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
    introspect: (c) => (engine === "postgres" ? introspectPostgres(cfg(c)) : introspectMysql(cfg(c))),
    sample: (c, e, n, w) => (engine === "postgres" ? samplePostgres(cfg(c), e, n, w) : sampleMysql(cfg(c), e, n, w)),
  };
}

const mongo: Adapter = {
  engine: "mongodb", live: true,
  validate: (c) => validateMongoUri(s(c.uri)),
  credentials: (c) => ({ uri: s(c.uri), database: s(c.database), sampleSize: Number(c.sampleSize ?? 200) }),
  display(c) { return { host: s(c.uri).replace(/\/\/[^@/\s]+@/, "//***@").slice(0, 500), masked: maskConnection("mongodb", "atlas/host", s(c.database), null), database: s(c.database), username: null, port: null }; },
  test: (c) => testMongoConnection({ uri: s(c.uri), database: s(c.database) }),
  introspect: (c, o) => introspectMongo({ uri: s(c.uri), database: s(c.database), sampleSize: Math.max(10, Math.min(Number(o?.sampleSize ?? c.sampleSize ?? 200), 1000)) }),
  sample: (c, e, n, w) => sampleMongo({ uri: s(c.uri), database: s(c.database) }, e, n, w),
};

const sqlite: Adapter = {
  engine: "sqlite", live: false,
  validate: () => ({ ok: false, reason: "SQLite is file-based and cannot be reached over the network. Upload a .sql schema dump (sqlite3 .schema) instead." }),
  credentials: () => ({}),
  display: () => ({ host: "file", masked: "sqlite://file", database: "", username: null, port: null }),
  test: async () => ({ ok: false, latencyMs: 0, error: "SQLite has no network connection — upload a schema dump." }),
  introspect: async () => { throw new Error("SQLite live introspection is not available — upload a schema dump."); },
  sample: async () => { throw new Error("SQLite live sampling is not available."); },
};

export const ADAPTERS: Record<Engine, Adapter> = { postgres: sqlAdapter("postgres"), mysql: sqlAdapter("mysql"), sqlite, mongodb: mongo };
export function getAdapter(engine: Engine): Adapter { return ADAPTERS[engine]; }
