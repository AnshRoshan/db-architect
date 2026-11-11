import Redis from "ioredis";
import type { SchemaModel } from "./schema-model";
import { buildRedisModel, keyPattern, type RedisKeySample } from "./redis-model";
import { sanitizeDbError, validateHost } from "./introspection";
import type { DiscoveredNamespace } from "./pg-introspection";

// ─── Redis live introspection (read-only, bounded) ─────────────────
// Only non-mutating commands are issued: INFO, DBSIZE, SCAN, TYPE, TTL,
// MEMORY USAGE, *LEN/*CARD, HSCAN, GETRANGE, XREVRANGE, CONFIG GET.
// Values are inspected for their shape and discarded — never returned or stored.

export interface RedisConnConfig {
  host: string; port: number; username?: string; password?: string; db?: number; tls?: boolean;
  /** Upper bound on sampled keys across all scanned logical databases. */
  maxKeys?: number;
  match?: string;
  /** "db0,db2" or "*" — which logical databases to sample. Defaults to `db`. */
  schemaSelection?: string;
  name?: string;
}

async function open(cfg: RedisConnConfig, db = cfg.db ?? 0): Promise<Redis> {
  const hv = validateHost(cfg.host);
  if (!hv.ok) throw new Error(hv.reason);
  const client = new Redis({
    host: cfg.host, port: cfg.port, username: cfg.username || undefined, password: cfg.password || undefined, db,
    tls: cfg.tls ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 8000, commandTimeout: 10000, maxRetriesPerRequest: 1, lazyConnect: true, retryStrategy: () => null,
  });
  client.on("error", () => undefined); // surfaced through the awaited command instead
  await client.connect();
  return client;
}

function parseInfo(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0 && !line.startsWith("#")) out[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return out;
}
function keyspaces(info: Record<string, string>): DiscoveredNamespace[] {
  return Object.entries(info).filter(([k]) => /^db\d+$/.test(k)).map(([k, v]) => ({ name: k, tables: 0, views: 0, keys: Number(/keys=(\d+)/.exec(v)?.[1] ?? 0) }));
}

export async function testRedisConnection(cfg: RedisConnConfig): Promise<{ ok: boolean; version?: string; keys?: number; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  let client: Redis | null = null;
  try {
    client = await open(cfg);
    const info = parseInfo(await client.info("server"));
    const keys = await client.dbsize();
    return { ok: true, version: info.redis_version, keys, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: sanitizeDbError(e) };
  } finally {
    client?.disconnect();
  }
}

export async function discoverRedis(cfg: RedisConnConfig): Promise<DiscoveredNamespace[]> {
  const client = await open(cfg);
  try {
    const found = keyspaces(parseInfo(await client.info("keyspace")));
    return found.length ? found : [{ name: `db${cfg.db ?? 0}`, tables: 0, views: 0, keys: 0 }];
  } finally {
    client.disconnect();
  }
}

type Reply = [Error | null, unknown][] | null;
const val = (r: Reply, i: number): unknown => (r && r[i] && !r[i][0] ? r[i][1] : null);

function jsonShape(prefix: string): Record<string, unknown> | string[] | null {
  const t = prefix.trimStart();
  if (!t.startsWith("{")) return null;
  try {
    const doc = JSON.parse(t) as unknown;
    if (doc && typeof doc === "object" && !Array.isArray(doc)) return doc as Record<string, unknown>;
  } catch {
    // value was longer than the sampled prefix — fall back to the visible keys
  }
  const names = [...t.matchAll(/"([A-Za-z0-9_.$-]{1,60})"\s*:/g)].map((m) => m[1]);
  return names.length ? [...new Set(names)] : null;
}

export async function introspectRedis(cfg: RedisConnConfig, onStage?: (s: string) => void): Promise<SchemaModel> {
  const maxKeys = Math.max(100, Math.min(Number(cfg.maxKeys) || 2000, 20000));
  onStage?.("connecting");
  const first = await open(cfg);
  let version: string | null = null;
  let policy: string | null = null;
  let found: DiscoveredNamespace[] = [];
  try {
    version = parseInfo(await first.info("server")).redis_version ?? null;
    found = keyspaces(parseInfo(await first.info("keyspace")));
    policy = await first.config("GET", "maxmemory-policy").then((r) => (Array.isArray(r) && r[1] ? String(r[1]) : null)).catch(() => null);
  } finally {
    first.disconnect();
  }

  const tokens = (cfg.schemaSelection ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  let dbs: number[];
  if (tokens.includes("*")) dbs = found.map((f) => Number(f.name.slice(2)));
  else if (tokens.length) dbs = tokens.map((t) => Number(t.replace(/^db/i, ""))).filter((n) => Number.isInteger(n) && n >= 0);
  else dbs = [cfg.db ?? 0];
  if (!dbs.length) dbs = [cfg.db ?? 0];
  dbs = [...new Set(dbs)].slice(0, 16);
  const perDb = Math.max(50, Math.floor(maxKeys / dbs.length));

  onStage?.("introspecting");
  const samples: RedisKeySample[] = [];
  let totalKeys = 0;
  for (const db of dbs) {
    const client = await open(cfg, db);
    try {
      totalKeys += await client.dbsize();
      const keys: string[] = [];
      let cursor = "0";
      let rounds = 0;
      do {
        const [next, batch] = await client.scan(cursor, "MATCH", cfg.match || "*", "COUNT", 500);
        cursor = next;
        keys.push(...batch);
        rounds++;
      } while (cursor !== "0" && keys.length < perDb && rounds < 400);
      keys.length = Math.min(keys.length, perDb);

      const local: RedisKeySample[] = [];
      for (let i = 0; i < keys.length; i += 250) {
        const chunk = keys.slice(i, i + 250);
        const meta = client.pipeline();
        for (const k of chunk) { meta.type(k); meta.ttl(k); meta.call("MEMORY", "USAGE", k); }
        const metaRes = (await meta.exec()) as Reply;
        const sizes = client.pipeline();
        const types = chunk.map((_, j) => String(val(metaRes, j * 3) ?? "unknown"));
        chunk.forEach((k, j) => {
          const t = types[j];
          if (t === "string") sizes.strlen(k); else if (t === "hash") sizes.hlen(k); else if (t === "list") sizes.llen(k);
          else if (t === "set") sizes.scard(k); else if (t === "zset") sizes.zcard(k); else if (t === "stream") sizes.xlen(k); else sizes.exists(k);
        });
        const sizeRes = (await sizes.exec()) as Reply;
        chunk.forEach((key, j) => {
          const ttl = val(metaRes, j * 3 + 1);
          const memory = val(metaRes, j * 3 + 2);
          const size = val(sizeRes, j);
          local.push({ key, type: types[j], ttl: typeof ttl === "number" ? ttl : undefined, memory: typeof memory === "number" ? memory : null, size: typeof size === "number" && ["string", "hash", "list", "set", "zset", "stream"].includes(types[j]) ? size : null, db });
        });
      }

      // value shape: look inside at most three keys per pattern
      const perPattern = new Map<string, number>();
      for (const s of local) {
        const pattern = keyPattern(s.key);
        const seen = perPattern.get(pattern) ?? 0;
        if (seen >= 3 || !["hash", "string", "stream"].includes(s.type)) continue;
        perPattern.set(pattern, seen + 1);
        try {
          if (s.type === "hash") {
            const [, flat] = await client.hscan(s.key, "0", "COUNT", 60);
            const fields: Record<string, unknown> = {};
            for (let i = 0; i + 1 < flat.length && i < 160; i += 2) fields[flat[i]] = flat[i + 1];
            s.fields = fields;
          } else if (s.type === "string") {
            const shape = jsonShape(await client.getrange(s.key, 0, 767));
            if (shape) { s.fields = shape; s.json = true; }
          } else {
            const entries = (await client.xrevrange(s.key, "+", "-", "COUNT", 1)) as [string, string[]][];
            const flat = entries[0]?.[1] ?? [];
            const fields: Record<string, unknown> = {};
            for (let i = 0; i + 1 < flat.length; i += 2) fields[flat[i]] = flat[i + 1];
            s.fields = fields;
          }
        } catch {
          // a key can expire between SCAN and the read — skip it
        }
      }
      samples.push(...local);
    } finally {
      client.disconnect();
    }
  }

  onStage?.("normalizing");
  const model = buildRedisModel(samples, { database: cfg.name || `${cfg.host}:${cfg.port}`, source: "introspection:redis", db: cfg.db ?? 0, version, totalKeys, maxmemoryPolicy: policy });
  if (!samples.length) model.warnings.push("No keys matched — the selected logical database is empty or the MATCH pattern excludes everything.");
  if (policy === null) model.sourceMetadata.limitations.push("CONFIG GET is not permitted for this user (common on managed Redis); the eviction policy is unknown.");
  return model;
}
