import { SchemaModel, EntityModel, FieldModel, emptyModel, entityId, fieldId, constraintId, relId } from "./schema-model";

// ─── Redis key-model inference ─────────────────────────────────────
// Redis has no schema, so the "model" is inferred from a bounded sample of keys:
// keys are grouped into patterns (`session:{session_id}`), and every pattern
// becomes an entity with its data type, value shape, TTL coverage and size.
// Pure and deterministic: the live adapter and the file importer both feed it.
// Values are never kept — only names, types, sizes and expiry.

export interface RedisKeySample {
  key: string;
  /** string | hash | list | set | zset | stream | … ("unknown" when not captured). */
  type: string;
  /** Seconds to expiry. -1 / null = no expiry; undefined = not captured. */
  ttl?: number | null;
  /** Bytes, from MEMORY USAGE. */
  memory?: number | null;
  /** STRLEN / HLEN / LLEN / SCARD / ZCARD / XLEN. */
  size?: number | null;
  /** Hash fields, stream entry fields or top-level JSON keys. Values are used for type inference only. */
  fields?: Record<string, unknown> | string[] | null;
  /** The string value is a JSON document. */
  json?: boolean;
  /** Logical database index. */
  db?: number;
}

export interface RedisModelOptions {
  database: string;
  source: string;
  db?: number;
  version?: string | null;
  /** DBSIZE across the scanned databases, used to extrapolate key counts. */
  totalKeys?: number | null;
  maxmemoryPolicy?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function singularize(word: string): string {
  if (word.length > 3 && /ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 2 && /s$/.test(word) && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

type SegKind = "literal" | "id" | "date" | "ip" | "email";

function classify(seg: string): SegKind {
  if (!seg) return "literal";
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(seg)) return "date";
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(seg)) return "ip";
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(seg)) return "email";
  if (/^\d+$/.test(seg)) return "id";
  if (UUID_RE.test(seg)) return "id";
  if (/^[0-9a-f]{12,}$/i.test(seg)) return "id"; // hex digests, ObjectIds
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/.test(seg)) return "id"; // ULID
  if (seg.length >= 16 && /\d/.test(seg) && /[a-z]/i.test(seg) && /^[A-Za-z0-9_-]+$/.test(seg)) return "id"; // opaque tokens
  return "literal";
}

interface ParsedKey { sample: RedisKeySample; segs: string[]; vars: (string | null)[]; delim: string; ns: string }

function uniqueName(base: string, taken: (string | null)[]): string {
  let name = base;
  let n = 2;
  while (taken.includes(name)) name = `${base}_${n++}`;
  return name;
}

function paramName(kind: SegKind, prevLiteral: string | null, taken: (string | null)[], suffix = "id"): string {
  if (kind === "date" || kind === "ip" || kind === "email") return uniqueName(kind, taken);
  const prev = prevLiteral ? singularize(prevLiteral.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")) : "";
  return uniqueName(prev ? `${prev}_${suffix}` : suffix, taken);
}

function parseKey(sample: RedisKeySample, defaultDb: number): ParsedKey {
  const delim = sample.key.includes(":") ? ":" : sample.key.includes("/") ? "/" : ":";
  const segs = sample.key.split(delim);
  const vars: (string | null)[] = [];
  segs.forEach((seg, i) => {
    const kind = classify(seg);
    if (kind === "literal") { vars.push(null); return; }
    const prev = i > 0 && vars[i - 1] === null ? segs[i - 1] : null;
    vars.push(paramName(kind, prev, vars));
  });
  return { sample, segs, vars, delim, ns: `db${sample.db ?? defaultDb}` };
}

/** The pattern a single key belongs to, before cross-key generalisation. */
export function keyPattern(key: string): string {
  return patternOf(parseKey({ key, type: "unknown" }, 0));
}
function patternOf(p: ParsedKey): string {
  return p.segs.map((s, i) => (p.vars[i] ? `{${p.vars[i]}}` : s)).join(p.delim);
}

/**
 * Literal segments that take many distinct values, each seen only a few times
 * (`feature:dark_mode`, `feature:new_checkout`, …) are really parameters.
 * The first segment is the namespace prefix and is never generalised.
 */
function mergeHighCardinality(parsed: ParsedKey[]) {
  const maxLen = parsed.reduce((a, p) => Math.max(a, p.segs.length), 0);
  for (let i = 1; i < maxLen; i++) {
    const shapes = new Map<string, Map<string, ParsedKey[]>>();
    for (const p of parsed) {
      if (i >= p.segs.length || p.vars[i]) continue;
      const shape = `${p.ns}|${p.segs.length}|${p.segs.map((s, j) => (j === i ? "\u0000" : p.vars[j] ? `{${p.vars[j]}}` : s)).join(p.delim)}`;
      const byValue = shapes.get(shape) ?? new Map<string, ParsedKey[]>();
      byValue.set(p.segs[i], [...(byValue.get(p.segs[i]) ?? []), p]);
      shapes.set(shape, byValue);
    }
    for (const byValue of shapes.values()) {
      const keys = [...byValue.values()].reduce((a, v) => a + v.length, 0);
      if (byValue.size < 8 || keys / byValue.size > 3) continue;
      for (const group of byValue.values()) for (const p of group) {
        const prev = p.vars[i - 1] === null ? p.segs[i - 1] : null;
        p.vars[i] = paramName("id", prev, p.vars, "key");
      }
    }
  }
}

function valueType(v: unknown): string {
  if (v === null || v === undefined) return "string";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "float";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "object") return "json";
  const s = String(v);
  if (/^-?\d+$/.test(s)) return "integer";
  if (/^-?\d+\.\d+$/.test(s)) return "float";
  if (/^(true|false)$/i.test(s)) return "boolean";
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/.test(s)) return "timestamp";
  if (UUID_RE.test(s)) return "uuid";
  if (/^[[{]/.test(s)) return "json";
  return "string";
}

const stats = (xs: number[]) => (xs.length ? { min: Math.min(...xs), max: Math.max(...xs), avg: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) } : null);

function valueFields(eid: string, redisType: string, group: ParsedKey[]): { fields: FieldModel[]; json: boolean } {
  const seen = new Map<string, { count: number; types: Set<string> }>();
  let withShape = 0;
  let json = false;
  for (const { sample } of group) {
    if (sample.json) json = true;
    if (!sample.fields) continue;
    withShape++;
    const entries: [string, unknown][] = Array.isArray(sample.fields) ? sample.fields.map((n) => [String(n), undefined]) : Object.entries(sample.fields);
    for (const [name, value] of entries) {
      const cur = seen.get(name) ?? { count: 0, types: new Set<string>() };
      cur.count++;
      if (!Array.isArray(sample.fields)) cur.types.add(valueType(value));
      seen.set(name, cur);
    }
  }
  const shaped: FieldModel[] = [...seen.entries()].slice(0, 80).map(([name, info]) => {
    const types = [...info.types];
    return { id: fieldId(eid, `value.${name}`), name, type: types.length === 1 ? types[0] : types.length ? "mixed" : "string", nullable: info.count < withShape, presence: withShape ? info.count / withShape : 1, bsonTypes: types.length > 1 ? types : undefined };
  });
  const f = (name: string, type: string, extra: Partial<FieldModel> = {}): FieldModel => ({ id: fieldId(eid, name), name, type, nullable: false, ...extra });
  switch (redisType) {
    case "hash": return { fields: shaped.length ? shaped : [f("field", "string", { comment: "hash fields were not sampled" })], json };
    case "string": return { fields: [f("value", json || shaped.length ? "json" : "string", shaped.length ? { nested: shaped } : {})], json: json || shaped.length > 0 };
    case "list": return { fields: [f("items", "list", { isArray: true, arrayOf: "string" })], json };
    case "set": return { fields: [f("members", "set", { isArray: true, arrayOf: "string" })], json };
    case "zset": return { fields: [f("member", "string"), f("score", "double")], json };
    case "stream": return { fields: [f("id", "stream_id"), ...shaped], json };
    default: return { fields: [f("value", redisType || "unknown")], json };
  }
}

export function buildRedisModel(samples: RedisKeySample[], opts: RedisModelOptions): SchemaModel {
  const model = emptyModel("redis", opts.database);
  model.version = opts.version ?? null;
  model.sourceMetadata.source = opts.source;
  const defaultDb = opts.db ?? 0;
  const parsed = samples.filter((s) => s && typeof s.key === "string" && s.key.length > 0).map((s) => parseKey(s, defaultDb));
  mergeHighCardinality(parsed);

  const groups = new Map<string, ParsedKey[]>();
  for (const p of parsed) {
    const id = `${p.ns}\u0000${patternOf(p)}`;
    groups.set(id, [...(groups.get(id) ?? []), p]);
  }
  const scale = opts.totalKeys && parsed.length && opts.totalKeys > parsed.length ? opts.totalKeys / parsed.length : 1;
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  for (const [id, group] of ordered) {
    const [ns, pattern] = id.split("\u0000");
    const first = group[0];
    const params = first.vars.filter((v): v is string => Boolean(v));
    const typeCounts: Record<string, number> = {};
    for (const g of group) typeCounts[g.sample.type || "unknown"] = (typeCounts[g.sample.type || "unknown"] ?? 0) + 1;
    const redisType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0][0];
    const ttlKnown = group.filter((g) => g.sample.ttl !== undefined);
    const withTtl = ttlKnown.filter((g) => typeof g.sample.ttl === "number" && g.sample.ttl >= 0);
    const eid = entityId("redis", ns, pattern);
    const shape = valueFields(eid, redisType, group);
    const fields: FieldModel[] = [
      { id: fieldId(eid, "key"), name: "key", type: "key", nullable: false, isPrimaryKey: true, comment: pattern },
      ...params.map((p) => ({ id: fieldId(eid, p), name: p, type: "string", nullable: false, comment: "key segment" })),
      ...shape.fields.filter((f) => f.name !== "key" && !params.includes(f.name)),
    ];
    const entity: EntityModel = {
      id: eid,
      name: `${ns}.${pattern}`,
      shortName: pattern,
      namespace: ns,
      kind: "keyspace",
      engine: "redis",
      fields,
      indexes: [],
      constraints: [{ id: constraintId(eid, "key"), name: "key", kind: "primary_key", columns: ["key"] }],
      comment: `${redisType} · ${params.length ? `keyed by ${params.join(", ")}` : "singleton key"}`,
      rowEstimate: Math.max(group.length, Math.round(group.length * scale)),
      metadata: {
        redisType,
        types: typeCounts,
        params,
        sampledKeys: group.length,
        json: shape.json,
        ttl: { known: ttlKnown.length, with: withTtl.length, without: ttlKnown.length - withTtl.length, ...(stats(withTtl.map((g) => g.sample.ttl as number)) ?? {}) },
        size: stats(group.map((g) => g.sample.size).filter((n): n is number => typeof n === "number")),
        memory: stats(group.map((g) => g.sample.memory).filter((n): n is number => typeof n === "number")),
      },
    };
    model.entities.push(entity);
  }

  // Inferred links: a field or key segment named like another keyspace's own key (`user_id` → `user:{user_id}`).
  const homes = new Map<string, EntityModel>();
  for (const e of model.entities) {
    const params = (e.metadata.params as string[]) ?? [];
    const last = params[params.length - 1];
    if (!last || !e.shortName.endsWith(`{${last}}`)) continue;
    const key = `${e.namespace}|${last}`;
    const cur = homes.get(key);
    if (!cur || e.shortName.length < cur.shortName.length) homes.set(key, e);
  }
  for (const e of model.entities) {
    for (const f of e.fields) {
      const home = homes.get(`${e.namespace}|${f.name}`);
      if (!home || home.id === e.id) continue;
      model.relationships.push({
        id: relId(e.name, [f.name], home.name, [f.name]),
        name: `${e.shortName} → ${home.shortName}`,
        fromEntity: e.name, fromColumns: [f.name], toEntity: home.name, toColumns: [f.name],
        cardinality: "one-to-many", optionality: "optional", provenance: "inferred_schema", confidence: f.comment === "key segment" ? 0.75 : 0.6,
      });
    }
  }
  model.dependencies = model.relationships.map((r) => ({ from: r.fromEntity, to: r.toEntity, kind: "key" }));

  model.namespaces = [...new Set(model.entities.map((e) => e.namespace))].sort();
  if (!model.namespaces.length) model.namespaces = [`db${defaultDb}`];
  model.catalog = {
    namespaces: model.namespaces.map((name) => ({ name, tables: model.entities.filter((e) => e.namespace === name).length, views: 0 })),
    settings: { maxmemoryPolicy: opts.maxmemoryPolicy ?? null, totalKeys: opts.totalKeys ?? null, sampledKeys: parsed.length },
  };
  model.sourceMetadata.sampleSize = parsed.length;
  model.sourceMetadata.limitations.push(
    `Key patterns are inferred from a bounded sample (${parsed.length.toLocaleString("en-US")}${opts.totalKeys ? ` of ~${opts.totalKeys.toLocaleString("en-US")}` : ""} keys); rare keyspaces can be missed and key counts are extrapolated.`,
    "Values are never stored — only key shapes, data types, sizes and TTL coverage.",
  );
  return model;
}

/**
 * Offline import for Redis: either a JSON document
 * `{ "engine": "redis", "database": "...", "totalKeys": 0, "keys": [{ "key", "type", "ttl", "size", "memory", "fields" }] }`
 * or plain text with one key per line: `key [type] [ttl] [size]` (e.g. `redis-cli --scan` output).
 */
export function parseRedisDump(input: string, database = "redis"): { model: SchemaModel; warnings: string[]; detectedEngine: "redis" } {
  const warnings: string[] = [];
  const text = input.trim();
  let samples: RedisKeySample[] = [];
  let meta: Record<string, unknown> = {};
  if (text.startsWith("{") || text.startsWith("[")) {
    const doc = JSON.parse(text) as unknown;
    const root = (Array.isArray(doc) ? { keys: doc } : (doc as Record<string, unknown>).redis && typeof (doc as Record<string, unknown>).redis === "object" ? (doc as Record<string, unknown>).redis : doc) as Record<string, unknown>;
    meta = root;
    const keys = Array.isArray(root.keys) ? root.keys : [];
    samples = keys.filter((k): k is Record<string, unknown> => Boolean(k) && typeof k === "object" && typeof (k as Record<string, unknown>).key === "string").map((k) => ({
      key: String(k.key),
      type: String(k.type ?? "unknown").toLowerCase(),
      ttl: k.ttl === undefined ? undefined : k.ttl === null ? null : Number(k.ttl),
      memory: typeof k.memory === "number" ? k.memory : null,
      size: typeof k.size === "number" ? k.size : null,
      fields: Array.isArray(k.fields) || (k.fields && typeof k.fields === "object") ? (k.fields as Record<string, unknown> | string[]) : null,
      json: Boolean(k.json),
      db: typeof k.db === "number" ? k.db : undefined,
    }));
    if (keys.length !== samples.length) warnings.push(`Skipped ${keys.length - samples.length} entr${keys.length - samples.length === 1 ? "y" : "ies"} without a "key" string.`);
  } else {
    let untyped = 0;
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const [key, type, ttl, size] = t.split(/\s+/);
      if (!type) untyped++;
      samples.push({ key, type: (type ?? "unknown").toLowerCase(), ttl: ttl === undefined ? undefined : Number(ttl), size: size === undefined ? null : Number(size) });
    }
    if (untyped) warnings.push(`${untyped} key(s) had no type column — include "key type ttl size" per line for TTL and structure analysis.`);
  }
  if (!samples.length) throw new Error('No Redis keys found. Provide { "keys": [{ "key", "type", "ttl" }] } or one "key type ttl size" per line.');
  const model = buildRedisModel(samples, {
    database: String(meta.database ?? database),
    source: "redis-dump",
    db: typeof meta.db === "number" ? meta.db : 0,
    version: meta.version ? String(meta.version) : null,
    totalKeys: typeof meta.totalKeys === "number" ? meta.totalKeys : null,
    maxmemoryPolicy: meta.maxmemoryPolicy ? String(meta.maxmemoryPolicy) : null,
  });
  model.warnings = warnings;
  return { model, warnings, detectedEngine: "redis" };
}
