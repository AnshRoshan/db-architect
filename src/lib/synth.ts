import type { SchemaModel, EntityModel, FieldModel } from "./schema-model";
import { parseType, Family } from "./type-map";
import { topoEntities, pkColumns } from "./sql-dialects";
import type { Row } from "./transform";

// Deterministic, plausible sample data derived from a schema (no real data involved).
const FIRST = ["Ada", "Linus", "Grace", "Alan", "Edsger", "Barbara", "Ken", "Margaret"];
const LAST = ["Lovelace", "Torvalds", "Hopper", "Turing", "Dijkstra", "Liskov", "Thompson", "Hamilton"];
const WORDS = ["Quantum", "Atlas", "Nimbus", "Vertex", "Helix", "Orbit", "Prism", "Summit"];
const STATUS = ["active", "pending", "shipped", "cancelled"];
const pick = <T,>(a: T[], i: number): T => a[i % a.length];

function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function hex(seed: number, len: number): string { let s = "", x = seed >>> 0; while (s.length < len) { x = Math.imul(x ^ (x >>> 15), 2246822507) >>> 0; x = (x ^ (x >>> 13)) >>> 0; s += x.toString(16).padStart(8, "0"); } return s.slice(0, len); }
export function synthUuid(salt: string, i: number): string { const h = hash(`${salt}:${i}`); return `${hex(h, 8)}-${hex(h + 1, 4)}-4${hex(h + 2, 3)}-8${hex(h + 3, 3)}-${hex(h + 4, 12)}`; }
export function synthObjectId(salt: string, i: number): string { return hex(hash(`${salt}:${i}`), 24); }

export function scalarFor(name: string, fam: Family, i: number, salt: string): unknown {
  const n = name.toLowerCase();
  switch (fam) {
    case "bool": return i % 2 === 0;
    case "int2": case "int4": case "int8":
      if (/qty|quantity|count|items/.test(n)) return 1 + (i % 5);
      if (/price|amount|total|cents|cost|fee/.test(n)) return 1000 + i * 250;
      if (/age/.test(n)) return 20 + i;
      if (/position|rank|order/.test(n)) return i + 1;
      return i + 1;
    case "decimal": case "float4": case "float8": return /price|amount|total|cost|fee|balance/.test(n) ? Number((10 + i * 7.5).toFixed(2)) : Number((i * 1.5 + 0.5).toFixed(2));
    case "uuid": return synthUuid(`${salt}.${name}`, i);
    case "objectId": return synthObjectId(`${salt}.${name}`, i);
    case "date": return `2024-02-${String((i % 27) + 1).padStart(2, "0")}`;
    case "time": return `${String(9 + (i % 8)).padStart(2, "0")}:30:00`;
    case "timestamp": case "timestamptz": return `2024-03-${String((i % 27) + 1).padStart(2, "0")}T10:${String((i * 7) % 60).padStart(2, "0")}:00.000Z`;
    case "json": return { source: "synthetic", n: i };
    case "bytes": return "<binary>";
    case "array": return [i];
    default: break;
  }
  if (/e.?mail/.test(n)) return `${pick(FIRST, i).toLowerCase()}${i + 1}@example.com`;
  if (/first.?name/.test(n)) return pick(FIRST, i);
  if (/last.?name|surname/.test(n)) return pick(LAST, i);
  if (/(^|_)name$|full.?name/.test(n)) return `${pick(FIRST, i)} ${pick(LAST, i + 3)}`;
  if (/title|subject|label/.test(n)) return `${pick(WORDS, i)} ${pick(WORDS, i + 2)}`;
  if (/status|state/.test(n)) return pick(STATUS, i);
  if (/role|type|kind|category/.test(n)) return pick(["admin", "member", "viewer", "owner"], i);
  if (/sku|code/.test(n)) return `SKU-${1000 + i}`;
  if (/url|link|website/.test(n)) return `https://example.com/${n}/${i + 1}`;
  if (/phone/.test(n)) return `+1-555-01${String(i).padStart(2, "0")}`;
  if (/currency/.test(n)) return "USD";
  if (/country/.test(n)) return pick(["US", "DE", "IN", "BR"], i);
  if (/desc|bio|note|text|body|content|comment|message/.test(n)) return `Sample ${n} text for record ${i + 1}.`;
  if (/password|secret|token/.test(n)) return `secret-${hex(hash(name + i), 8)}`;
  return `${name}_${i + 1}`;
}

function familyOf(f: FieldModel, engine: SchemaModel["engine"]): Family {
  if (engine === "mongodb") return parseType((f.bsonTypes ?? []).find((t) => t !== "null") ?? f.type.split("|")[0].trim(), "mongodb").family;
  return parseType(f.type, engine).family;
}

export function synthSql(model: SchemaModel, names: string[], n: number): Record<string, Row[]> {
  const byName = new Map(model.entities.map((e) => [e.name, e]));
  const out: Record<string, Row[]> = {};
  for (const e of topoEntities(model).filter((x) => names.includes(x.name))) {
    const fks = e.constraints.filter((c) => c.kind === "foreign_key" && c.referencedEntity && byName.has(c.referencedEntity));
    const count = fks.length ? n * 2 : n;
    const rows: Row[] = [];
    for (let i = 0; i < count; i++) {
      const row: Row = {};
      for (const f of e.fields) {
        const k = fks.findIndex((c) => c.columns.includes(f.name));
        if (k >= 0) {
          const c = fks[k];
          const parent = out[c.referencedEntity!];
          if (parent?.length) {
            const refCol = c.referencedColumns?.[c.columns.indexOf(f.name)] ?? pkColumns(byName.get(c.referencedEntity!)!)[0];
            row[f.name] = parent[(i + k * Math.floor(i / parent.length)) % parent.length][refCol];
            continue;
          }
        }
        if (f.nullable && !f.isPrimaryKey && i % 5 === 4 && !/id$/i.test(f.name)) { row[f.name] = null; continue; }
        row[f.name] = scalarFor(f.name, familyOf(f, model.engine), i, e.shortName);
      }
      rows.push(row);
    }
    out[e.name] = rows;
  }
  return out;
}

export function synthMongo(model: SchemaModel, names: string[], n: number): Record<string, Row[]> {
  const ids: Record<string, string[]> = {};
  for (const e of model.entities) ids[e.name] = Array.from({ length: n }, (_, i) => synthObjectId(e.name, i));
  const build = (fields: FieldModel[], i: number, salt: string, e: EntityModel, depth: number): Row => {
    const doc: Row = {};
    for (const f of fields) {
      if (f.name === "_id") continue;
      const presence = f.presence ?? 1;
      if (presence < 0.7 && i % 3 === 2) continue;
      const rel = depth === 0 ? model.relationships.find((r) => r.fromEntity === e.name && r.fromColumns[0] === f.name) : undefined;
      if (rel && ids[rel.toEntity]) { doc[f.name] = ids[rel.toEntity][i % n]; continue; }
      const bts = (f.bsonTypes ?? []).filter((t) => t !== "null");
      if (f.isArray || bts.includes("array")) {
        const len = 1 + (i % 3);
        doc[f.name] = Array.from({ length: len }, (_, k) => f.nested ? build(f.nested, i + k, `${salt}.${f.name}`, e, depth + 1) : scalarFor(f.name, parseType((f.arrayOf ?? "string").split("|")[0].trim(), "mongodb").family, i + k, salt));
        continue;
      }
      if (f.nested && (bts.includes("object") || !bts.length)) { doc[f.name] = build(f.nested, i, `${salt}.${f.name}`, e, depth + 1); continue; }
      doc[f.name] = scalarFor(f.name, familyOf(f, "mongodb"), i, salt);
    }
    return doc;
  };
  const out: Record<string, Row[]> = {};
  for (const e of model.entities.filter((x) => names.includes(x.name))) {
    out[e.name] = Array.from({ length: n }, (_, i) => ({ _id: ids[e.name][i], ...build(e.fields, i, e.shortName, e, 0) }));
  }
  return out;
}

export function synthDataset(model: SchemaModel, names: string[], rows = 4): Record<string, Row[]> {
  return model.engine === "mongodb" ? synthMongo(model, names, rows) : synthSql(model, names, rows);
}
