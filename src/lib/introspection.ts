import { Pool, Client } from "pg";
import { SchemaModel, emptyModel, entityId, fieldId, indexId, constraintId } from "./schema-model";
import type { Row } from "./transform";
import { sanitizeValue } from "./transform";
import { deriveExplicitRelationships } from "./dsl";

// ─── SSRF-safe host validation ─────────────────────────────────────
const BLOCKED = [/^169\.254\.169\.254/, /^metadata\.google/, /^localhost$/i, /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^\[?::1\]?$/, /^0\.0\.0\.0/];

/** Hosts explicitly approved by deployment configuration (private-network opt-in). */
function hostAllowlist(): string[] {
  const raw = process.env.DB_ARCHITECT_HOST_ALLOWLIST ?? "";
  const entries = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  // The application's own database is an explicitly trusted target so the
  // connect → introspect → analyze workflow can be exercised safely.
  try {
    const selfHost = new URL(process.env.DATABASE_URL ?? "").hostname.toLowerCase();
    if (selfHost) entries.push(selfHost);
  } catch {
    /* ignore malformed DATABASE_URL */
  }
  return entries;
}

export function validateHost(host: string): { ok: boolean; reason?: string } {
  const h = host.trim().toLowerCase();
  if (!h) return { ok: false, reason: "Host is required" };
  if (h.length > 253) return { ok: false, reason: "Host too long" };
  if (!hostAllowlist().includes(h)) {
    for (const re of BLOCKED) {
      if (re.test(h)) return { ok: false, reason: `Host ${host} is in a restricted range (SSRF policy). Private/loopback targets require an explicit allowlist entry.` };
    }
  }
  if (/[^a-z0-9.\-_:[\]]/i.test(h)) return { ok: false, reason: "Host contains illegal characters" };
  return { ok: true };
}

export function maskConnection(engine: string, host: string | null, database: string | null, username: string | null): string {
  if (engine === "mongodb") return `mongodb://***@${host ?? "?"}:${"***"}/${database ?? ""}`;
  if (engine === "mysql") return `mysql://${username ?? "?"}:***@${host ?? "?"}/${database ?? ""}`;
  return `postgresql://${username ?? "?"}:***@${host ?? "?"}/${database ?? ""}`;
}

// ─── PostgreSQL live introspection (read-only catalog queries) ─────
export interface PgConnConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslMode?: string;
  schemaSelection?: string;
  timeoutMs?: number;
}

export async function testPostgresConnection(cfg: PgConnConfig): Promise<{ ok: boolean; version?: string; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  const hv = validateHost(cfg.host);
  if (!hv.ok) return { ok: false, latencyMs: 0, error: hv.reason };
  const ssl = await resolvePgSsl(cfg);
  const pool = new Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.username,
    password: cfg.password,
    ssl,
    connectionTimeoutMillis: Math.min(cfg.timeoutMs ?? 8000, 10000),
    query_timeout: 8000,
    max: 1,
  });
  try {
    const r = await pool.query("SHOW server_version");
    return { ok: true, version: r.rows[0]?.server_version, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: sanitizeDbError(e) };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function introspectPostgres(cfg: PgConnConfig, onStage?: (s: string) => void): Promise<SchemaModel> {
  const hv = validateHost(cfg.host);
  if (!hv.ok) throw new Error(hv.reason);
  const ssl = await resolvePgSsl(cfg);
  const pool = new Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.username,
    password: cfg.password,
    ssl,
    connectionTimeoutMillis: 10000,
    query_timeout: 20000,
    max: 2,
  });
  try {
    onStage?.("connecting");
    const ver = await pool.query("SHOW server_version");
    const version = ver.rows[0]?.server_version ?? null;
    const model = emptyModel("postgres", cfg.database);
    model.version = version;
    model.sourceMetadata.source = "introspection:postgres";
    const schemaSel = (cfg.schemaSelection ?? "public").split(",").map((s) => s.trim()).filter(Boolean);

    onStage?.("introspecting");
    // tables + columns
    const cols = await pool.query(
      `SELECT table_schema, table_name, column_name, data_type, udt_name,
              is_nullable, column_default, is_generated, is_identity,
              character_maximum_length, numeric_precision, numeric_scale
       FROM information_schema.columns
       WHERE table_schema = ANY($1)
       ORDER BY table_schema, table_name, ordinal_position`,
      [schemaSel.length ? schemaSel : ["public"]]
    );
    const tableKinds = await pool.query(
      `SELECT schemaname, tablename FROM pg_catalog.pg_tables WHERE schemaname = ANY($1)`,
      [schemaSel.length ? schemaSel : ["public"]]
    );
    const kindSet = new Set(tableKinds.rows.map((r) => `${r.schemaname}.${r.tablename}`));
    model.namespaces = [...new Set(cols.rows.map((r) => r.table_schema))];

    const entMap = new Map<string, (typeof model.entities)[number]>();
    for (const r of cols.rows) {
      const full = `${r.table_schema}.${r.table_name}`;
      if (!entMap.has(full)) {
        const eid = entityId("postgres", r.table_schema, r.table_name);
        const ent = {
          id: eid,
          name: full,
          shortName: r.table_name,
          namespace: r.table_schema,
          kind: "table" as const,
          engine: "postgres" as const,
          fields: [],
          indexes: [],
          constraints: [],
          metadata: { isPgTable: kindSet.has(full) },
        };
        entMap.set(full, ent);
        model.entities.push(ent);
      }
      const ent = entMap.get(full)!;
      ent.fields.push({
        id: fieldId(ent.id, r.column_name),
        name: r.column_name,
        type: r.character_maximum_length ? `${r.data_type}(${r.character_maximum_length})` : r.data_type,
        nullable: r.is_nullable === "YES",
        defaultValue: r.column_default ?? null,
        generated: r.is_generated !== "NEVER" ? r.is_generated : null,
        identity: r.is_identity !== "NO" ? r.is_identity : null,
      });
    }
    // constraints
    onStage?.("normalizing");
    const cons = await pool.query(
      `SELECT tc.table_schema, tc.table_name, tc.constraint_name, tc.constraint_type,
              kcu.column_name, ccu.table_schema AS ref_schema, ccu.table_name AS ref_table, ccu.column_name AS ref_column,
              rc.delete_rule, rc.update_rule, cc.check_clause
       FROM information_schema.table_constraints tc
       LEFT JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       LEFT JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
       LEFT JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
       LEFT JOIN information_schema.check_constraints cc ON tc.constraint_name = cc.constraint_name AND tc.table_schema = cc.constraint_schema
       WHERE tc.table_schema = ANY($1)`,
      [schemaSel.length ? schemaSel : ["public"]]
    );
    const consByName = new Map<string, { ent: string; kind: string; cols: string[]; refS?: string; refT?: string; refC: string[]; del?: string; upd?: string; check?: string }>();
    for (const r of cons.rows) {
      const key = `${r.table_schema}.${r.table_name}.${r.constraint_name}`;
      if (!consByName.has(key)) {
        consByName.set(key, { ent: `${r.table_schema}.${r.table_name}`, kind: r.constraint_type, cols: [], refS: r.ref_schema, refT: r.ref_table, refC: [], del: r.delete_rule, upd: r.update_rule, check: r.check_clause });
      }
      const g = consByName.get(key)!;
      if (r.column_name && !g.cols.includes(r.column_name)) g.cols.push(r.column_name);
      if (r.ref_column && !g.refC.includes(r.ref_column)) g.refC.push(r.ref_column);
    }
    for (const [key, g] of consByName) {
      const ent = entMap.get(g.ent);
      if (!ent) continue;
      const cname = key.split(".").slice(2).join(".");
      const kind = g.kind === "PRIMARY KEY" ? "primary_key" : g.kind === "FOREIGN KEY" ? "foreign_key" : g.kind === "UNIQUE" ? "unique" : "check";
      ent.constraints.push({
        id: constraintId(ent.id, cname),
        name: cname,
        kind: kind as "primary_key",
        columns: g.cols,
        referencedEntity: g.refT ? `${g.refS}.${g.refT}` : null,
        referencedColumns: g.refC,
        onDelete: g.del ?? null,
        onUpdate: g.upd ?? null,
        definition: g.check ?? null,
      });
      if (kind === "primary_key") {
        for (const c of g.cols) {
          const f = ent.fields.find((x) => x.name === c);
          if (f) {
            f.isPrimaryKey = true;
            f.nullable = false;
          }
        }
      }
    }
    // indexes
    const idx = await pool.query(
      `SELECT schemaname, tablename, indexname, indexdef FROM pg_catalog.pg_indexes WHERE schemaname = ANY($1)`,
      [schemaSel.length ? schemaSel : ["public"]]
    );
    for (const r of idx.rows) {
      const full = `${r.schemaname}.${r.tablename}`;
      const ent = entMap.get(full);
      if (!ent) continue;
      const colsM = String(r.indexdef).match(/\(([^)]+)\)/);
      const colsList = colsM ? colsM[1].split(",").map((s: string) => s.replace(/"/g, "").trim().split(" ")[0]) : [];
      const method = (String(r.indexdef).match(/USING\s+(\w+)/i)?.[1] ?? "btree").toLowerCase();
      ent.indexes.push({
        id: indexId(ent.id, r.indexname),
        name: r.indexname,
        columns: colsList,
        method,
        unique: /UNIQUE/i.test(String(r.indexdef)),
        partial: /WHERE/i.test(String(r.indexdef)),
        predicate: String(r.indexdef).match(/WHERE\s+(.+)$/i)?.[1] ?? null,
        expression: /\(.*\(/.test(colsM?.[1] ?? "") || /lower\(|upper\(/i.test(String(r.indexdef)),
        definition: r.indexdef,
      });
    }
    // optional stats (best-effort, never fatal)
    try {
      const stats = await pool.query(`SELECT relname, n_live_tup FROM pg_stat_user_tables LIMIT 500`);
      for (const r of stats.rows) {
        const ent = model.entities.find((e) => e.shortName === r.relname);
        if (ent) ent.rowEstimate = Number(r.n_live_tup);
      }
    } catch {
      model.sourceMetadata.limitations.push("pg_stat_user_tables not accessible with this role; row estimates omitted.");
    }
    model.sourceMetadata.limitations.push("Runtime workload (pg_stat_statements, EXPLAIN) requires extra grants; schema-evidence only unless provided.");
    deriveExplicitRelationships(model);
    return model;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

// ─── MongoDB live introspection (bounded sampling, read-only) ─────
export interface MongoConnConfig {
  uri: string;
  database: string;
  sampleSize?: number;
  collections?: string[];
}

export function validateMongoUri(uri: string): { ok: boolean; reason?: string } {
  if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://"))
    return { ok: false, reason: "URI must start with mongodb:// or mongodb+srv://" };
  if (uri.includes("@") === false && uri.includes("localhost") === false && uri.includes("127.0.0.1") === false) {
    // allow Atlas without explicit @ check? keep permissive
  }
  if (uri.length > 2000) return { ok: false, reason: "URI too long" };
  return { ok: true };
}

export async function testMongoConnection(cfg: MongoConnConfig): Promise<{ ok: boolean; collections?: number; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  const v = validateMongoUri(cfg.uri);
  if (!v.ok) return { ok: false, latencyMs: 0, error: v.reason };
  try {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(cfg.uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
    await client.connect();
    const db = client.db(cfg.database || undefined);
    const cols = await db.listCollections().toArray();
    await client.close();
    return { ok: true, collections: cols.length, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: sanitizeDbError(e) };
  }
}

export async function introspectMongo(cfg: MongoConnConfig, onStage?: (s: string) => void): Promise<SchemaModel> {
  const v = validateMongoUri(cfg.uri);
  if (!v.ok) throw new Error(v.reason);
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(cfg.uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  try {
    onStage?.("connecting");
    const db = client.db(cfg.database || undefined);
    const all = await db.listCollections().toArray();
    const names = (cfg.collections?.length ? all.filter((c) => cfg.collections!.includes(c.name)) : all).map((c) => c.name);
    const model = emptyModel("mongodb", db.databaseName);
    model.namespaces = ["main"];
    model.sourceMetadata.source = "introspection:mongodb";
    const N = Math.max(10, Math.min(cfg.sampleSize ?? 200, 1000));
    onStage?.("introspecting");
    const { inferShape } = await import("./dsl");
    for (const cname of names.slice(0, 100)) {
      onStage?.(`sampling ${cname}`);
      const coll = db.collection(cname);
      const [indexes, options] = await Promise.all([
        coll.listIndexes().toArray().catch(() => []),
        db.listCollections({ name: cname }).toArray().catch(() => []),
      ]);
      const sample = await coll.aggregate([{ $sample: { size: Math.min(N, 500) } }]).toArray().catch(() => []);
      // strip values for storage (metadata-first: keep shapes, not raw docs)
      const shape = inferShape(
        sample.map((d) => {
          const o: Record<string, unknown> = {};
          for (const [k, val] of Object.entries(d as Record<string, unknown>)) o[k] = val;
          return o;
        }),
        cname,
        Math.max(1, sample.length)
      );
      // redact sample values
      for (const f of shape) delete (f as { sampleValues?: unknown }).sampleValues;
      const eid = entityId("mongodb", "main", cname);
      model.entities.push({
        id: eid,
        name: cname,
        shortName: cname,
        namespace: "main",
        kind: "collection",
        engine: "mongodb",
        fields: shape,
        indexes: indexes.map((ix: Record<string, unknown>) => ({
          id: indexId(eid, String(ix.name)),
          name: String(ix.name),
          columns: ix.key ? Object.keys(ix.key as object) : [],
          method: "btree",
          unique: Boolean(ix.unique),
          partial: Boolean(ix.partialFilterExpression),
          predicate: ix.partialFilterExpression ? JSON.stringify(ix.partialFilterExpression) : null,
          kind: ix.expireAfterSeconds !== undefined ? "ttl" : undefined,
          ttlSeconds: typeof ix.expireAfterSeconds === "number" ? (ix.expireAfterSeconds as number) : null,
          definition: JSON.stringify(ix),
        })),
        constraints: [],
        metadata: { validator: (options[0] as { options?: { validator?: unknown } })?.options?.validator ?? null, sampled: sample.length },
      });
    }
    const { inferMongoReferences } = await import("./dsl");
    inferMongoReferences(model);
    model.sourceMetadata.sampleSize = N;
    model.sourceMetadata.limitations.push(
      `Observed schema from ≤${N} sampled documents per collection; inferred references are NOT constraints. No raw documents stored.`
    );
    return model;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export function sanitizeDbError(e: unknown): string {
  let msg = e instanceof Error ? e.message : String(e);
  // redact credentials that may leak in driver messages
  msg = msg.replace(/\/\/[^@/\s]+:[^@/\s]+@/g, "//***:***@");
  msg = msg.replace(/password[^,;]*/gi, "password=***");
  return msg.slice(0, 500);
}


// ─── TLS negotiation ("prefer" = try TLS, fall back only if unsupported) ─────
export async function resolvePgSsl(cfg: PgConnConfig): Promise<false | { rejectUnauthorized: boolean }> {
  if (cfg.sslMode === "disable") return false;
  const tls = { rejectUnauthorized: false };
  if (cfg.sslMode === "require") return tls;
  const probe = new Client({ host: cfg.host, port: cfg.port, database: cfg.database, user: cfg.username, password: cfg.password, ssl: tls, connectionTimeoutMillis: 6000 });
  try { await probe.connect(); await probe.end(); return tls; } catch (e) {
    await probe.end().catch(() => undefined);
    return /does not support SSL|SSL/i.test(e instanceof Error ? e.message : String(e)) ? false : tls;
  }
}

// ─── MySQL (read-only introspection) ───────────────────────────────
export interface MysqlConnConfig { host: string; port: number; database: string; username: string; password: string; sslMode?: string }

async function mysqlConnect(cfg: MysqlConnConfig) {
  const mysql = await import("mysql2/promise");
  return mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.username, password: cfg.password, database: cfg.database, connectTimeout: 8000, ssl: cfg.sslMode === "require" ? { rejectUnauthorized: false } : undefined });
}

export async function testMysqlConnection(cfg: MysqlConnConfig): Promise<{ ok: boolean; version?: string; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  const hv = validateHost(cfg.host);
  if (!hv.ok) return { ok: false, latencyMs: 0, error: hv.reason };
  let conn: Awaited<ReturnType<typeof mysqlConnect>> | null = null;
  try {
    conn = await mysqlConnect(cfg);
    const [rows] = await conn.query("SELECT VERSION() AS v");
    return { ok: true, version: (rows as { v: string }[])[0]?.v, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: sanitizeDbError(e) };
  } finally {
    await conn?.end().catch(() => undefined);
  }
}

export async function introspectMysql(cfg: MysqlConnConfig, onStage?: (s: string) => void): Promise<SchemaModel> {
  const hv = validateHost(cfg.host);
  if (!hv.ok) throw new Error(hv.reason);
  const conn = await mysqlConnect(cfg);
  try {
    onStage?.("connecting");
    const q = async <T,>(sql: string): Promise<T[]> => { const [rows] = await conn.query(sql, [cfg.database]); return rows as T[]; };
    const [vr] = await conn.query("SELECT VERSION() AS v");
    const model = emptyModel("mysql", cfg.database);
    model.version = (vr as { v: string }[])[0]?.v ?? null;
    model.namespaces = [cfg.database];
    model.sourceMetadata.source = "introspection:mysql";
    onStage?.("introspecting");
    const tables = await q<{ table_name: string; engine: string | null; table_collation: string | null; table_rows: number | null; table_comment: string; table_type: string }>(
      "SELECT TABLE_NAME AS table_name, ENGINE AS engine, TABLE_COLLATION AS table_collation, TABLE_ROWS AS table_rows, TABLE_COMMENT AS table_comment, TABLE_TYPE AS table_type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?");
    const ents = new Map<string, (typeof model.entities)[number]>();
    for (const t of tables) {
      const eid = entityId("mysql", cfg.database, t.table_name);
      const ent = { id: eid, name: `${cfg.database}.${t.table_name}`, shortName: t.table_name, namespace: cfg.database, kind: (/view/i.test(t.table_type) ? "view" : "table") as "view" | "table", engine: "mysql" as const, fields: [], indexes: [], constraints: [], comment: t.table_comment || null, rowEstimate: t.table_rows != null ? Number(t.table_rows) : null, metadata: { storageEngine: t.engine, collation: t.table_collation, charset: t.table_collation ? t.table_collation.split("_")[0] : null } };
      ents.set(t.table_name, ent);
      model.entities.push(ent);
    }
    const cols = await q<{ table_name: string; column_name: string; column_type: string; is_nullable: string; column_default: string | null; extra: string; column_key: string; column_comment: string }>(
      "SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default, EXTRA AS extra, COLUMN_KEY AS column_key, COLUMN_COMMENT AS column_comment FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION");
    for (const c of cols) {
      const ent = ents.get(c.table_name);
      if (!ent) continue;
      ent.fields.push({ id: fieldId(ent.id, c.column_name), name: c.column_name, type: c.column_type, nullable: c.is_nullable === "YES", defaultValue: c.column_default, identity: /auto_increment/i.test(c.extra) ? "auto_increment" : null, generated: /GENERATED/i.test(c.extra) && !/DEFAULT_GENERATED/i.test(c.extra) ? c.extra : null, comment: c.column_comment || null, isPrimaryKey: c.column_key === "PRI", isUnique: c.column_key === "UNI" });
    }
    onStage?.("normalizing");
    const stats = await q<{ table_name: string; index_name: string; non_unique: number; seq: number; column_name: string | null; index_type: string }>(
      "SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name, NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS seq, COLUMN_NAME AS column_name, INDEX_TYPE AS index_type FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX");
    const grouped = new Map<string, { table: string; name: string; unique: boolean; type: string; cols: string[] }>();
    for (const s of stats) {
      const key = `${s.table_name}.${s.index_name}`;
      if (!grouped.has(key)) grouped.set(key, { table: s.table_name, name: s.index_name, unique: Number(s.non_unique) === 0, type: String(s.index_type).toLowerCase(), cols: [] });
      if (s.column_name) grouped.get(key)!.cols.push(s.column_name);
    }
    for (const g of grouped.values()) {
      const ent = ents.get(g.table);
      if (!ent) continue;
      if (g.name === "PRIMARY") {
        ent.constraints.push({ id: constraintId(ent.id, "PRIMARY"), name: `${g.table}_pkey`, kind: "primary_key", columns: g.cols });
        for (const f of ent.fields) if (g.cols.includes(f.name)) { f.isPrimaryKey = true; f.nullable = false; }
        continue;
      }
      ent.indexes.push({ id: indexId(ent.id, g.name), name: g.name, columns: g.cols, unique: g.unique, method: g.type === "btree" ? "btree" : g.type });
      if (g.unique) ent.constraints.push({ id: constraintId(ent.id, g.name), name: g.name, kind: "unique", columns: g.cols });
    }
    const fks = await q<{ table_name: string; constraint_name: string; column_name: string; ref_table: string; ref_column: string; delete_rule: string; update_rule: string }>(
      "SELECT kcu.TABLE_NAME AS table_name, kcu.CONSTRAINT_NAME AS constraint_name, kcu.COLUMN_NAME AS column_name, kcu.REFERENCED_TABLE_NAME AS ref_table, kcu.REFERENCED_COLUMN_NAME AS ref_column, rc.DELETE_RULE AS delete_rule, rc.UPDATE_RULE AS update_rule FROM information_schema.KEY_COLUMN_USAGE kcu JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND rc.TABLE_NAME = kcu.TABLE_NAME WHERE kcu.TABLE_SCHEMA = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION");
    const fkMap = new Map<string, { table: string; name: string; cols: string[]; ref: string; refCols: string[]; del: string; upd: string }>();
    for (const f of fks) {
      const key = `${f.table_name}.${f.constraint_name}`;
      if (!fkMap.has(key)) fkMap.set(key, { table: f.table_name, name: f.constraint_name, cols: [], ref: f.ref_table, refCols: [], del: f.delete_rule, upd: f.update_rule });
      const g = fkMap.get(key)!;
      g.cols.push(f.column_name); g.refCols.push(f.ref_column);
    }
    for (const g of fkMap.values()) {
      const ent = ents.get(g.table);
      if (ent) ent.constraints.push({ id: constraintId(ent.id, g.name), name: g.name, kind: "foreign_key", columns: g.cols, referencedEntity: `${cfg.database}.${g.ref}`, referencedColumns: g.refCols, onDelete: g.del, onUpdate: g.upd });
    }
    model.sourceMetadata.limitations.push("MySQL table row counts are InnoDB estimates; workload evidence (performance_schema / slow log) is not collected yet.");
    deriveExplicitRelationships(model);
    return model;
  } finally {
    await conn.end().catch(() => undefined);
  }
}

// ─── Bounded, read-only row sampling (live data preview) ───────────
export type SampleEntity = { name: string; shortName: string; namespace: string };
export type SampleWhere = { column: string; values: unknown[] };

export async function samplePostgres(cfg: PgConnConfig, e: SampleEntity, limit: number, where?: SampleWhere): Promise<Row[]> {
  const hv = validateHost(cfg.host);
  if (!hv.ok) throw new Error(hv.reason);
  const ssl = await resolvePgSsl(cfg);
  const pool = new Pool({ host: cfg.host, port: cfg.port, database: cfg.database, user: cfg.username, password: cfg.password, ssl, connectionTimeoutMillis: 10000, query_timeout: 15000, max: 1 });
  const id = (s: string) => '"' + s.replace(/"/g, '""') + '"';
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const params: unknown[] = [];
    let text = `SELECT * FROM ${id(e.namespace)}.${id(e.shortName)}`;
    if (where) { text += ` WHERE ${id(where.column)} = ANY($1)`; params.push(where.values); }
    text += ` LIMIT ${Math.max(1, Math.min(limit, 50))}`;
    const r = await client.query(text, params);
    await client.query("ROLLBACK");
    return r.rows.map((row) => sanitizeValue(row) as Row);
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}

export async function sampleMysql(cfg: MysqlConnConfig, e: SampleEntity, limit: number, where?: SampleWhere): Promise<Row[]> {
  const hv = validateHost(cfg.host);
  if (!hv.ok) throw new Error(hv.reason);
  const conn = await mysqlConnect(cfg);
  const id = (s: string) => "`" + s.replace(/`/g, "``") + "`";
  try {
    await conn.query("SET SESSION TRANSACTION READ ONLY");
    const params: unknown[] = [];
    let text = `SELECT * FROM ${id(cfg.database)}.${id(e.shortName)}`;
    if (where) { text += ` WHERE ${id(where.column)} IN (?)`; params.push(where.values); }
    text += ` LIMIT ${Math.max(1, Math.min(limit, 50))}`;
    const [rows] = await conn.query(text, params);
    return (rows as Row[]).map((row) => sanitizeValue(row) as Row);
  } finally {
    await conn.end().catch(() => undefined);
  }
}

export async function sampleMongo(cfg: MongoConnConfig, e: SampleEntity, limit: number, where?: SampleWhere): Promise<Row[]> {
  const v = validateMongoUri(cfg.uri);
  if (!v.ok) throw new Error(v.reason);
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(cfg.uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  try {
    const filter = where ? { [where.column]: { $in: where.values } } : {};
    const docs = await client.db(cfg.database || undefined).collection(e.shortName).find(filter).limit(Math.max(1, Math.min(limit, 50))).toArray();
    return docs.map((d) => sanitizeValue(d) as Row);
  } finally {
    await client.close().catch(() => undefined);
  }
}
