import type { Engine } from "./engines";
import type { FieldModel } from "./schema-model";

// Canonical type families make cross-engine conversion explicit and testable.
export type Family =
  | "int2" | "int4" | "int8" | "decimal" | "float4" | "float8" | "bool"
  | "text" | "varchar" | "char" | "uuid" | "date" | "time" | "timestamp" | "timestamptz"
  | "json" | "bytes" | "objectId" | "array" | "enum" | "other";

export interface TypeInfo {
  family: Family;
  raw: string;
  length?: number;
  precision?: number;
  scale?: number;
  unsigned?: boolean;
}

export interface RenderedType {
  type: string;
  lossy: boolean;
  note?: string;
}

export function parseType(rawIn: string, engine: Engine): TypeInfo {
  const raw = rawIn ?? "text";
  let s = raw.trim().toLowerCase();
  const unsigned = /\bunsigned\b/.test(s);
  s = s.replace(/\bunsigned\b/g, "").replace(/\bzerofill\b/g, "").trim();
  let isArray = false;
  if (s.endsWith("[]")) { isArray = true; s = s.slice(0, -2).trim(); }
  if (s.startsWith("_") && engine === "postgres") { isArray = true; s = s.slice(1); }
  const args = s.match(/\(([^)]*)\)/)?.[1];
  const base = s.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  const nums = args ? args.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n)) : [];
  const mk = (family: Family, extra: Partial<TypeInfo> = {}): TypeInfo => ({ family, raw, unsigned, ...extra });
  if (isArray) return mk("array");
  if (base === "tinyint") return engine === "mysql" && nums[0] === 1 ? mk("bool") : mk("int2");
  if (/^(smallint|int2|smallserial)$/.test(base)) return mk("int2");
  if (engine === "sqlite" && base === "integer") return mk("int8");
  if (/^(mediumint|int|integer|int4|serial|serial4)$/.test(base)) return mk("int4");
  if (/^(bigint|int8|bigserial|serial8|long)$/.test(base)) return mk("int8");
  if (/^(numeric|decimal|number|money|dec|fixed)$/.test(base)) return mk("decimal", { precision: nums[0], scale: nums[1] });
  if (/^(real|float4)$/.test(base)) return engine === "sqlite" ? mk("float8") : mk("float4");
  if (base === "float") return engine === "mysql" && !(nums[0] && nums[0] > 24) ? mk("float4") : mk("float8");
  if (/^(double precision|double|float8)$/.test(base)) return mk("float8");
  if (/^(boolean|bool|bit)$/.test(base)) return mk("bool");
  if (/^(text|tinytext|mediumtext|longtext|clob|citext|ntext|string)$/.test(base)) return mk("text");
  if (/^(varchar|character varying|nvarchar|varchar2|nchar varying)$/.test(base)) return mk("varchar", { length: nums[0] });
  if (/^(char|character|bpchar|nchar)$/.test(base)) return mk("char", { length: nums[0] ?? 1 });
  if (/^(uuid|uniqueidentifier)$/.test(base)) return mk("uuid");
  if (/^(timestamp with time zone|timestamptz|datetimeoffset)$/.test(base)) return mk("timestamptz");
  if (/^(timestamp without time zone|datetime|datetime2|smalldatetime)$/.test(base)) return mk("timestamp");
  if (base === "timestamp") return engine === "mysql" ? mk("timestamptz") : mk("timestamp");
  if (base === "date") return engine === "mongodb" ? mk("timestamptz") : mk("date");
  if (/^(time|time without time zone|time with time zone|timetz)$/.test(base)) return mk("time");
  if (/^(json|jsonb|object)$/.test(base)) return mk("json");
  if (/^(bytea|blob|tinyblob|mediumblob|longblob|binary|varbinary|bindata|bytes|image)$/.test(base)) return mk("bytes");
  if (base === "objectid") return mk("objectId");
  if (base === "array") return mk("array");
  if (base === "enum") return mk("enum");
  if (/^(set|null|mixed|undefined)$/.test(base)) return mk("text");
  return mk("other");
}

export function renderType(t: TypeInfo, to: Engine): RenderedType {
  const ok = (type: string, note?: string): RenderedType => ({ type, lossy: false, note });
  const lossy = (type: string, note: string): RenderedType => ({ type, lossy: true, note });
  const f = t.family;
  if (to === "postgres") {
    switch (f) {
      case "int2": return ok("smallint");
      case "int4": return ok("integer");
      case "int8": return ok("bigint");
      case "decimal": return ok(t.precision ? `numeric(${t.precision}${t.scale != null ? `,${t.scale}` : ""})` : "numeric");
      case "float4": return ok("real");
      case "float8": return ok("double precision");
      case "bool": return ok("boolean");
      case "text": return ok("text");
      case "varchar": return ok(t.length ? `varchar(${t.length})` : "varchar");
      case "char": return ok(`char(${t.length ?? 1})`);
      case "uuid": return ok("uuid");
      case "date": return ok("date");
      case "time": return ok("time");
      case "timestamp": return ok("timestamp");
      case "timestamptz": return ok("timestamptz");
      case "json": return ok("jsonb");
      case "bytes": return ok("bytea");
      case "objectId": return ok("char(24)", "ObjectId stored as 24-char hex string");
      case "array": return ok("jsonb", "Array stored as JSONB");
      case "enum": return lossy("text", "ENUM members not carried over — add a CHECK constraint or CREATE TYPE");
      default: return lossy("text", `Unrecognized type "${t.raw}" mapped to text`);
    }
  }
  if (to === "mysql") {
    switch (f) {
      case "int2": return ok(`smallint${t.unsigned ? " unsigned" : ""}`);
      case "int4": return ok(`int${t.unsigned ? " unsigned" : ""}`);
      case "int8": return ok(`bigint${t.unsigned ? " unsigned" : ""}`);
      case "decimal": return t.precision ? ok(`decimal(${t.precision},${t.scale ?? 0})`) : lossy("decimal(38,10)", "Unbounded numeric given an explicit precision/scale (38,10)");
      case "float4": return ok("float");
      case "float8": return ok("double");
      case "bool": return ok("tinyint(1)");
      case "text": return ok("text", "Use longtext if values can exceed 64KB");
      case "varchar": return t.length ? ok(`varchar(${t.length})`) : lossy("varchar(255)", "Unbounded varchar given a default length of 255");
      case "char": return ok(`char(${t.length ?? 1})`);
      case "uuid": return ok("char(36)", "UUID stored as text (BINARY(16) is more compact)");
      case "date": return ok("date");
      case "time": return ok("time");
      case "timestamp": return ok("datetime(6)");
      case "timestamptz": return lossy("datetime(6)", "Time-zone offset is not stored — normalize values to UTC");
      case "json": return ok("json");
      case "bytes": return ok("blob");
      case "objectId": return ok("char(24)", "ObjectId stored as 24-char hex string");
      case "array": return ok("json", "Array stored as JSON");
      case "enum": return lossy("varchar(64)", "ENUM members not carried over");
      default: return lossy("text", `Unrecognized type "${t.raw}" mapped to text`);
    }
  }
  if (to === "sqlite") {
    switch (f) {
      case "int2": case "int4": case "int8": return ok("integer");
      case "decimal": return lossy("numeric", "SQLite NUMERIC affinity can store REAL — exact decimal precision is not guaranteed");
      case "float4": case "float8": return ok("real");
      case "bool": return ok("integer", "Booleans stored as 0/1");
      case "text": case "varchar": case "char": return ok("text");
      case "uuid": return ok("text");
      case "date": case "time": case "timestamp": return ok("text", "Stored as ISO-8601 text");
      case "timestamptz": return lossy("text", "Stored as ISO-8601 text; offset handling is application-defined");
      case "json": return lossy("text", "No native JSON type — add CHECK (json_valid(col))");
      case "bytes": return ok("blob");
      case "objectId": return ok("text");
      case "array": return lossy("text", "Array stored as JSON text");
      case "enum": return lossy("text", "ENUM members not carried over");
      default: return lossy("text", `Unrecognized type "${t.raw}" mapped to text`);
    }
  }
  // mongodb
  switch (f) {
    case "int2": case "int4": return ok("int");
    case "int8": return ok("long");
    case "decimal": return ok("decimal", "Stored as Decimal128");
    case "float4": case "float8": return ok("double");
    case "bool": return ok("bool");
    case "text": case "varchar": case "char": return ok("string");
    case "uuid": return ok("string", "UUID kept as string (BSON binData subtype 4 is more compact)");
    case "date": return ok("date", "Stored as a UTC instant at midnight");
    case "time": return lossy("string", "No time-of-day type in BSON — stored as string");
    case "timestamp": return ok("date", "Assumes values are UTC");
    case "timestamptz": return ok("date");
    case "json": return ok("object");
    case "bytes": return ok("binData");
    case "objectId": return ok("objectId");
    case "array": return ok("array");
    case "enum": return lossy("string", "ENUM members not carried over — add to $jsonSchema enum");
    default: return lossy("string", `Unrecognized type "${t.raw}" mapped to string`);
  }
}

export function isAutoIncrement(f: Pick<FieldModel, "type" | "identity" | "defaultValue">): boolean {
  return Boolean(f.identity) || /serial/i.test(f.type) || /nextval\(|auto_increment/i.test(f.defaultValue ?? "");
}

export interface MappedDefault {
  value: string | null;
  note?: string;
}

export function mapDefault(def: string | null | undefined, from: Engine, to: Engine): MappedDefault {
  if (def == null || def === "") return { value: null };
  let d = String(def).trim();
  if (/nextval\(/i.test(d)) return { value: null };
  d = d.replace(/::[a-z_ ]+(\([^)]*\))?(\[\])?/gi, "").trim();
  if (to === "mongodb") return { value: null, note: "MongoDB has no column defaults — apply in application code or a $jsonSchema-aware insert path" };
  if (/^(now\(\)|current_timestamp(\(\d*\))?|current_timestamp)$/i.test(d)) {
    return { value: to === "postgres" ? "now()" : "CURRENT_TIMESTAMP" };
  }
  if (/^(gen_random_uuid\(\)|uuid_generate_v4\(\)|\(?uuid\(\)\)?)$/i.test(d)) {
    if (to === "postgres") return { value: "gen_random_uuid()" };
    if (to === "mysql") return { value: "(UUID())" };
    return { value: null, note: "SQLite has no UUID default — generate in the application" };
  }
  if (/^(true|'t'|b'1')$/i.test(d)) return { value: to === "postgres" ? "true" : "1" };
  if (/^(false|'f'|b'0')$/i.test(d)) return { value: to === "postgres" ? "false" : "0" };
  void from;
  return { value: d };
}
