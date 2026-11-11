import {
  SchemaModel, EntityModel, FieldModel, IndexModel, ConstraintModel, RelationshipModel,
  emptyModel, entityId, fieldId, indexId, constraintId, relId,
} from "./schema-model";
import { Engine, isRelational, ENGINES } from "./engines";
import { parseType, renderType, mapDefault, isAutoIncrement, TypeInfo } from "./type-map";
import { generateDdl, topoEntities, pkColumns, SqlDialect } from "./sql-dialects";
import { buildEtlScript } from "./etl-script";

export type Row = Record<string, unknown>;

export interface TransformOptions {
  embed?: "auto" | "none"; // relational → document: embed owned children
  camelCase?: boolean; // relational → document: field naming
  arrays?: "child_table" | "json" | "native"; // document → relational
  nested?: "flatten" | "json"; // document → relational
  maxFlattenDepth?: number;
  targetNamespace?: string;
}
type Opts = Required<Pick<TransformOptions, "embed" | "camelCase" | "arrays" | "nested" | "maxFlattenDepth">> & { targetNamespace?: string };
export const DEFAULT_TRANSFORM_OPTIONS = { embed: "auto", camelCase: true, arrays: "child_table", nested: "flatten", maxFlattenDepth: 2 } as const;

export type Converter = "identity" | "bool_to_int" | "int_to_bool" | "json_stringify" | "json_parse" | "to_string" | "to_iso" | "to_date" | "to_decimal";
export interface ColumnSpec { src: string; dst: string; convert: Converter }
export interface TableSpec { source: string; target: string; pk: string[]; columns: ColumnSpec[] }
export interface EmbedSpec { source: string; fk: string; parentKey: string; field: string; columns: ColumnSpec[] }
export interface JunctionSpec { source: string; fkParent: string; fkOther: string; parentKey: string; field: string }
export interface CollectionSpec { source: string; target: string; pk: string[]; columns: ColumnSpec[]; embeds: EmbedSpec[]; junctions: JunctionSpec[] }
export interface PathColumn { path: string[]; dst: string; convert: Converter }
export interface ChildSpec { path: string[]; target: string; fk: string; kind: "scalar" | "object"; valueColumn: string; columns: PathColumn[]; scalarConvert: Converter }
export interface RootSpec { source: string; target: string; idColumn: string; columns: PathColumn[]; children: ChildSpec[] }
export type Runtime =
  | { kind: "sql_to_sql"; tables: TableSpec[] }
  | { kind: "sql_to_mongo"; collections: CollectionSpec[] }
  | { kind: "mongo_to_sql"; roots: RootSpec[] };

export interface FieldMapping {
  sourceEntity: string; sourceField: string; sourceType: string;
  targetEntity: string; targetField: string; targetType: string;
  action: "copy" | "convert" | "flatten" | "embed" | "reference" | "child_table" | "json" | "generate" | "drop";
  lossy: boolean; note?: string;
}
export interface Decision { kind: "embed" | "reference" | "flatten" | "child_table" | "info" | "warning"; title: string; detail: string }
export interface RunbookPhase { title: string; steps: string[] }

export interface TransformPlan {
  sourceEngine: Engine; targetEngine: Engine; options: TransformOptions; sourceDatabase: string;
  targetModel: SchemaModel; mappings: FieldMapping[]; decisions: Decision[]; warnings: string[]; risks: string[];
  ddl: string; runtime: Runtime; etlScript: string; runbook: RunbookPhase[]; validationQueries: string[];
  sourceTables: string[];
  stats: { sourceEntities: number; targetEntities: number; fieldsMapped: number; lossy: number; dropped: number; embedded: number; warnings: number; risks: number };
}
interface Core { targetModel: SchemaModel; mappings: FieldMapping[]; decisions: Decision[]; warnings: string[]; risks: string[]; ddl: string; runtime: Runtime; sourceTables: string[] }

// ── helpers ────────────────────────────────────────────────────────
const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9_]+/g, "_").toLowerCase().replace(/^_+|_+$/g, "") || "col";
const camel = (s: string) => s.replace(/[_\-\s]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase()).replace(/^[A-Z]/, (c) => c.toLowerCase());
const singular = (s: string) => (/ies$/.test(s) ? s.slice(0, -3) + "y" : /(ss|us|is)$/.test(s) ? s : /s$/.test(s) ? s.slice(0, -1) : s);
const ident = (s: string) => { const x = snake(s); return /^[0-9]/.test(x) ? `t_${x}` : x; };
/** Index/constraint names are schema-global in PostgreSQL and SQLite — qualify them with the table. */
const ixName = (table: string, name: string) => (name.toLowerCase().includes(table.toLowerCase()) ? name : `${table}_${name}`);
function uniqueName(used: Set<string>, base: string): string { let n = base, i = 2; while (used.has(n)) n = `${base}_${i++}`; used.add(n); return n; }
const fkOf = (e: EntityModel, known: Map<string, EntityModel>) => e.constraints.filter((c) => c.kind === "foreign_key" && c.referencedEntity && known.has(c.referencedEntity));

export function applyConverter(c: Converter, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (c) {
    case "identity": return v;
    case "bool_to_int": return v === true || v === "t" || v === "true" || v === 1 || v === "1" ? 1 : 0;
    case "int_to_bool": return v === true || Number(v) === 1 || v === "t" || v === "true";
    case "json_stringify": return typeof v === "string" ? v : JSON.stringify(v);
    case "json_parse": if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return v; }
    case "to_string": return v instanceof Date ? v.toISOString() : typeof v === "object" ? ((v as { _bsontype?: string })._bsontype ? String(v) : JSON.stringify(v)) : String(v);
    case "to_iso": return v instanceof Date ? v.toISOString() : String(v);
    case "to_date": { const d = new Date(v as string); return Number.isNaN(d.getTime()) ? v : { $date: d.toISOString() }; }
    case "to_decimal": return { $numberDecimal: String(v) };
  }
}

function sqlConverter(info: TypeInfo, from: Engine, to: Engine): Converter {
  if (info.family === "bool") { if (to === "postgres" && from !== "postgres") return "int_to_bool"; if (to !== "postgres" && from === "postgres") return "bool_to_int"; return "identity"; }
  if (info.family === "json" || info.family === "array") { if (to === "postgres") return from === "sqlite" ? "json_parse" : "identity"; return "json_stringify"; }
  if (to === "sqlite" && ["timestamp", "timestamptz", "date"].includes(info.family)) return "to_iso";
  return "identity";
}
function mongoConverter(info: TypeInfo, from: Engine): Converter {
  switch (info.family) {
    case "timestamp": case "timestamptz": case "date": return "to_date";
    case "decimal": return "to_decimal";
    case "json": return "json_parse";
    case "bool": return from === "postgres" ? "identity" : "int_to_bool";
    default: return "identity";
  }
}
function mongoToSqlConverter(info: TypeInfo, target: Engine, mixed: boolean): Converter {
  if (mixed) return "to_string";
  switch (info.family) {
    case "bool": return target === "postgres" ? "identity" : "bool_to_int";
    case "json": case "array": return target === "postgres" ? "identity" : "json_stringify";
    case "objectId": case "decimal": return "to_string";
    case "timestamptz": case "timestamp": case "date": return target === "sqlite" ? "to_iso" : "identity";
    default: return "identity";
  }
}

function groupLossy(mappings: FieldMapping[]): string[] {
  const groups = new Map<string, number>();
  for (const m of mappings) if (m.lossy && m.note) groups.set(m.note, (groups.get(m.note) ?? 0) + 1);
  return [...groups].map(([note, n]) => `${n} column${n > 1 ? "s" : ""}: ${note}`);
}

// ── relational → relational ────────────────────────────────────────
function planSqlToSql(model: SchemaModel, target: SqlDialect, opts: Opts): Core {
  const src = model.engine;
  const label = ENGINES[target].label;
  const ns = target === "postgres" ? opts.targetNamespace || "public" : target === "sqlite" ? "main" : opts.targetNamespace || ident(model.database || "app");
  const tm = emptyModel(target, model.database);
  tm.namespaces = [ns];
  tm.sourceMetadata.source = `transform:${src}->${target}`;
  tm.sourceMetadata.limitations.push("Generated target design — not applied to any database.");
  const mappings: FieldMapping[] = [], decisions: Decision[] = [], warnings: string[] = [], risks: string[] = [];
  const tables = model.entities.filter((e) => e.kind === "table");
  for (const e of model.entities) if (e.kind !== "table") warnings.push(`${e.kind} ${e.name} skipped — only tables are transformed; recreate views manually.`);
  const nameMap = new Map(tables.map((e) => [e.name, `${ns}.${e.shortName}`]));
  const srcByName = new Map(tables.map((e) => [e.name, e]));
  let identityCols = 0;

  for (const e of tables) {
    const tname = nameMap.get(e.name)!;
    const eid = entityId(target, ns, e.shortName);
    const te: EntityModel = { id: eid, name: tname, shortName: e.shortName, namespace: ns, kind: "table", engine: target, fields: [], indexes: [], constraints: [], comment: e.comment, metadata: { transformedFrom: e.name } };
    for (const f of e.fields) {
      const info = parseType(f.type, src);
      const auto = isAutoIncrement(f);
      const r = renderType(info, target);
      const md = mapDefault(f.defaultValue, src, target);
      const conv = sqlConverter(info, src, target);
      if (auto) identityCols++;
      te.fields.push({ id: fieldId(eid, f.name), name: f.name, type: r.type, nullable: f.nullable, defaultValue: auto ? null : md.value, isPrimaryKey: f.isPrimaryKey, isUnique: f.isUnique, identity: auto ? "identity" : null, comment: f.comment });
      const changed = r.type.toLowerCase() !== f.type.toLowerCase();
      mappings.push({
        sourceEntity: e.name, sourceField: f.name, sourceType: f.type, targetEntity: tname, targetField: f.name, targetType: r.type,
        action: changed || conv !== "identity" ? "convert" : "copy", lossy: r.lossy,
        note: [r.note, md.note, auto ? "auto-increment → identity column" : undefined, conv !== "identity" ? `value converter: ${conv}` : undefined].filter(Boolean).join(" · ") || undefined,
      });
    }
    for (const c of e.constraints) {
      if (c.kind === "foreign_key") {
        const ref = c.referencedEntity ? nameMap.get(c.referencedEntity) : undefined;
        if (!ref) { warnings.push(`FK ${c.name} on ${e.name} references ${c.referencedEntity ?? "an unknown table"} outside the transform — skipped.`); continue; }
        te.constraints.push({ ...c, id: constraintId(eid, c.name), referencedEntity: ref });
      } else if (c.kind === "check") {
        te.constraints.push({ ...c, id: constraintId(eid, c.name) });
        if (c.definition && /::|~|ILIKE|ANY\s*\(|ARRAY\[/i.test(c.definition)) warnings.push(`CHECK ${c.name} on ${e.name} uses PostgreSQL-specific syntax — review it for ${label}.`);
      } else if (c.kind === "primary_key") te.constraints.push({ ...c, id: constraintId(eid, c.name) });
      else if (c.kind === "unique") te.constraints.push({ ...c, name: ixName(e.shortName, c.name), id: constraintId(eid, c.name) });
    }
    for (const ix of e.indexes) {
      if (src === "postgres" && ix.method && !["btree", "hash"].includes(ix.method)) { warnings.push(`Index ${ix.name} (${ix.method}) has no ${label} equivalent — skipped.`); continue; }
      if (ix.partial && target === "mysql") { warnings.push(`Partial index ${ix.name} is not supported by MySQL — skipped (consider a generated column).`); continue; }
      te.indexes.push({ ...ix, name: ixName(e.shortName, ix.name), id: indexId(eid, ix.name), method: "btree" });
    }
    tm.entities.push(te);
  }
  for (const r of model.relationships) {
    const a = nameMap.get(r.fromEntity), b = nameMap.get(r.toEntity);
    if (a && b) tm.relationships.push({ ...r, id: relId(a, r.fromColumns, b, r.toColumns), fromEntity: a, toEntity: b });
  }
  tm.dependencies = tm.relationships.map((r) => ({ from: r.fromEntity, to: r.toEntity, kind: "fk" }));
  decisions.push({ kind: "info", title: `Dialect conversion ${ENGINES[src].label} → ${label}`, detail: `${tables.length} table(s), ${mappings.length} column(s) re-typed using the canonical type map; constraints and compatible indexes carried over.` });
  decisions.push({ kind: "info", title: "Load order follows foreign-key dependencies", detail: "Referenced tables load first so FK-enforcing targets never see orphans." });
  if (identityCols) decisions.push({ kind: "info", title: `${identityCols} auto-increment column(s)`, detail: target === "postgres" ? "Created as GENERATED BY DEFAULT AS IDENTITY — reset sequences after loading explicit ids." : target === "mysql" ? "Created as AUTO_INCREMENT; MySQL advances the counter past loaded ids." : "Created as INTEGER PRIMARY KEY AUTOINCREMENT." });
  risks.push(...groupLossy(mappings));
  if (target === "sqlite") risks.push("SQLite enforces foreign keys only when PRAGMA foreign_keys = ON on every connection.");

  const ordered = topoEntities(tm);
  const tableSpecs: TableSpec[] = ordered.map((te) => {
    const srcEntity = srcByName.get((te.metadata.transformedFrom as string) ?? "")!;
    return { source: srcEntity.name, target: te.name, pk: pkColumns(srcEntity), columns: mappings.filter((m) => m.sourceEntity === srcEntity.name).map((m) => ({ src: m.sourceField, dst: m.targetField, convert: sqlConverter(parseType(m.sourceType, src), src, target) })) };
  });
  return { targetModel: tm, mappings, decisions, warnings, risks, ddl: generateDdl(tm, target), runtime: { kind: "sql_to_sql", tables: tableSpecs }, sourceTables: tables.map((e) => e.name) };
}

// ── relational → MongoDB ───────────────────────────────────────────
function fieldSchema(f: FieldModel): Record<string, unknown> {
  if (f.isArray) return { bsonType: "array", items: f.nested ? objSchema(f.nested) : { bsonType: f.arrayOf ?? "string" } };
  if (f.nested) return objSchema(f.nested);
  return { bsonType: f.nullable ? [f.type, "null"] : f.type };
}
function objSchema(fields: FieldModel[]): Record<string, unknown> {
  return { bsonType: "object", required: fields.filter((x) => !x.nullable).map((x) => x.name), properties: Object.fromEntries(fields.map((x) => [x.name, fieldSchema(x)])) };
}
function mongoDdl(model: SchemaModel): string {
  const out = [`// DB Architect · target schema (MongoDB — run with mongosh)`, `// Generated ${new Date().toISOString()} — review before applying`, `// validationAction is "warn" during backfill; switch to "error" after validation.`, ""];
  for (const e of model.entities) {
    const schema = (e.metadata.validator as { $jsonSchema?: unknown } | undefined)?.$jsonSchema;
    out.push(`db.createCollection(${JSON.stringify(e.name)}, ${JSON.stringify({ validator: { $jsonSchema: schema }, validationLevel: "moderate", validationAction: "warn" }, null, 2)});`);
    for (const ix of e.indexes) {
      const keys = Object.fromEntries(ix.columns.map((c) => [c, 1]));
      out.push(`db.getCollection(${JSON.stringify(e.name)}).createIndex(${JSON.stringify(keys)}, { name: ${JSON.stringify(ix.name)}${ix.unique ? ", unique: true" : ""} });`);
    }
    out.push("");
  }
  return out.join("\n");
}

function planSqlToMongo(model: SchemaModel, opts: Opts): Core {
  const src = model.engine;
  const tm = emptyModel("mongodb", model.database);
  tm.namespaces = ["main"];
  tm.sourceMetadata.source = `transform:${src}->mongodb`;
  tm.sourceMetadata.limitations.push("Generated target design — references are NOT enforced by MongoDB.");
  const mappings: FieldMapping[] = [], decisions: Decision[] = [], warnings: string[] = [], risks: string[] = [];
  const tables = model.entities.filter((e) => e.kind === "table");
  for (const e of model.entities) if (e.kind !== "table") warnings.push(`${e.kind} ${e.name} skipped — recreate as a MongoDB view or aggregation manually.`);
  const byName = new Map(tables.map((e) => [e.name, e]));
  const incoming = new Map<string, number>();
  for (const e of tables) for (const c of fkOf(e, byName)) if (c.referencedEntity !== e.name) incoming.set(c.referencedEntity!, (incoming.get(c.referencedEntity!) ?? 0) + 1);
  const isJunction = (e: EntityModel) => {
    const fks = fkOf(e, byName);
    if (fks.length !== 2 || !fks.every((c) => c.columns.length === 1)) return false;
    const fkCols = new Set(fks.flatMap((c) => c.columns));
    return e.fields.filter((f) => !fkCols.has(f.name) && !(f.isPrimaryKey && /^id$/i.test(f.name))).length === 0;
  };
  const growth = /(log|event|audit|history|message|comment|activity|metric|tracking|session|notification|click)s?$/i;

  const embedInto = new Map<string, { parent: string; fk: ConstraintModel }>();
  if (opts.embed === "auto") {
    for (const e of tables) {
      const fks = fkOf(e, byName);
      if (fks.length !== 1 || fks[0].columns.length !== 1 || isJunction(e)) continue;
      const fk = fks[0];
      const parent = fk.referencedEntity!;
      if (parent === e.name) continue;
      if ((incoming.get(e.name) ?? 0) > 0) { decisions.push({ kind: "reference", title: `Keep ${e.shortName} as its own collection`, detail: "Other tables reference it, so it is independently addressable." }); continue; }
      if (growth.test(e.shortName)) { decisions.push({ kind: "reference", title: `Keep ${e.shortName} as its own collection`, detail: "The name suggests append-only/unbounded growth; embedding risks the 16 MB document limit and update amplification." }); continue; }
      const parentShort = byName.get(parent)!.shortName;
      const owned = /cascade/i.test(fk.onDelete ?? "") || e.shortName.toLowerCase().startsWith(singular(parentShort).toLowerCase());
      if (!owned) { decisions.push({ kind: "reference", title: `Reference ${e.shortName} from ${parentShort}`, detail: "No ownership signal (no ON DELETE CASCADE, no naming link) — kept as a separate collection." }); continue; }
      embedInto.set(e.name, { parent, fk });
    }
    for (const [child, v] of [...embedInto]) if (embedInto.has(v.parent)) { embedInto.delete(child); decisions.push({ kind: "reference", title: `Keep ${byName.get(child)!.shortName} as its own collection`, detail: "Its parent is itself embedded; one level of embedding avoids deeply nested updates." }); }
  }
  const junctions = new Map<string, ConstraintModel[]>();
  for (const e of tables) {
    if (embedInto.has(e.name) || !isJunction(e)) continue;
    const fks = fkOf(e, byName);
    const parent = fks[0].referencedEntity!;
    if (embedInto.has(parent) || (incoming.get(e.name) ?? 0) > 0) continue;
    junctions.set(e.name, fks);
  }
  const roots = tables.filter((e) => !embedInto.has(e.name) && !junctions.has(e.name));
  const rootNames = new Set(roots.map((e) => e.name));
  const collections: CollectionSpec[] = [];

  for (const e of roots) {
    const cname = e.shortName;
    const eid = entityId("mongodb", "main", cname);
    const pk = pkColumns(e);
    const singlePk = pk.length === 1 ? pk[0] : null;
    const fieldName = (n: string) => (n === singlePk ? "_id" : opts.camelCase ? camel(n) : n);
    const fields: FieldModel[] = [];
    const cols: ColumnSpec[] = [];
    const fkCols = new Set(fkOf(e, byName).flatMap((c) => c.columns));
    if (!singlePk) {
      fields.push({ id: fieldId(eid, "_id"), name: "_id", type: "objectId", nullable: false, bsonTypes: ["objectId"], presence: 1, isPrimaryKey: true });
      mappings.push({ sourceEntity: e.name, sourceField: pk.join("+") || "(none)", sourceType: "composite/none", targetEntity: cname, targetField: "_id", targetType: "objectId", action: "generate", lossy: false, note: "No single-column primary key — MongoDB generates an ObjectId; add a unique index on the natural key" });
    }
    for (const f of e.fields) {
      const info = parseType(f.type, src);
      const r = renderType(info, "mongodb");
      const name = fieldName(f.name);
      fields.push({ id: fieldId(eid, name), name, type: r.type, nullable: name === "_id" ? false : f.nullable, bsonTypes: [r.type], presence: f.nullable ? 0.9 : 1, defaultValue: null, isPrimaryKey: name === "_id" });
      const conv = mongoConverter(info, src);
      cols.push({ src: f.name, dst: name, convert: conv });
      const md = mapDefault(f.defaultValue, src, "mongodb");
      mappings.push({ sourceEntity: e.name, sourceField: f.name, sourceType: f.type, targetEntity: cname, targetField: name, targetType: r.type, action: fkCols.has(f.name) ? "reference" : name === "_id" || r.type !== f.type ? "convert" : "copy", lossy: r.lossy, note: [r.note, fkCols.has(f.name) ? "reference to another collection (not enforced)" : undefined, f.defaultValue && md.note ? md.note : undefined].filter(Boolean).join(" · ") || undefined });
    }
    const embeds: EmbedSpec[] = [];
    const idxs: IndexModel[] = [];
    const seen = new Set<string>();
    const addIdx = (name: string, columns: string[], unique: boolean) => {
      const key = `${columns.join(",")}|${unique}`;
      if (seen.has(key) || !columns.length || (columns.length === 1 && columns[0] === "_id")) return;
      seen.add(key);
      idxs.push({ id: indexId(eid, name), name, columns, unique, method: "btree" });
    };
    for (const [childName, v] of embedInto) {
      if (v.parent !== e.name) continue;
      const ce = byName.get(childName)!;
      const fkCol = v.fk.columns[0];
      const parentKey = v.fk.referencedColumns?.[0] ?? singlePk ?? "id";
      const cpk = pkColumns(ce);
      const keep = ce.fields.filter((f) => f.name !== fkCol && !(cpk.length === 1 && cpk[0] === f.name && isAutoIncrement(f)));
      const field = opts.camelCase ? camel(ce.shortName) : ce.shortName;
      const nested: FieldModel[] = [];
      const ecols: ColumnSpec[] = [];
      for (const f of keep) {
        const info = parseType(f.type, src);
        const r = renderType(info, "mongodb");
        const dst = opts.camelCase ? camel(f.name) : f.name;
        nested.push({ id: fieldId(eid, `${field}.${dst}`), name: dst, type: r.type, nullable: f.nullable, bsonTypes: [r.type], presence: f.nullable ? 0.9 : 1, defaultValue: null });
        ecols.push({ src: f.name, dst, convert: mongoConverter(info, src) });
        mappings.push({ sourceEntity: ce.name, sourceField: f.name, sourceType: f.type, targetEntity: cname, targetField: `${field}[].${dst}`, targetType: r.type, action: "embed", lossy: r.lossy, note: r.note });
      }
      mappings.push({ sourceEntity: ce.name, sourceField: fkCol, sourceType: ce.fields.find((f) => f.name === fkCol)?.type ?? "", targetEntity: cname, targetField: "(implicit)", targetType: "—", action: "drop", lossy: false, note: `Parent link — implied by embedding in ${cname}` });
      fields.push({ id: fieldId(eid, field), name: field, type: "array", isArray: true, arrayOf: "object", nested, nullable: false, bsonTypes: ["array"], presence: 1 });
      embeds.push({ source: ce.name, fk: fkCol, parentKey, field, columns: ecols });
      decisions.push({ kind: "embed", title: `Embed ${ce.shortName} into ${e.shortName}`, detail: `One-to-many and owned (${/cascade/i.test(v.fk.onDelete ?? "") ? "ON DELETE CASCADE" : "naming link"}); nothing else references it. A single read returns the parent with all children. Keep the array bounded — documents must stay under 16 MB.` });
      for (const ofk of ce.constraints.filter((c) => c.kind === "foreign_key" && c !== v.fk)) addIdx(`${cname}_${field}_${ofk.columns[0]}`, [`${field}.${opts.camelCase ? camel(ofk.columns[0]) : ofk.columns[0]}`], false);
    }
    const jspecs: JunctionSpec[] = [];
    for (const [jn, fks] of junctions) {
      if (fks[0].referencedEntity !== e.name) continue;
      const other = byName.get(fks[1].referencedEntity!)!;
      const field = `${camel(singular(other.shortName))}Ids`;
      const otherPk = other.fields.find((f) => f.name === (fks[1].referencedColumns?.[0] ?? "id"));
      fields.push({ id: fieldId(eid, field), name: field, type: "array", isArray: true, arrayOf: otherPk ? renderType(parseType(otherPk.type, src), "mongodb").type : "string", nullable: false, bsonTypes: ["array"], presence: 1 });
      jspecs.push({ source: jn, fkParent: fks[0].columns[0], fkOther: fks[1].columns[0], parentKey: fks[0].referencedColumns?.[0] ?? singlePk ?? "id", field });
      mappings.push({ sourceEntity: jn, sourceField: `${fks[0].columns[0]}, ${fks[1].columns[0]}`, sourceType: "junction", targetEntity: cname, targetField: field, targetType: "array", action: "reference", lossy: false, note: "Many-to-many junction becomes an array of references" });
      decisions.push({ kind: "reference", title: `Junction ${byName.get(jn)!.shortName} → ${cname}.${field}`, detail: `Pure many-to-many link table becomes an array of ${other.shortName} ids on ${cname}. Index the array (multikey) for reverse lookups.` });
    }
    for (const c of e.constraints.filter((x) => x.kind === "unique")) addIdx(`${cname}_${c.columns.join("_")}_uq`, c.columns.map(fieldName), true);
    for (const ix of e.indexes) {
      if (ix.partial || (ix.method && !["btree", "hash"].includes(ix.method))) { warnings.push(`Index ${ix.name} on ${e.name} (${ix.partial ? "partial" : ix.method}) is not carried over.`); continue; }
      addIdx(ix.name, ix.columns.map(fieldName), ix.unique);
    }
    for (const c of fkOf(e, byName)) addIdx(`${cname}_${fieldName(c.columns[0])}_ref`, [fieldName(c.columns[0])], false);
    tm.entities.push({ id: eid, name: cname, shortName: cname, namespace: "main", kind: "collection", engine: "mongodb", fields, indexes: idxs, constraints: [], comment: e.comment, metadata: { transformedFrom: e.name, validator: { $jsonSchema: objSchema(fields) } } });
    collections.push({ source: e.name, target: cname, pk, columns: cols, embeds, junctions: jspecs });
    for (const c of fkOf(e, byName)) {
      if (!rootNames.has(c.referencedEntity!)) continue;
      const refShort = byName.get(c.referencedEntity!)!.shortName;
      tm.relationships.push({ id: relId(cname, [fieldName(c.columns[0])], refShort, ["_id"]), name: `${cname}.${fieldName(c.columns[0])} → ${refShort}._id`, fromEntity: cname, fromColumns: [fieldName(c.columns[0])], toEntity: refShort, toColumns: ["_id"], cardinality: "one-to-many", optionality: "optional", provenance: "inferred_schema", confidence: 0.95 } as RelationshipModel);
    }
  }
  tm.dependencies = tm.relationships.map((r) => ({ from: r.fromEntity, to: r.toEntity, kind: "reference" }));
  if (!embedInto.size && opts.embed === "auto") decisions.push({ kind: "info", title: "No embedding candidates", detail: "No child table was single-parent, owned and bounded — every table became its own collection." });
  decisions.push({ kind: "info", title: "NULL values are omitted from documents", detail: "Missing fields are the idiomatic MongoDB representation of NULL; validators allow null where the column was nullable." });
  decisions.push({ kind: "info", title: "Primary keys become _id", detail: "Single-column primary keys are reused as _id (their values are preserved), so references keep working without an id-translation table." });
  risks.push("MongoDB does not enforce the foreign keys you had — application code owns referential integrity and cascade deletes.");
  risks.push("Cross-collection atomic updates need multi-document transactions (replica set required).");
  risks.push(...groupLossy(mappings));
  if (embedInto.size) risks.push("Embedded arrays duplicate the child lifecycle into the parent: updating one child rewrites the parent document.");
  const sourceTables = tables.map((e) => e.name);
  return { targetModel: tm, mappings, decisions, warnings, risks, ddl: mongoDdl(tm), runtime: { kind: "sql_to_mongo", collections }, sourceTables };
}

// ── MongoDB → relational ───────────────────────────────────────────
function mongoFieldInfo(f: { bsonTypes?: string[]; type: string }, only?: string[]): { info: TypeInfo; mixed: boolean } {
  const raw = only ?? (f.bsonTypes?.length ? f.bsonTypes : f.type.split("|").map((s) => s.trim()));
  const bts = [...new Set(raw.filter((t) => t && t !== "null"))];
  if (!bts.length) return { info: parseType("string", "mongodb"), mixed: false };
  if (bts.length === 1) return { info: parseType(bts[0], "mongodb"), mixed: false };
  if (bts.every((t) => ["int", "long", "double", "decimal"].includes(t))) return { info: parseType(bts.includes("decimal") ? "decimal" : bts.includes("double") ? "double" : "long", "mongodb"), mixed: false };
  return { info: parseType("string", "mongodb"), mixed: true };
}

function planMongoToSql(model: SchemaModel, target: SqlDialect, opts: Opts): Core {
  const label = ENGINES[target].label;
  const ns = target === "postgres" ? opts.targetNamespace || "public" : target === "sqlite" ? "main" : opts.targetNamespace || ident(model.database || "app");
  const tm = emptyModel(target, model.database);
  tm.namespaces = [ns];
  tm.sourceMetadata.source = `transform:mongodb->${target}`;
  tm.sourceMetadata.limitations.push("Generated target design — derived from sampled document shapes.");
  const mappings: FieldMapping[] = [], decisions: Decision[] = [], warnings: string[] = [], risks: string[] = [];
  const tableOf = new Map(model.entities.map((e) => [e.name, ident(e.shortName)]));
  const roots: RootSpec[] = [];
  const idTypeOf = new Map<string, string>();
  const refs: { entity: EntityModel; table: string; rel: RelationshipModel }[] = [];
  const colByPath = new Map<string, Map<string, string>>();
  let mixedCount = 0;

  const mkEntity = (table: string): EntityModel => {
    const eid = entityId(target, ns, table);
    return { id: eid, name: `${ns}.${table}`, shortName: table, namespace: ns, kind: "table", engine: target, fields: [], indexes: [], constraints: [], metadata: {} };
  };
  const field = (te: EntityModel, name: string, type: string, nullable: boolean): FieldModel => {
    const f: FieldModel = { id: fieldId(te.id, name), name, type, nullable, defaultValue: null };
    te.fields.push(f);
    return f;
  };

  for (const e of model.entities) {
    const table = tableOf.get(e.name)!;
    const te = mkEntity(table);
    const usedTables = new Set([...tableOf.values()]);
    const idField = e.fields.find((f) => f.name === "_id");
    const idInfo = idField ? mongoFieldInfo(idField).info : parseType("objectId", "mongodb");
    const idR = renderType(idInfo, target);
    idTypeOf.set(e.name, idR.type);
    field(te, "id", idR.type, false).isPrimaryKey = true;
    te.constraints.push({ id: constraintId(te.id, `${table}_pkey`), name: `${table}_pkey`, kind: "primary_key", columns: ["id"] });
    mappings.push({ sourceEntity: e.name, sourceField: "_id", sourceType: idField?.type ?? "objectId", targetEntity: te.name, targetField: "id", targetType: idR.type, action: "convert", lossy: false, note: "Primary key — original ObjectId/value preserved as text so references keep working" });
    const columns: PathColumn[] = [];
    const children: ChildSpec[] = [];
    const used = new Set<string>(["id"]);
    const paths = new Map<string, string>();
    colByPath.set(e.name, paths);

    const addScalar = (name: string, path: string[], f: FieldModel, optional: boolean, depth: number) => {
      const { info, mixed } = mongoFieldInfo(f);
      const r = renderType(info, target);
      const col = uniqueName(used, name);
      if (mixed) { mixedCount++; warnings.push(`${e.name}.${path.join(".")} has mixed types (${(f.bsonTypes ?? []).join(", ")}) — stored as text.`); }
      const conv = mongoToSqlConverter(info, target, mixed);
      field(te, col, mixed ? renderType(parseType("string", "mongodb"), target).type : r.type, optional || mixed);
      columns.push({ path, dst: col, convert: conv });
      paths.set(path.join("."), col);
      mappings.push({ sourceEntity: e.name, sourceField: path.join("."), sourceType: f.type, targetEntity: te.name, targetField: col, targetType: te.fields[te.fields.length - 1].type, action: depth > 0 ? "flatten" : conv !== "identity" || r.type !== f.type ? "convert" : "copy", lossy: r.lossy, note: [mixed ? "mixed BSON types → text" : r.note, conv !== "identity" ? `value converter: ${conv}` : undefined].filter(Boolean).join(" · ") || undefined });
    };
    const addJson = (name: string, path: string[], optional: boolean, why: string) => {
      const col = uniqueName(used, name);
      const t = renderType(parseType("json", "mongodb"), target);
      field(te, col, t.type, optional);
      columns.push({ path, dst: col, convert: target === "postgres" ? "identity" : "json_stringify" });
      paths.set(path.join("."), col);
      mappings.push({ sourceEntity: e.name, sourceField: path.join("."), sourceType: "object/array", targetEntity: te.name, targetField: col, targetType: t.type, action: "json", lossy: t.lossy, note: [why, t.note].filter(Boolean).join(" · ") });
    };
    const addChild = (name: string, path: string[], f: FieldModel) => {
      const elemTypes = (f.arrayOf ?? "").split("|").map((s) => s.trim()).filter(Boolean);
      const objectItems = elemTypes.includes("object");
      const childTable = uniqueName(usedTables, ident(`${table}_${name}`));
      const ce = mkEntity(childTable);
      const fk = `${table}_id`;
      field(ce, fk, idR.type, false);
      field(ce, "position", renderType(parseType("int", "mongodb"), target).type, false);
      const spec: ChildSpec = { path, target: ce.name, fk, kind: objectItems ? "object" : "scalar", valueColumn: "value", columns: [], scalarConvert: "identity" };
      const cused = new Set([fk, "position"]);
      if (objectItems && f.nested) {
        for (const nf of f.nested) {
          const nb = (nf.bsonTypes ?? []).filter((t) => t !== "null");
          const col = uniqueName(cused, snake(nf.name));
          if (nf.isArray || nb.includes("object") || nb.includes("array")) {
            const t = renderType(parseType("json", "mongodb"), target);
            field(ce, col, t.type, true);
            spec.columns.push({ path: [nf.name], dst: col, convert: target === "postgres" ? "identity" : "json_stringify" });
          } else {
            const { info, mixed } = mongoFieldInfo(nf);
            const r = renderType(info, target);
            field(ce, col, mixed ? renderType(parseType("string", "mongodb"), target).type : r.type, nf.nullable || (nf.presence ?? 1) < 1 || mixed);
            spec.columns.push({ path: [nf.name], dst: col, convert: mongoToSqlConverter(info, target, mixed) });
          }
          mappings.push({ sourceEntity: e.name, sourceField: `${path.join(".")}[].${nf.name}`, sourceType: nf.type, targetEntity: ce.name, targetField: col, targetType: ce.fields[ce.fields.length - 1].type, action: "child_table", lossy: false });
        }
      } else {
        const { info, mixed } = mongoFieldInfo({ type: f.arrayOf ?? "string" }, elemTypes.filter((t) => t !== "object"));
        const r = renderType(info, target);
        const vt = mixed ? renderType(parseType("string", "mongodb"), target).type : r.type;
        field(ce, "value", vt, true);
        spec.scalarConvert = mongoToSqlConverter(info, target, mixed);
        mappings.push({ sourceEntity: e.name, sourceField: `${path.join(".")}[]`, sourceType: f.arrayOf ?? "mixed", targetEntity: ce.name, targetField: "value", targetType: vt, action: "child_table", lossy: mixed || r.lossy, note: mixed ? "mixed element types → text" : r.note });
        if (objectItems) { addJson(name, path, true, "array of objects without a sampled shape → JSON"); return; }
      }
      ce.constraints.push({ id: constraintId(ce.id, `${childTable}_pkey`), name: `${childTable}_pkey`, kind: "primary_key", columns: [fk, "position"] });
      ce.constraints.push({ id: constraintId(ce.id, `fk_${childTable}_${fk}`), name: `fk_${childTable}_${fk}`, kind: "foreign_key", columns: [fk], referencedEntity: te.name, referencedColumns: ["id"], onDelete: "CASCADE" });
      tm.entities.push(ce);
      children.push(spec);
      decisions.push({ kind: "child_table", title: `${e.shortName}.${path.join(".")}[] → table ${childTable}`, detail: `${objectItems ? "Array of objects" : "Array of scalars"} becomes a child table keyed by (${fk}, position) with ON DELETE CASCADE.` });
    };

    const walk = (fields: FieldModel[], path: string[], prefix: string, depth: number) => {
      for (const f of fields) {
        if (depth === 0 && f.name === "_id") continue;
        const fpath = [...path, f.name];
        const bts = (f.bsonTypes ?? []).filter((t) => t !== "null");
        const optional = f.nullable || (f.presence ?? 1) < 1 || (f.bsonTypes ?? []).includes("null");
        const name = snake([prefix, f.name].filter(Boolean).join("_"));
        if (f.isArray || bts.includes("array")) {
          if (opts.arrays === "json") addJson(name, fpath, true, "arrays kept as JSON (option)");
          else if (opts.arrays === "native" && target === "postgres" && !(f.arrayOf ?? "").includes("object") && !(f.arrayOf ?? "").includes("|")) {
            const r = renderType(parseType(f.arrayOf || "string", "mongodb"), "postgres");
            const col = uniqueName(used, name);
            field(te, col, `${r.type}[]`, true);
            columns.push({ path: fpath, dst: col, convert: "identity" });
            paths.set(fpath.join("."), col);
            mappings.push({ sourceEntity: e.name, sourceField: fpath.join("."), sourceType: f.type, targetEntity: te.name, targetField: col, targetType: `${r.type}[]`, action: "convert", lossy: false, note: "native PostgreSQL array" });
          } else addChild(name, fpath, f);
          continue;
        }
        if (f.nested && (bts.includes("object") || bts.length === 0)) {
          if (opts.nested === "flatten" && depth < opts.maxFlattenDepth) {
            decisions.push({ kind: "flatten", title: `Flatten ${e.shortName}.${fpath.join(".")}`, detail: `Embedded object becomes ${f.nested.length} column(s) prefixed "${name}_".` });
            walk(f.nested, fpath, name, depth + 1);
          } else addJson(name, fpath, optional, depth >= opts.maxFlattenDepth ? "nesting deeper than the flatten limit → JSON" : "objects kept as JSON (option)");
          continue;
        }
        addScalar(name, fpath, f, optional, depth);
      }
    };
    walk(e.fields, [], "", 0);
    tm.entities.unshift(te);
    // indexes
    const seen = new Set<string>();
    for (const ix of e.indexes) {
      if (ix.name === "_id_" || (ix.columns.length === 1 && ix.columns[0] === "_id")) continue;
      if (ix.kind === "ttl") { warnings.push(`TTL index ${ix.name} on ${e.name} has no SQL equivalent — schedule a DELETE job instead.`); continue; }
      if (ix.method && !["btree", "hash"].includes(ix.method)) { warnings.push(`Index ${ix.name} on ${e.name} (${ix.method}) is not carried over.`); continue; }
      const mapped = ix.columns.map((c) => paths.get(c));
      if (mapped.some((m) => !m)) { warnings.push(`Index ${ix.name} on ${e.name} references fields that did not become columns — skipped.`); continue; }
      const key = `${mapped.join(",")}|${ix.unique}`;
      if (seen.has(key)) continue;
      seen.add(key);
      te.indexes.push({ id: indexId(te.id, ix.name), name: `${table}_${(mapped as string[]).join("_")}${ix.unique ? "_uq" : "_idx"}`, columns: mapped as string[], unique: ix.unique, method: "btree" });
    }
    for (const rel of model.relationships.filter((r) => r.fromEntity === e.name && r.provenance !== "explicit" && tableOf.has(r.toEntity))) refs.push({ entity: e, table, rel });
    roots.push({ source: e.name, target: te.name, idColumn: "id", columns, children });
  }

  // Inferred references → deferred foreign keys with aligned types.
  for (const { entity, table, rel } of refs) {
    const te = tm.entities.find((x) => x.shortName === table)!;
    const col = colByPath.get(entity.name)?.get(rel.fromColumns[0]);
    const refTable = tableOf.get(rel.toEntity)!;
    if (!col) continue;
    const f = te.fields.find((x) => x.name === col)!;
    const idType = idTypeOf.get(rel.toEntity)!;
    f.type = idType;
    const mp = mappings.find((m) => m.targetEntity === te.name && m.targetField === col);
    if (mp) { mp.targetType = idType; mp.action = "reference"; mp.note = [mp.note, `inferred reference → ${refTable}.id`].filter(Boolean).join(" · "); }
    const root = roots.find((r) => r.target === te.name);
    const pc = root?.columns.find((c) => c.dst === col);
    if (pc) pc.convert = "to_string";
    te.constraints.push({ id: constraintId(te.id, `fk_${table}_${col}`), name: `fk_${table}_${col}`, kind: "foreign_key", columns: [col], referencedEntity: `${ns}.${refTable}`, referencedColumns: ["id"] });
    tm.relationships.push({ id: relId(te.name, [col], `${ns}.${refTable}`, ["id"]), name: `${table}.${col} → ${refTable}.id`, fromEntity: te.name, fromColumns: [col], toEntity: `${ns}.${refTable}`, toColumns: ["id"], cardinality: "one-to-many", optionality: f.nullable ? "optional" : "required", provenance: "inferred_schema", confidence: rel.confidence ?? 0.5 });
    decisions.push({ kind: "reference", title: `Inferred reference ${table}.${col} → ${refTable}.id becomes a foreign key`, detail: `Confidence ${Math.round((rel.confidence ?? 0.5) * 100)}%. Applied in Phase 2 after load — orphaned values must be cleaned first.` });
  }
  for (const te of tm.entities) for (const c of te.constraints.filter((x) => x.kind === "foreign_key" && x.name.startsWith("fk_") && te.name !== "")) {
    if (!tm.relationships.some((r) => r.fromEntity === te.name && r.fromColumns[0] === c.columns[0])) tm.relationships.push({ id: relId(te.name, c.columns, c.referencedEntity ?? "", ["id"]), name: c.name, fromEntity: te.name, fromColumns: c.columns, toEntity: c.referencedEntity ?? "", toColumns: ["id"], cardinality: "one-to-many", optionality: "required", provenance: "explicit", confidence: 1 });
  }
  tm.dependencies = tm.relationships.map((r) => ({ from: r.fromEntity, to: r.toEntity, kind: "fk" }));
  decisions.push({ kind: "info", title: "Schema derived from sampled documents", detail: `Column types and nullability come from observed BSON types and field presence (${model.sourceMetadata.sampleSize ?? "?"} sampled documents). Fields absent from the sample will not become columns.` });
  risks.push("Schemaless data meets strict columns: values that differ from the sampled types will fail inserts — profile data quality (type histogram per field) before loading.");
  risks.push("Nullability was inferred from a sample — verify before enforcing NOT NULL on production data.");
  if (mixedCount) risks.push(`${mixedCount} field(s) have mixed types and were stored as text — normalize them in MongoDB first for typed columns.`);
  risks.push(...groupLossy(mappings));
  void label;
  const ddl = generateDdl(tm, target, { deferForeignKeys: target !== "sqlite" });
  return { targetModel: tm, mappings, decisions, warnings, risks, ddl, runtime: { kind: "mongo_to_sql", roots }, sourceTables: model.entities.map((e) => e.name) };
}

// ── runbook & validation ───────────────────────────────────────────
function buildRunbook(src: Engine, dst: Engine, core: Core): { runbook: RunbookPhase[]; validationQueries: string[] } {
  const drivers = (e: Engine) => ({ postgres: "pg", mysql: "mysql2", sqlite: "better-sqlite3", mongodb: "mongodb" } as const)[e];
  const target = ENGINES[dst].label;
  const cdc: Record<Engine, string> = {
    postgres: "Stream changes with logical replication / Debezium (wal2json or pgoutput) while the backfill runs.",
    mysql: "Stream changes from the binlog (Debezium or gh-ost style tooling) while the backfill runs.",
    mongodb: "Tail change streams (requires a replica set) to replay writes made during the backfill.",
    sqlite: "SQLite is a single file — schedule a short write freeze and copy during the outage.",
  };
  const runbook: RunbookPhase[] = [
    { title: "1 · Assess & freeze", steps: [`Review ${core.warnings.length} warning(s) and ${core.risks.length} risk(s) on the Decisions tab.`, "Take a full backup/snapshot of the source and rehearse the restore.", "Record baseline row/document counts (queries below)."] },
    { title: `2 · Create the ${target} schema`, steps: dst === "mongodb"
      ? ["Create the target database and run the generated mongosh script.", "Validators start with validationAction \"warn\" — switch to \"error\" after validation."]
      : ["Create an empty target database.", "Run the generated DDL (Phase 1: tables and indexes).", ...(core.ddl.includes("Phase 2") ? ["Foreign keys are deferred (Phase 2) so bulk load is not blocked by ordering or orphans."] : [])] },
    { title: "3 · Backfill (bulk copy)", steps: [`npm i ${[...new Set([drivers(src), drivers(dst)])].join(" ")}`, "export SOURCE_URL=… TARGET_URL=…  (use a read-only user on the source)", "Run with DRY_RUN=1 first, then for real. Inserts ignore duplicates, so the script is safe to re-run.", dst === "mysql" ? "For large loads consider SET foreign_key_checks=0 for the session, then validate." : dst === "postgres" ? "After load, reset identity sequences, e.g. SELECT setval(pg_get_serial_sequence('t','id'), (SELECT MAX(id) FROM t));" : "Create secondary indexes after the load for speed (the script does this for MongoDB targets)."] },
    { title: "4 · Validate", steps: ["Compare counts using the validation queries.", "Spot-check ~20 records end to end against the source.", "Run orphan checks before applying Phase 2 foreign keys or trusting references.", "Compare aggregates (SUM/COUNT) of key business columns."] },
    { title: "5 · Keep in sync until cutover", steps: [cdc[src], "Alternative: dual-write from the application behind a feature flag and reconcile."] },
    { title: "6 · Cut over & keep a way back", steps: ["Flip the application to the new database behind a flag.", "Keep the source read-only for an agreed period.", "Rollback = flip the flag back; writes made on the target after cutover must be replayed to the source."] },
  ];
  const q: string[] = [];
  const rt = core.runtime;
  if (rt.kind === "sql_to_sql") for (const t of rt.tables) q.push(`-- ${t.source}`, `SELECT COUNT(*) FROM ${t.source.split(".").pop()};  -- source (${ENGINES[src].label})`, `SELECT COUNT(*) FROM ${t.target.split(".").pop()};  -- target (${target})`);
  if (rt.kind === "sql_to_mongo") for (const c of rt.collections) {
    q.push(`-- ${c.source}`, `SELECT COUNT(*) FROM ${c.source.split(".").pop()};  -- source`, `db.${c.target}.countDocuments();  // target`);
    for (const em of c.embeds) q.push(`SELECT COUNT(*) FROM ${em.source.split(".").pop()};  -- source (embedded)`, `db.${c.target}.aggregate([{ $unwind: "$${em.field}" }, { $count: "n" }]);  // target`);
  }
  if (rt.kind === "mongo_to_sql") for (const r of rt.roots) {
    q.push(`-- ${r.source}`, `db.${r.source}.countDocuments();  // source`, `SELECT COUNT(*) FROM ${r.target.split(".").pop()};  -- target`);
    for (const ch of r.children) q.push(`db.${r.source}.aggregate([{ $group: { _id: null, n: { $sum: { $size: { $ifNull: ["$${ch.path.join(".")}", []] } } } } }]);  // source`, `SELECT COUNT(*) FROM ${ch.target.split(".").pop()};  -- target`);
  }
  if (rt.kind === "mongo_to_sql") for (const e of core.targetModel.entities) for (const c of e.constraints.filter((x) => x.kind === "foreign_key")) {
    const ref = c.referencedEntity?.split(".").pop();
    if (ref) q.push(`-- orphan check before applying ${c.name}`, `SELECT COUNT(*) FROM ${e.shortName} c LEFT JOIN ${ref} p ON p.id = c.${c.columns[0]} WHERE c.${c.columns[0]} IS NOT NULL AND p.id IS NULL;`);
  }
  if (dst === "mongodb") for (const r of core.targetModel.relationships.slice(0, 6)) {
    const to = r.toEntity;
    q.push(`-- orphan check: ${r.fromEntity}.${r.fromColumns[0]} → ${to}`, `db.${r.fromEntity}.aggregate([{ $lookup: { from: "${to}", localField: "${r.fromColumns[0]}", foreignField: "_id", as: "ref" } }, { $match: { ref: { $size: 0 }, "${r.fromColumns[0]}": { $ne: null } } }, { $count: "orphans" }]);`);
  }
  return { runbook, validationQueries: q };
}

// ── public API ─────────────────────────────────────────────────────
export function planTransform(model: SchemaModel, target: Engine, options: TransformOptions = {}): TransformPlan {
  if (model.engine === target) throw new Error(`Source and target are both ${ENGINES[target].label}. Use Diff & Migrate for same-engine changes.`);
  if (!model.entities.length) throw new Error("The source schema has no entities to transform.");
  const opts: Opts = { ...DEFAULT_TRANSFORM_OPTIONS, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) } as Opts;
  const core = isRelational(model.engine)
    ? isRelational(target) ? planSqlToSql(model, target as SqlDialect, opts) : planSqlToMongo(model, opts)
    : planMongoToSql(model, target as SqlDialect, opts);
  const { runbook, validationQueries } = buildRunbook(model.engine, target, core);
  const etlScript = buildEtlScript({ sourceEngine: model.engine, targetEngine: target, runtime: core.runtime, targetModel: core.targetModel });
  return {
    sourceEngine: model.engine, targetEngine: target, options: opts, sourceDatabase: model.database,
    ...core, etlScript, runbook, validationQueries,
    stats: {
      sourceEntities: model.entities.length, targetEntities: core.targetModel.entities.length, fieldsMapped: core.mappings.length,
      lossy: core.mappings.filter((m) => m.lossy).length, dropped: core.mappings.filter((m) => m.action === "drop").length,
      embedded: core.decisions.filter((d) => d.kind === "embed").length, warnings: core.warnings.length, risks: core.risks.length,
    },
  };
}

// ── row transformation (preview + tests; the ETL script mirrors this) ──
function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) { if (cur === null || typeof cur !== "object") return undefined; cur = (cur as Row)[p]; }
  return cur;
}
function buildDoc(cols: ColumnSpec[], row: Row): Row {
  const d: Row = {};
  for (const c of cols) { const v = applyConverter(c.convert, row[c.src]); if (v !== null && v !== undefined) d[c.dst] = v; }
  return d;
}

export function transformRows(plan: Pick<TransformPlan, "runtime">, input: Record<string, Row[]>): Record<string, Row[]> {
  const rt = plan.runtime;
  const out: Record<string, Row[]> = {};
  if (rt.kind === "sql_to_sql") {
    for (const t of rt.tables) out[t.target] = (input[t.source] ?? []).map((r) => { const o: Row = {}; for (const c of t.columns) o[c.dst] = applyConverter(c.convert, r[c.src]); return o; });
  } else if (rt.kind === "sql_to_mongo") {
    for (const spec of rt.collections) {
      out[spec.target] = (input[spec.source] ?? []).map((r) => {
        const d = buildDoc(spec.columns, r);
        for (const em of spec.embeds) d[em.field] = (input[em.source] ?? []).filter((cr) => String(cr[em.fk]) === String(r[em.parentKey])).map((cr) => buildDoc(em.columns, cr));
        for (const j of spec.junctions) d[j.field] = (input[j.source] ?? []).filter((jr) => String(jr[j.fkParent]) === String(r[j.parentKey])).map((jr) => jr[j.fkOther]);
        return d._id !== undefined ? { _id: d._id, ...d } : d;
      });
    }
  } else {
    for (const root of rt.roots) {
      out[root.target] = [];
      for (const ch of root.children) out[ch.target] = [];
      for (const doc of input[root.source] ?? []) {
        const row: Row = { [root.idColumn]: doc._id === undefined ? null : String(doc._id) };
        for (const c of root.columns) { const v = getPath(doc, c.path); row[c.dst] = v === undefined ? null : applyConverter(c.convert, v); }
        out[root.target].push(row);
        for (const ch of root.children) {
          const arr = getPath(doc, ch.path);
          if (!Array.isArray(arr)) continue;
          arr.forEach((item, i) => {
            const r: Row = { [ch.fk]: row[root.idColumn], position: i };
            if (ch.kind === "scalar") r[ch.valueColumn] = applyConverter(ch.scalarConvert, item);
            else for (const c of ch.columns) { const v = getPath(item, c.path); r[c.dst] = v === undefined ? null : applyConverter(c.convert, v); }
            out[ch.target].push(r);
          });
        }
      }
    }
  }
  return out;
}

// ── safe live-data handling ────────────────────────────────────────
const SENSITIVE = /(pass(word)?|secret|token|ssn|card|iban|phone|email|address|birth|dob|salary|api.?key)/i;
export function sanitizeValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (v instanceof Date) return v.toISOString();
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) return `<binary ${v.length} bytes>`;
  if (Array.isArray(v)) return v.map(sanitizeValue);
  if (typeof v === "object") {
    if ((v as { _bsontype?: string })._bsontype) return String(v);
    const o: Row = {};
    for (const [k, x] of Object.entries(v as Row)) o[k] = sanitizeValue(x);
    return o;
  }
  return v;
}
/** Masks string values in sensitive-looking, non-key columns. Keys are never masked so relations survive. */
export function maskRows(rows: Row[], keyColumns: Set<string>): Row[] {
  const mask = (obj: Row): Row => {
    const o: Row = {};
    for (const [k, v] of Object.entries(obj)) {
      if (keyColumns.has(k) || k === "_id" || /(_id|Id)$/.test(k)) o[k] = v;
      else if (SENSITIVE.test(k) && typeof v === "string") o[k] = v.length ? `${v[0]}••••` : v;
      else if (v && typeof v === "object" && !Array.isArray(v)) o[k] = mask(v as Row);
      else o[k] = v;
    }
    return o;
  };
  return rows.map(mask);
}
