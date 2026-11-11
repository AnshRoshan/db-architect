import { load as yamlLoad } from "js-yaml";
import { detectSqlDialect } from "./engines";
import {
  SchemaModel,
  EntityModel,
  FieldModel,
  ConstraintModel,
  emptyModel,
  entityId,
  fieldId,
  indexId,
  constraintId,
  relId,
  stableId,
  Engine,
} from "./schema-model";

// ─── YAML/JSON DSL ─────────────────────────────────────────────────
// DSL v1 example:
// engine: postgres
// database: shop
// namespaces: [public]
// entities:
//   - name: public.orders
//     kind: table
//     fields:
//       - { name: id, type: uuid, primaryKey: true }
//       - { name: user_id, type: uuid, nullable: false }
//     indexes:
//       - { name: idx_orders_user, columns: [user_id] }
//     constraints:
//       - { name: orders_pkey, kind: primary_key, columns: [id] }

export interface ParseResult {
  model: SchemaModel;
  warnings: string[];
  detectedEngine: Engine;
}

function asEngine(v: unknown): Engine {
  return v === "mongodb" ? "mongodb" : "postgres";
}

export function parseDsl(input: string, filename = "schema.yaml"): ParseResult {
  const warnings: string[] = [];
  let doc: Record<string, unknown>;
  try {
    if (filename.endsWith(".json") || input.trimStart().startsWith("{")) {
      doc = JSON.parse(input) as Record<string, unknown>;
    } else {
      doc = yamlLoad(input) as Record<string, unknown>;
    }
  } catch (e) {
    throw new Error(`DSL parse error: ${(e as Error).message}`);
  }
  if (!doc || typeof doc !== "object") throw new Error("DSL document must be a mapping");
  // Detect Mongo-style export: { collections: [...] } or { database, collections }
  const engine: Engine = asEngine(
    (doc as Record<string, unknown>).engine ??
      ((doc as Record<string, unknown>).collections ? "mongodb" : "postgres")
  );
  const database = String((doc as Record<string, unknown>).database ?? "imported_db");
  const model = emptyModel(engine, database);
  model.sourceMetadata.source = `dsl:${filename}`;
  const namespaces = (doc as Record<string, unknown>).namespaces as string[] | undefined;
  if (Array.isArray(namespaces)) model.namespaces = namespaces.map(String);

  const maybeMongo = (doc as Record<string, unknown>).collections as unknown[] | undefined;
  if (Array.isArray(maybeMongo) && maybeMongo.some((c) => (c as Record<string, unknown>)?.sample !== undefined || (c as Record<string, unknown>)?.validator !== undefined)) {
    throw new Error("mongo-sample-shape: use Mongo JSON parser");
  }
  const rawEntities =
    ((doc as Record<string, unknown>).entities as unknown[]) ??
    ((doc as Record<string, unknown>).tables as unknown[]) ??
    ((doc as Record<string, unknown>).collections as unknown[]) ??
    [];
  if (!Array.isArray(rawEntities)) throw new Error("DSL entities must be a list");

  for (const raw of rawEntities as Record<string, unknown>[]) {
    const fullName = String(raw.name ?? raw.collection ?? "unnamed");
    const { namespace, short } = splitName(fullName, engine);
    if (!model.namespaces.includes(namespace)) model.namespaces.push(namespace);
    const eid = entityId(engine, namespace, short);
    const kindRaw = String(raw.kind ?? raw.type ?? (engine === "mongodb" ? "collection" : "table"));
    const kind = normalizeKind(kindRaw, engine);
    const entity: EntityModel = {
      id: eid,
      name: fullName,
      shortName: short,
      namespace,
      kind,
      engine,
      fields: [],
      indexes: [],
      constraints: [],
      comment: (raw.comment as string) ?? null,
      metadata: { ...(raw.metadata as object | undefined) },
    };
    // fields / columns / documentShape
    const rawFields =
      (raw.fields as unknown[]) ?? (raw.columns as unknown[]) ?? (raw.documentShape as unknown[]) ?? [];
    for (const rf of rawFields as Record<string, unknown>[]) {
      const fname = String(rf.name ?? rf.field ?? "field");
      entity.fields.push({
        id: fieldId(eid, fname),
        name: fname,
        type: String(rf.type ?? rf.bsonType ?? "text"),
        nullable: rf.nullable !== false && rf.required !== true,
        defaultValue: (rf.default as string | undefined) ?? (rf.defaultValue as string | undefined) ?? null,
        isPrimaryKey: Boolean(rf.primaryKey ?? rf.pk),
        isUnique: Boolean(rf.unique),
        comment: (rf.comment as string) ?? null,
        bsonTypes: Array.isArray(rf.bsonTypes) ? (rf.bsonTypes as string[]) : undefined,
        optional: typeof rf.optional === "boolean" ? (rf.optional as boolean) : undefined,
        presence: typeof rf.presence === "number" ? (rf.presence as number) : undefined,
        isArray: Boolean(rf.isArray),
        arrayOf: (rf.arrayOf as string) ?? null,
        nested: Array.isArray(rf.nested)
          ? (rf.nested as Record<string, unknown>[]).map((n) => ({
              id: fieldId(eid, `${fname}.${String(n.name)}`),
              name: String(n.name),
              type: String(n.type ?? "text"),
              nullable: n.nullable !== false,
              defaultValue: null,
            }))
          : undefined,
      } as FieldModel);
    }
    // indexes
    for (const ri of ((raw.indexes as unknown[]) ?? []) as Record<string, unknown>[]) {
      const keyObj = (ri.key ?? ri.keys) as Record<string, unknown> | undefined;
      const colsGuess = ((ri.columns as string[]) ?? (keyObj && typeof keyObj === "object" ? Object.keys(keyObj) : [])).map(String);
      const iname = String(ri.name ?? `idx_${short}_${colsGuess.join("_")}`);
      entity.indexes.push({
        id: indexId(eid, iname),
        name: iname,
        columns: colsGuess,
        method: (ri.method as string) ?? (ri.type as string) ?? (engine === "mongodb" ? "btree" : "btree"),
        unique: Boolean(ri.unique),
        partial: Boolean(ri.partial),
        predicate: (ri.predicate as string) ?? null,
        expression: Boolean(ri.expression),
        includeColumns: ((ri.include as string[]) ?? []).map(String),
        sortOrders: ((ri.sort as string[]) ?? []).map(String),
        definition: (ri.definition as string) ?? null,
        kind: (ri.kind as string) ?? undefined,
        ttlSeconds: (ri.ttlSeconds as number) ?? null,
      });
    }
    // constraints
    for (const rc of ((raw.constraints as unknown[]) ?? []) as Record<string, unknown>[]) {
      const cname = String(rc.name ?? `${short}_${String(rc.kind)}`);
      entity.constraints.push({
        id: constraintId(eid, cname),
        name: cname,
        kind: normalizeConstraint(String(rc.kind ?? rc.type ?? "check")),
        columns: ((rc.columns as string[]) ?? []).map(String),
        referencedEntity: (rc.references as string) ?? (rc.referencedEntity as string) ?? null,
        referencedColumns: ((rc.referencedColumns as string[]) ?? []).map(String),
        onDelete: (rc.onDelete as string) ?? null,
        onUpdate: (rc.onUpdate as string) ?? null,
        definition: (rc.definition as string) ?? null,
      });
    }
    // inline FK shorthand: foreignKeys: [{ columns, references, ... }]
    for (const rf of ((raw.foreignKeys as unknown[]) ?? []) as Record<string, unknown>[]) {
      const cname = String(rf.name ?? `fk_${short}_${((rf.columns as string[]) ?? []).join("_")}`);
      entity.constraints.push({
        id: constraintId(eid, cname),
        name: cname,
        kind: "foreign_key",
        columns: ((rf.columns as string[]) ?? []).map(String),
        referencedEntity: (rf.references as string) ?? null,
        referencedColumns: ((rf.referencedColumns as string[]) ?? []).map(String),
        onDelete: (rf.onDelete as string) ?? null,
        onUpdate: (rf.onUpdate as string) ?? null,
        definition: null,
      });
    }
    model.entities.push(entity);
  }

  // explicit relationships block
  const rawRels = (doc as Record<string, unknown>).relationships as unknown[] | undefined;
  if (Array.isArray(rawRels)) {
    for (const rr of rawRels as Record<string, unknown>[]) {
      const from = String(rr.from ?? rr.fromEntity ?? "");
      const to = String(rr.to ?? rr.toEntity ?? "");
      if (!from || !to) {
        warnings.push("Skipped relationship with missing from/to");
        continue;
      }
      model.relationships.push({
        id: relId(from, toCols(rr), to, toCols2(rr)),
        name: String(rr.name ?? `${from}→${to}`),
        fromEntity: from,
        fromColumns: toCols(rr),
        toEntity: to,
        toColumns: toCols2(rr),
        cardinality: (rr.cardinality as "one-to-one" | "one-to-many" | "many-to-many") ?? "one-to-many",
        optionality: (rr.optionality as "required" | "optional") ?? "optional",
        provenance: "explicit",
        confidence: 1,
      });
    }
  }

  // derive FK relationships from constraints
  deriveExplicitRelationships(model);
  if (model.entities.length === 0) warnings.push("No entities found in DSL document");
  model.warnings = warnings;
  return { model, warnings, detectedEngine: engine };
}

function toCols(rr: Record<string, unknown>): string[] {
  const c = (rr.fromColumns ?? rr.columns) as string[] | undefined;
  return Array.isArray(c) ? c.map(String) : [];
}
function toCols2(rr: Record<string, unknown>): string[] {
  const c = (rr.toColumns ?? rr.referencedColumns) as string[] | undefined;
  return Array.isArray(c) ? c.map(String) : [];
}

export function splitName(full: string, engine: Engine): { namespace: string; short: string } {
  if (full.includes(".")) {
    const [ns, ...rest] = full.split(".");
    return { namespace: ns, short: rest.join(".") };
  }
  return { namespace: engine === "mongodb" ? "main" : "public", short: full };
}

function normalizeKind(k: string, engine: Engine): EntityModel["kind"] {
  const s = k.toLowerCase();
  if (s.includes("materialized")) return "materialized_view";
  if (s === "view") return "view";
  if (s === "collection") return "collection";
  if (s === "foreign") return "foreign_table";
  return engine === "mongodb" ? "collection" : "table";
}
function normalizeConstraint(k: string): ConstraintModel["kind"] {
  const s = k.toLowerCase().replace(/[\s-]+/g, "_");
  if (s.includes("primary")) return "primary_key";
  if (s.includes("foreign")) return "foreign_key";
  if (s.includes("unique")) return "unique";
  if (s.includes("exclusion")) return "exclusion";
  if (s.includes("validator") || s.includes("jsonschema")) return "validator";
  if (s.includes("not_null")) return "not_null";
  return "check";
}

export function deriveExplicitRelationships(model: SchemaModel) {
  for (const e of model.entities) {
    for (const c of e.constraints) {
      if (c.kind === "foreign_key" && c.referencedEntity) {
        const exists = model.relationships.some(
          (r) => r.fromEntity === e.name && r.toEntity === c.referencedEntity
        );
        if (!exists) {
          model.relationships.push({
            id: relId(e.name, c.columns, c.referencedEntity, c.referencedColumns ?? []),
            name: c.name,
            fromEntity: e.name,
            fromColumns: c.columns,
            toEntity: c.referencedEntity,
            toColumns: c.referencedColumns ?? [],
            cardinality: "one-to-many",
            optionality: e.fields.find((f) => c.columns.includes(f.name))?.nullable ? "optional" : "required",
            provenance: "explicit",
            constraintName: c.name,
            confidence: 1,
          });
        }
      }
    }
  }
  // build dependencies
  model.dependencies = model.relationships.map((r) => ({
    from: r.fromEntity,
    to: r.toEntity,
    kind: "fk",
  }));
}

// ─── SQL DDL parser (PostgreSQL subset, dependency-preserving) ──────
export function parseSqlDdl(sql: string, database = "imported_db", dialectHint?: Engine): ParseResult {
  const warnings: string[] = [];
  const dialect: Engine = dialectHint && dialectHint !== "mongodb" ? dialectHint : detectSqlDialect(sql);
  const model = emptyModel("postgres", database);
  model.sourceMetadata.source = `sql-ddl:${dialect}`;
  let cleaned = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  if (dialect === "mysql") cleaned = cleaned.replace(/`/g, '"');
  if (dialect === "sqlite") cleaned = cleaned.replace(/`/g, '"').replace(/\[([A-Za-z0-9_]+)\]/g, '"$1"');
  const stmts = cleaned.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
  const skipped: Record<string, number> = {};
  let dbName: string | null = null;

  for (const raw of stmts) {
    const stmt = raw.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
    if (!stmt) continue;
    const upper = stmt.toUpperCase();
    if (/^CREATE (TEMP(ORARY)? )?TABLE/.test(upper)) {
      const { clean, options } = splitTableOptions(stmt);
      const before = model.entities.length;
      parseCreateTable(clean.replace(/^CREATE (TEMP(ORARY)? )TABLE/i, "CREATE TABLE"), model, warnings);
      if (model.entities.length > before) {
        const last = model.entities[model.entities.length - 1];
        last.metadata = { ...last.metadata, ...options };
      }
    } else if (upper.startsWith("CREATE UNIQUE INDEX") || upper.startsWith("CREATE INDEX")) {
      parseCreateIndex(stmt, model, warnings);
    } else if (upper.startsWith("ALTER TABLE")) {
      parseAlterTable(stmt, model, warnings);
    } else if (upper.startsWith("CREATE VIEW") || upper.startsWith("CREATE MATERIALIZED VIEW") || upper.startsWith("CREATE OR REPLACE VIEW")) {
      warnings.push(`View preserved as metadata only: ${stmt.slice(0, 80)}`);
    } else {
      const dbm = stmt.match(/^(?:CREATE DATABASE(?: IF NOT EXISTS)?|USE)\s+"?([A-Za-z0-9_]+)"?/i);
      if (dbm) dbName = dbm[1];
      const kind = upper.split(" ").slice(0, 2).join(" ");
      skipped[kind] = (skipped[kind] ?? 0) + 1;
    }
  }
  for (const [kind, n] of Object.entries(skipped)) {
    warnings.push(`Skipped ${n} "${kind}…" statement${n > 1 ? "s" : ""} — data/session/procedural statements are not part of the schema model.`);
  }
  const ns = dialect === "sqlite" ? "main" : dbName ?? (dialect === "mysql" ? "app" : "public");
  if (dialect !== "postgres") retargetNamespace(model, "public", ns, dialect);
  else model.engine = "postgres";
  deriveExplicitRelationships(model);
  if (dialect === "postgres" && !model.namespaces.includes("public")) model.namespaces.unshift("public");
  if (!model.namespaces.length) model.namespaces = [ns];
  model.warnings = warnings;
  return { model, warnings, detectedEngine: dialect };
}

function retargetNamespace(model: SchemaModel, from: string, to: string, engine: Engine) {
  const rename = new Map<string, string>();
  for (const e of model.entities) rename.set(e.name, `${e.namespace === from ? to : e.namespace}.${e.shortName}`);
  for (const e of model.entities) {
    e.namespace = e.namespace === from ? to : e.namespace;
    e.name = rename.get(e.name)!;
    e.engine = engine;
    e.id = entityId(engine, e.namespace, e.shortName);
    for (const f of e.fields) f.id = fieldId(e.id, f.name);
    for (const i of e.indexes) i.id = indexId(e.id, i.name);
    for (const c of e.constraints) {
      c.id = constraintId(e.id, c.name);
      if (c.referencedEntity) c.referencedEntity = rename.get(c.referencedEntity) ?? (c.referencedEntity.startsWith(`${from}.`) ? `${to}.${c.referencedEntity.slice(from.length + 1)}` : c.referencedEntity);
    }
  }
  model.engine = engine;
  model.namespaces = [...new Set(model.entities.map((e) => e.namespace))];
}

function splitTableOptions(stmt: string): { clean: string; options: Record<string, unknown> } {
  const m = stmt.match(/\)\s*((?:(?:ENGINE|AUTO_INCREMENT|DEFAULT CHARSET|DEFAULT CHARACTER SET|CHARSET|CHARACTER SET|DEFAULT COLLATE|COLLATE|COMMENT|ROW_FORMAT|WITHOUT ROWID|STRICT)\b\s*=?\s*(?:'[^']*'|[\w.]+)?\s*,?\s*)+)$/i);
  if (!m) return { clean: stmt, options: {} };
  const opt = m[1];
  const options: Record<string, unknown> = {};
  const eng = opt.match(/ENGINE\s*=?\s*(\w+)/i);
  if (eng) options.storageEngine = eng[1];
  const cs = opt.match(/(?:CHARSET|CHARACTER SET)\s*=?\s*(\w+)/i);
  if (cs) options.charset = cs[1].toLowerCase();
  const co = opt.match(/COLLATE\s*=?\s*(\w+)/i);
  if (co) options.collation = co[1];
  if (/WITHOUT ROWID/i.test(opt)) options.withoutRowid = true;
  return { clean: stmt.slice(0, stmt.length - opt.length), options };
}

function parseCreateTable(stmt: string, model: SchemaModel, warnings: string[]) {
  const m = stmt.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-zA-Z0-9_".]+)\s*\(([\s\S]*)\)\s*$/i);
  if (!m) {
    warnings.push("Could not parse CREATE TABLE statement");
    return;
  }
  const fullName = m[1].replace(/"/g, "");
  const body = m[2];
  const { namespace, short } = splitName(fullName.includes(".") ? fullName : `public.${fullName}`, "postgres");
  if (!model.namespaces.includes(namespace)) model.namespaces.push(namespace);
  const eid = entityId("postgres", namespace, short);
  const entity: EntityModel = {
    id: eid,
    name: fullName.includes(".") ? fullName : `public.${fullName}`,
    shortName: short,
    namespace,
    kind: "table",
    engine: "postgres",
    fields: [],
    indexes: [],
    constraints: [],
    metadata: {},
  };
  const parts = splitTopLevel(body);
  for (const p of parts) {
    const t = p.trim();
    const up = t.toUpperCase();
    if (/^(PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK|CONSTRAINT|EXCLUDE|KEY\b|INDEX\b|FULLTEXT|SPATIAL)/.test(up)) {
      parseTableConstraint(t, entity, warnings);
    } else if (t) {
      parseColumnDef(t, entity, warnings);
    }
  }
  model.entities.push(entity);
}

function parseColumnDef(def: string, entity: EntityModel, warnings: string[]) {
  const m = def.match(/^"?([a-zA-Z0-9_]+)"?\s+([\s\S]*)$/i);
  if (!m) {
    warnings.push(`Skipped unparsable column: ${def.slice(0, 60)}`);
    return;
  }
  const name = m[1];
  const rest = m[2];
  const typeMatch = rest.match(
    /^((?:double\s+precision|character\s+varying|timestamp(?:\s+with(?:out)?\s+time\s+zone)?|time(?:\s+with(?:out)?\s+time\s+zone)?|serial|bigserial|smallserial|varchar|char|text|int(?:eger)?|bigint|smallint|numeric|decimal|real|float|double|boolean|bool|uuid|jsonb?|bytea|date|timestamptz|inet|cidr|interval|money|oid|name)(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?(?:\s*\[\])?)/i
  );
  const firstWord = (rest.match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0] ?? "").toLowerCase();
  let type: string;
  if (typeMatch && typeMatch[1].trim().toLowerCase().startsWith(firstWord)) type = typeMatch[1].trim().toLowerCase();
  else {
    const g = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)(\s*\((?:[^()]|\([^)]*\))*\))?/);
    type = g ? `${g[1].toLowerCase()}${(g[2] ?? "").replace(/\s+/g, "")}` : rest.split(/\s+/)[0].toLowerCase();
  }
  if (/\bunsigned\b/i.test(rest.slice(0, 48)) && !type.includes("unsigned")) type += " unsigned";
  const up = rest.toUpperCase();
  const nullable = !/\bNOT NULL\b/.test(up) && !/\bPRIMARY KEY\b/.test(up);
  const defMatch = rest.match(/DEFAULT\s+('(?:[^']|'')*'|\((?:[^()]|\([^()]*\))*\)|[^\s,()]+(?:\([^)]*\))?)/i);
  entity.fields.push({
    id: fieldId(entity.id, name),
    name,
    type,
    nullable,
    defaultValue: defMatch ? defMatch[1].trim() : null,
    isPrimaryKey: /\bPRIMARY KEY\b/.test(up),
    isUnique: /\bUNIQUE\b/.test(up) && !/\bPRIMARY KEY\b/.test(up),
    generated: /GENERATED/.test(up) ? rest.slice(0, 120) : null,
    identity: /IDENTITY|AUTO_INCREMENT|AUTOINCREMENT/.test(up) ? "identity" : null,
    comment: rest.match(/COMMENT\s+'((?:[^']|'')*)'/i)?.[1] ?? null,
  });
  if (/\bPRIMARY KEY\b/.test(up)) {
    entity.constraints.push({
      id: constraintId(entity.id, `${entity.shortName}_pkey_inline_${name}`),
      name: `${entity.shortName}_pkey`,
      kind: "primary_key",
      columns: [name],
    });
  }
  const fkM = rest.match(/REFERENCES\s+([a-zA-Z0-9_."]+)\s*(?:\(\s*"?([a-zA-Z0-9_]+)"?\s*\))?/i);
  if (fkM) {
    const ref = fkM[1].replace(/"/g, "");
    entity.constraints.push({
      id: constraintId(entity.id, `fk_${entity.shortName}_${name}`),
      name: `fk_${entity.shortName}_${name}`,
      kind: "foreign_key",
      columns: [name],
      referencedEntity: ref.includes(".") ? ref : `public.${ref}`,
      referencedColumns: fkM[2] ? [fkM[2]] : ["id"],
    });
  }
}

function parseTableConstraint(def: string, entity: EntityModel, warnings: string[]) {
  let m: RegExpMatchArray | null;
  if ((m = def.match(/^(UNIQUE\s+|FULLTEXT\s+|SPATIAL\s+)?(?:KEY|INDEX)\s+"?([A-Za-z0-9_]+)"?\s*(?:USING\s+\w+\s*)?\(([\s\S]*)\)\s*(?:USING\s+\w+)?\s*$/i))) {
    const kind = (m[1] ?? "").trim().toUpperCase();
    const cols = m[3].split(",").map((s) => s.replace(/"/g, "").replace(/\(\d+\)/g, "").trim().split(/\s+/)[0]);
    entity.indexes.push({ id: indexId(entity.id, m[2]), name: m[2], columns: cols, method: kind === "FULLTEXT" ? "fulltext" : kind === "SPATIAL" ? "spatial" : "btree", unique: kind === "UNIQUE", definition: def });
    if (kind === "UNIQUE") entity.constraints.push({ id: constraintId(entity.id, m[2]), name: m[2], kind: "unique", columns: cols });
    return;
  }
  if ((m = def.match(/CONSTRAINT\s+"?([a-zA-Z0-9_]+)"?\s+([\s\S]*)/i))) {
    parseTableConstraint(`${m[2]}`, entity, warnings);
    const last = entity.constraints[entity.constraints.length - 1];
    if (last) last.name = m[1];
    return;
  }
  if ((m = def.match(/PRIMARY KEY\s*\(([^)]+)\)/i))) {
    const cols = m[1].split(",").map((s) => s.replace(/"/g, "").trim());
    entity.constraints.push({
      id: constraintId(entity.id, `${entity.shortName}_pkey`),
      name: `${entity.shortName}_pkey`,
      kind: "primary_key",
      columns: cols,
    });
    for (const c of cols) {
      const f = entity.fields.find((x) => x.name === c);
      if (f) {
        f.isPrimaryKey = true;
        f.nullable = false;
      }
    }
    return;
  }
  if ((m = def.match(/FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+([a-zA-Z0-9_."]+)\s*(?:\(\s*([^)]+)\s*\))?(.*)/i))) {
    const cols = m[1].split(",").map((s) => s.replace(/"/g, "").trim());
    const ref = m[2].replace(/"/g, "");
    const refCols = m[3] ? m[3].split(",").map((s) => s.replace(/"/g, "").trim()) : ["id"];
    const tail = (m[4] ?? "").toUpperCase();
    const onDelete = tail.match(/ON DELETE\s+(CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION)/)?.[1] ?? null;
    entity.constraints.push({
      id: constraintId(entity.id, `fk_${entity.shortName}_${cols.join("_")}`),
      name: `fk_${entity.shortName}_${cols.join("_")}`,
      kind: "foreign_key",
      columns: cols,
      referencedEntity: ref.includes(".") ? ref : `public.${ref}`,
      referencedColumns: refCols,
      onDelete,
    });
    return;
  }
  if ((m = def.match(/UNIQUE\s*\(([^)]+)\)/i))) {
    const cols = m[1].split(",").map((s) => s.replace(/"/g, "").trim());
    entity.constraints.push({
      id: constraintId(entity.id, `uq_${entity.shortName}_${cols.join("_")}`),
      name: `uq_${entity.shortName}_${cols.join("_")}`,
      kind: "unique",
      columns: cols,
    });
    return;
  }
  if ((m = def.match(/CHECK\s*\(([\s\S]+)\)/i))) {
    entity.constraints.push({
      id: constraintId(entity.id, `chk_${entity.shortName}_${entity.constraints.length}`),
      name: `chk_${entity.shortName}_${entity.constraints.length}`,
      kind: "check",
      columns: [],
      definition: m[1].trim(),
    });
    return;
  }
  warnings.push(`Unsupported table constraint preserved as warning: ${def.slice(0, 80)}`);
}

function parseCreateIndex(stmt: string, model: SchemaModel, warnings: string[]) {
  const m = stmt.match(
    /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?(?:CONCURRENTLY\s+)?"?([a-zA-Z0-9_]+)"?\s+ON\s+([a-zA-Z0-9_."]+)\s*(?:USING\s+([a-zA-Z0-9_]+))?\s*\(([^)]+)\)\s*(WHERE\s+.+)?/i
  );
  if (!m) {
    warnings.push("Could not parse CREATE INDEX statement");
    return;
  }
  const unique = Boolean(m[1]);
  const iname = m[2];
  const table = m[3].replace(/"/g, "");
  const method = (m[4] ?? "btree").toLowerCase();
  const cols = m[5].split(",").map((s) => s.replace(/"/g, "").trim().split(/\s+/)[0]);
  const predicate = m[6]?.trim() ?? null;
  const full = table.includes(".") ? table : `public.${table}`;
  let ent = model.entities.find((e) => e.name === full);
  if (!ent) {
    warnings.push(`Index ${iname} references unknown table ${full}; placeholder entity created`);
    const { namespace, short } = splitName(full, "postgres");
    ent = {
      id: entityId("postgres", namespace, short),
      name: full,
      shortName: short,
      namespace,
      kind: "table",
      engine: "postgres",
      fields: [],
      indexes: [],
      constraints: [],
      metadata: { placeholder: true },
    };
    model.entities.push(ent);
  }
  ent.indexes.push({
    id: indexId(ent.id, iname),
    name: iname,
    columns: cols,
    method,
    unique,
    partial: Boolean(predicate),
    predicate,
    expression: /\(.*\(/.test(m[5]) || /lower\(|upper\(|coalesce\(/i.test(m[5]),
    definition: stmt,
  });
}

function parseAlterTable(stmt: string, model: SchemaModel, warnings: string[]) {
  const m = stmt.match(/ALTER TABLE\s+(?:IF EXISTS\s+)?([a-zA-Z0-9_."]+)\s+([\s\S]*)$/i);
  if (!m) {
    warnings.push("Could not parse ALTER TABLE");
    return;
  }
  const table = m[1].replace(/"/g, "");
  const action = m[2].trim();
  const full = table.includes(".") ? table : `public.${table}`;
  const ent = model.entities.find((e) => e.name === full);
  if (!ent) {
    warnings.push(`ALTER TABLE on unknown table ${full}`);
    return;
  }
  let am: RegExpMatchArray | null;
  if ((am = action.match(/ADD\s+(?:COLUMN\s+)?"?([a-zA-Z0-9_]+)"?\s+(.*)/i))) {
    entityPushColumn(ent, am[1], am[2]);
  } else if ((am = action.match(/ADD\s+(CONSTRAINT\s+.*|PRIMARY KEY.*|FOREIGN KEY.*|UNIQUE.*|CHECK.*)/i))) {
    parseTableConstraint(am[1], ent, warnings);
  } else {
    warnings.push(`ALTER TABLE action preserved as warning: ${action.slice(0, 80)}`);
  }
}

function entityPushColumn(ent: EntityModel, name: string, rest: string) {
  const up = rest.toUpperCase();
  ent.fields.push({
    id: fieldId(ent.id, name),
    name,
    type: rest.split(/\s+/)[0].toLowerCase(),
    nullable: !/\bNOT NULL\b/.test(up),
    defaultValue: rest.match(/DEFAULT\s+('(?:[^']|'')*'|\((?:[^()]|\([^()]*\))*\)|[^\s,()]+(?:\([^)]*\))?)/i)?.[1]?.trim() ?? null,
  });
}

function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "'" && body[i - 1] !== "\\") inStr = !inStr;
    if (!inStr) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        out.push(cur);
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ─── Mongo JSON-schema / sample import ─────────────────────────────
export function parseMongoJson(input: string, database = "mongo_db", sampleSize?: number): ParseResult {
  const warnings: string[] = [];
  let doc: unknown;
  try {
    doc = JSON.parse(input);
  } catch {
    // try YAML
    doc = yamlLoad(input);
  }
  const model = emptyModel("mongodb", database);
  model.sourceMetadata.source = "mongo-json";
  const docs: Record<string, unknown>[] = Array.isArray(doc)
    ? (doc as Record<string, unknown>[])
    : (doc as Record<string, unknown>).collections
      ? ((doc as Record<string, unknown>).collections as Record<string, unknown>[])
      : [(doc as Record<string, unknown>)];

  // Heuristic: if array of plain docs with no `name`, treat as single collection sample
  if (Array.isArray(doc) && doc.length > 0 && !(doc[0] as Record<string, unknown>).name) {
    const shape = inferShape(doc as Record<string, unknown>[], "documents", sampleSize ?? doc.length);
    const eid = entityId("mongodb", "main", "documents");
    model.namespaces = ["main"];
    model.entities.push({
      id: eid,
      name: "documents",
      shortName: "documents",
      namespace: "main",
      kind: "collection",
      engine: "mongodb",
      fields: shape,
      indexes: [{ id: indexId(eid, "_id_"), name: "_id_", columns: ["_id"], unique: true, method: "btree" }],
      constraints: [],
      metadata: { observed: true },
    });
    model.sourceMetadata.sampleSize = doc.length;
    model.sourceMetadata.limitations.push(
      `Observed schema from ${doc.length} sampled documents; inferred references are NOT constraints.`
    );
  } else {
    for (const c of docs) {
      const rec = c as Record<string, unknown>;
      const cname = String(rec.name ?? rec.collection ?? "collection");
      const eid = entityId("mongodb", "main", cname);
      if (!model.namespaces.includes("main")) model.namespaces.push("main");
      const fields: FieldModel[] = [];
      const shape = (rec.documentShape ?? rec.fields ?? rec.schema) as unknown;
      if (Array.isArray(shape)) {
        for (const f of shape as Record<string, unknown>[]) {
          fields.push({
            id: fieldId(eid, String(f.name)),
            name: String(f.name),
            type: String(f.type ?? f.bsonType ?? "string"),
            nullable: true,
            defaultValue: null,
            bsonTypes: Array.isArray(f.bsonTypes) ? (f.bsonTypes as string[]) : [String(f.type ?? "string")],
          });
        }
      } else if (Array.isArray(rec.sample)) {
        const inferred = inferShape(rec.sample as Record<string, unknown>[], cname, (rec.sample as unknown[]).length);
        fields.push(...inferred);
        model.sourceMetadata.sampleSize = (model.sourceMetadata.sampleSize ?? 0) + (rec.sample as unknown[]).length;
      }
      const indexes: EntityModel["indexes"] = [];
      for (const ri of ((rec.indexes as unknown[]) ?? []) as Record<string, unknown>[]) {
        const cols = ri.key ? Object.keys(ri.key as object) : ((ri.columns as string[]) ?? ["_id"]);
        indexes.push({
          id: indexId(eid, String(ri.name ?? cols.join("_"))),
          name: String(ri.name ?? cols.join("_")),
          columns: cols.map(String),
          unique: Boolean(ri.unique),
          method: "btree",
          definition: JSON.stringify(ri),
        });
      }
      model.entities.push({
        id: eid,
        name: cname,
        shortName: cname,
        namespace: "main",
        kind: "collection",
        engine: "mongodb",
        fields,
        indexes,
        constraints: [],
        metadata: { validator: rec.validator ?? null },
      });
    }
    if (docs.length > 0 && model.sourceMetadata.sampleSize) {
      model.sourceMetadata.limitations.push("Inferred references from sampled documents are NOT guaranteed constraints.");
    }
  }
  inferMongoReferences(model);
  model.warnings = warnings;
  return { model, warnings, detectedEngine: "mongodb" };
}

export function inferShape(docs: Record<string, unknown>[], _cname: string, sampleSize: number): FieldModel[] {
  const stats = new Map<string, { types: Set<string>; present: number; nested: Record<string, unknown>[]; arrayNested: Record<string, unknown>[]; isArray: boolean; arrayOf: Set<string> }>();
  for (const d of docs) {
    for (const [k, v] of Object.entries(d)) {
      if (!stats.has(k)) stats.set(k, { types: new Set(), present: 0, nested: [], arrayNested: [], isArray: false, arrayOf: new Set() });
      const s = stats.get(k)!;
      s.present++;
      const t = bsonType(v);
      s.types.add(t);
      if (t === "object" && v && typeof v === "object" && !Array.isArray(v)) s.nested.push(v as Record<string, unknown>);
      if (Array.isArray(v)) {
        s.isArray = true;
        for (const el of v.slice(0, 50)) {
          const et = bsonType(el);
          s.arrayOf.add(et);
          if (et === "object") s.arrayNested.push(el as Record<string, unknown>);
        }
      }
    }
  }
  const out: FieldModel[] = [];
  for (const [k, s] of stats) {
    const presence = s.present / Math.max(1, sampleSize);
    let nested: FieldModel[] | undefined;
    if (s.nested.length > 0) nested = inferShape(s.nested.slice(0, 20), k, s.nested.length);
    else if (s.arrayNested.length > 0) nested = inferShape(s.arrayNested.slice(0, 50), k, s.arrayNested.length);
    out.push({
      id: stableId("mongo-field", k),
      name: k,
      type: [...s.types].join(" | ") || "mixed",
      nullable: presence < 1,
      defaultValue: null,
      bsonTypes: [...s.types],
      optional: presence < 1,
      presence: Math.round(presence * 100) / 100,
      nested,
      isArray: s.isArray,
      arrayOf: s.isArray ? [...s.arrayOf].join(" | ") : null,
    });
  }
  return out;
}

function bsonType(v: unknown): string {
  if (v === null || v === undefined) return "null";
  const bt = (v as { _bsontype?: string })._bsontype;
  if (bt) return ({ ObjectId: "objectId", ObjectID: "objectId", Decimal128: "decimal", Binary: "binData", Long: "long", Int32: "int", Double: "double" } as Record<string, string>)[bt] ?? "object";
  if (Array.isArray(v)) return "array";
  if (v instanceof Date) return "date";
  switch (typeof v) {
    case "string": return "string";
    case "number": return Number.isInteger(v) ? "int" : "double";
    case "boolean": return "bool";
    case "bigint": return "long";
    case "object": return "object";
    default: return "mixed";
  }
}

const USER_SYNONYMS = new Set(["author", "creator", "owner", "assignee", "member", "customer", "user"]);

export function inferMongoReferences(model: SchemaModel) {
  const singular = (s: string) => s.toLowerCase().replace(/s$/, "");
  for (const e of model.entities) {
    for (const f of e.fields) {
      const fl = f.name.toLowerCase();
      if (!fl.endsWith("id") && !fl.endsWith("_id") && !fl.endsWith("ids")) continue;
      const base = fl.replace(/_?ids?$/, "");
      if (!base) continue;
      // match collection by base name (direct or singular)
      let target = model.entities.find(
        (t) => t.name !== e.name && (t.shortName.toLowerCase() === base || singular(t.shortName) === singular(base) || base === singular(t.shortName))
      );
      let confidence = 0.55;
      if (!target && USER_SYNONYMS.has(base)) {
        // role-style FK (authorId → users): common convention, kept low-confidence + inferred
        target = model.entities.find(
          (t) => t.name !== e.name && ["users", "customers", "members"].includes(t.shortName.toLowerCase())
        );
        confidence = 0.42;
      }
      if (target) {
        const dup = model.relationships.some((r) => r.fromEntity === e.name && r.toEntity === target!.name && r.fromColumns[0] === f.name);
        if (dup) continue;
        model.relationships.push({
          id: relId(e.name, [f.name], target.name, ["_id"]),
          name: `${e.shortName}.${f.name} → ${target.shortName}._id`,
          fromEntity: e.name,
          fromColumns: [f.name],
          toEntity: target.name,
          toColumns: ["_id"],
          cardinality: "one-to-many",
          optionality: f.nullable || f.optional ? "optional" : "required",
          provenance: "inferred_sample",
          confidence,
        });
      }
    }
  }
  model.dependencies = model.relationships.map((r) => ({ from: r.fromEntity, to: r.toEntity, kind: "inferred" }));
}

// ─── Validator ─────────────────────────────────────────────────────
export function validateModel(model: SchemaModel): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const entityNames = new Set<string>();
  for (const e of model.entities) {
    if (entityNames.has(e.name)) errors.push(`Duplicate entity: ${e.name}`);
    entityNames.add(e.name);
    if (e.fields.length === 0) warnings.push(`${e.name}: no fields defined`);
    const fnames = new Set<string>();
    for (const f of e.fields) {
      if (fnames.has(f.name)) errors.push(`${e.name}: duplicate field ${f.name}`);
      fnames.add(f.name);
    }
    for (const idx of e.indexes) {
      for (const c of idx.columns) {
        if (c.includes("(") || c.includes(" ")) continue; // expression
        if (!fnames.has(c)) warnings.push(`${e.name}: index ${idx.name} references unknown column ${c}`);
      }
    }
    for (const c of e.constraints) {
      if (c.kind === "foreign_key" && c.referencedEntity && !entityNames.has(c.referencedEntity)) {
        // check later after all entities known — downgrade to warning (target may be outside selection)
        warnings.push(`${e.name}: FK ${c.name} references unknown entity ${c.referencedEntity}`);
      }
    }
  }
  return { errors, warnings };
}

export function serializeModel(model: SchemaModel): string {
  return JSON.stringify(model, null, 2);
}
