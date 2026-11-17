import { createHash } from "crypto";
import { SchemaModel, EntityModel, IndexModel, ConstraintModel } from "./schema-model";
import { generateSqlMigration, createIndexes, createTable, qcol } from "./sql-dialects";

export interface DiffChange {
  kind:
    | "add_entity"
    | "drop_entity"
    | "add_field"
    | "drop_field"
    | "alter_field"
    | "add_index"
    | "drop_index"
    | "add_constraint"
    | "drop_constraint"
    | "rename_candidate";
  entity: string;
  detail: string;
  from?: unknown;
  to?: unknown;
  destructive: boolean;
  risk: "low" | "medium" | "high";
  riskReason: string;
}

export interface SchemaDiff {
  sourceLabel: string;
  targetLabel: string;
  changes: DiffChange[];
  added: number;
  removed: number;
  modified: number;
  renames: DiffChange[];
}

export function diffModels(source: SchemaModel, target: SchemaModel): SchemaDiff {
  const changes: DiffChange[] = [];
  const renames: DiffChange[] = [];
  const sMap = new Map(source.entities.map((e) => [e.name, e]));
  const tMap = new Map(target.entities.map((e) => [e.name, e]));

  // removed entities
  for (const s of source.entities) {
    if (!tMap.has(s.name)) {
      // rename candidate: similar field signature
      const cand = target.entities.find(
        (t) => !sMap.has(t.name) && similarity(s, t) > 0.6
      );
      if (cand) {
        renames.push({
          kind: "rename_candidate",
          entity: s.name,
          detail: `${s.name} → ${cand.name} (?) — similar shape, confirm manually`,
          from: s.name,
          to: cand.name,
          destructive: false,
          risk: "medium",
          riskReason: "Uncertain rename vs drop+create; confirm before migrating.",
        });
      } else {
        changes.push({
          kind: "drop_entity",
          entity: s.name,
          detail: `DROP ${s.kind === "collection" ? "COLLECTION" : "TABLE"} ${s.name}`,
          destructive: true,
          risk: "high",
          riskReason: "Dropping an entity destroys all its data.",
        });
      }
    }
  }
  // added + modified
  for (const t of target.entities) {
    const s = sMap.get(t.name);
    if (!s) {
      if (renames.some((r) => r.to === t.name)) continue; // covered by rename candidate
      changes.push({
        kind: "add_entity",
        entity: t.name,
        detail: `CREATE ${t.kind === "collection" ? "COLLECTION" : "TABLE"} ${t.name} (${t.fields.length} fields)`,
        destructive: false,
        risk: "low",
        riskReason: " additive.",
      });
      continue;
    }
    // fields
    const sf = new Map(s.fields.map((f) => [f.name, f]));
    const tf = new Map(t.fields.map((f) => [f.name, f]));
    const droppedFields = s.fields.filter((f) => !tf.has(f.name));
    const addedFields = t.fields.filter((f) => !sf.has(f.name));
    // Column rename candidates: dropped + added column in the same table with matching canonical type
    if (droppedFields.length && addedFields.length) {
      const matchedAdded = new Set<string>();
      for (const df of droppedFields) {
        const cand = addedFields.find((af) => !matchedAdded.has(af.name) && canonicalType(df.type) === canonicalType(af.type));
        if (cand) {
          matchedAdded.add(cand.name);
          renames.push({
            kind: "rename_candidate",
            entity: t.name,
            detail: `${t.name}.${df.name} → ${cand.name} (?) — same type (${df.type}), confirm RENAME COLUMN vs DROP+ADD`,
            from: df.name,
            to: cand.name,
            destructive: false,
            risk: "medium",
            riskReason: "Confirm whether this is a column rename to avoid data loss.",
          });
        }
      }
    }
    for (const f of droppedFields) {
      changes.push({
        kind: "drop_field",
        entity: t.name,
        detail: `DROP COLUMN ${t.name}.${f.name}`,
        from: f,
        destructive: true,
        risk: "high",
        riskReason: "Dropping a column deletes its data; verify no app reads it.",
      });
    }
    for (const f of t.fields) {
      const old = sf.get(f.name);
      if (!old) {
        const needsBackfill = !f.nullable && !f.defaultValue;
        changes.push({
          kind: "add_field",
          entity: t.name,
          detail: `ADD COLUMN ${t.name}.${f.name} ${f.type}${f.nullable ? "" : " NOT NULL"}`,
          to: f,
          destructive: false,
          risk: needsBackfill ? "high" : "low",
          riskReason: needsBackfill
            ? "NOT NULL without default on a populated table requires backfill/lock."
            : "Nullable/additive change.",
        });
      } else if (
        canonicalType(old.type) !== canonicalType(f.type) ||
        old.nullable !== f.nullable ||
        normDefault(old.defaultValue) !== normDefault(f.defaultValue)
      ) {
        changes.push({
          kind: "alter_field",
          entity: t.name,
          detail: `ALTER ${t.name}.${f.name}: ${old.type}${old.nullable ? "" : " NOT NULL"} → ${f.type}${f.nullable ? "" : " NOT NULL"}`,
          from: old,
          to: f,
          destructive: !f.nullable && old.nullable ? true : false,
          risk: canonicalType(old.type) !== canonicalType(f.type) ? typeRisk(old.type, f.type) : !f.nullable && old.nullable ? "medium" : "low",
          riskReason: "Type/nullability change may rewrite the table and fail on existing values.",
        });
      }
    }
    // indexes (add, drop, and modified definition)
    const si = new Map(s.indexes.map((i) => [i.name, i]));
    const ti = new Map(t.indexes.map((i) => [i.name, i]));
    for (const [n, oldIx] of si) {
      const newIx = ti.get(n);
      if (!newIx) {
        changes.push({ kind: "drop_index", entity: t.name, detail: `DROP INDEX ${n}`, from: oldIx, destructive: false, risk: "medium", riskReason: "Dropping an index can regress dependent queries; verify workload." });
      } else if (indexSignature(oldIx) !== indexSignature(newIx)) {
        changes.push({ kind: "drop_index", entity: t.name, detail: `DROP INDEX ${n}`, from: oldIx, destructive: false, risk: "medium", riskReason: "Index definition changed; drop and recreate concurrently." });
        changes.push({ kind: "add_index", entity: t.name, detail: `CREATE ${newIx.unique ? "UNIQUE " : ""}INDEX ${n} ON ${t.name} (${newIx.columns.join(", ")})`, to: newIx, destructive: false, risk: "medium", riskReason: "Recreating modified index (use CONCURRENTLY on large tables)." });
      }
    }
    for (const [n, ix] of ti) {
      if (!si.has(n))
        changes.push({ kind: "add_index", entity: t.name, detail: `CREATE ${ix.unique ? "UNIQUE " : ""}INDEX ${n} ON ${t.name} (${ix.columns.join(", ")})`, to: ix, destructive: false, risk: "medium", riskReason: "CREATE INDEX locks writes (use CONCURRENTLY on large tables)." });
    }
    // constraints (add, drop, and modified definition)
    const sc = new Map(s.constraints.map((c) => [c.name, c]));
    const tc = new Map(t.constraints.map((c) => [c.name, c]));
    for (const [n, oldCon] of sc) {
      const newCon = tc.get(n);
      if (!newCon) {
        changes.push({ kind: "drop_constraint", entity: t.name, detail: `DROP CONSTRAINT ${t.name}.${n}`, from: oldCon, destructive: oldCon.kind === "primary_key" || oldCon.kind === "foreign_key", risk: "medium", riskReason: "Removing integrity rules can admit bad data." });
      } else if (constraintSignature(oldCon) !== constraintSignature(newCon)) {
        changes.push({ kind: "drop_constraint", entity: t.name, detail: `DROP CONSTRAINT ${t.name}.${n}`, from: oldCon, destructive: false, risk: "medium", riskReason: "Constraint definition changed; replace cleanly." });
        changes.push({ kind: "add_constraint", entity: t.name, detail: `ADD CONSTRAINT ${n} (${newCon.kind})`, to: newCon, destructive: false, risk: newCon.kind === "foreign_key" ? "medium" : "low", riskReason: "Replacing modified constraint." });
      }
    }
    for (const [n, c] of tc) {
      if (!sc.has(n))
        changes.push({ kind: "add_constraint", entity: t.name, detail: `ADD CONSTRAINT ${n} (${c.kind})`, to: c, destructive: false, risk: c.kind === "foreign_key" ? "medium" : "low", riskReason: c.kind === "foreign_key" ? "FK validation scans the table; use NOT VALID + VALIDATE on large tables." : "Additive." });
    }
  }
  const added = changes.filter((c) => c.kind.startsWith("add")).length;
  const removed = changes.filter((c) => c.kind.startsWith("drop")).length;
  const modified = changes.filter((c) => c.kind === "alter_field").length;
  return { sourceLabel: source.database, targetLabel: target.database, changes, added, removed, modified, renames };
}

function similarity(a: EntityModel, b: EntityModel): number {
  const af = new Set(a.fields.map((f) => f.name));
  const bf = new Set(b.fields.map((f) => f.name));
  const inter = [...af].filter((x) => bf.has(x)).length;
  const union = new Set([...af, ...bf]).size;
  return union === 0 ? 0 : inter / union;
}

function canonicalType(raw: string): string {
  const s = raw.toLowerCase().replace(/\s+/g, " ").trim();
  const aliases: Record<string, string> = {
    int: "integer", int4: "integer", serial: "integer", serial4: "integer",
    int8: "bigint", bigserial: "bigint", serial8: "bigint",
    int2: "smallint", smallserial: "smallint",
    bool: "boolean",
    float8: "double precision", float4: "real",
    "timestamp with time zone": "timestamptz",
    "timestamp without time zone": "timestamp",
    decimal: "numeric",
  };
  if (aliases[s]) return aliases[s];
  const charVar = s.match(/^character varying\s*(\([^)]+\))?$/);
  if (charVar) return `varchar${charVar[1] ?? ""}`;
  const numDec = s.match(/^decimal\s*(\([^)]+\))$/);
  if (numDec) return `numeric${numDec[1]}`;
  return s;
}

function normDefault(d: string | null | undefined): string | null {
  if (d == null || d.trim() === "") return null;
  return d.trim().replace(/::[a-z_ ]+(\([^)]*\))?(\[\])?$/i, "").replace(/\s+/g, " ").toLowerCase();
}

function indexSignature(ix: IndexModel): string {
  return `${(ix.method ?? "btree").toLowerCase()}|${ix.unique ? "u" : "n"}|${ix.columns.join(",")}|${(ix.includeColumns ?? []).join(",")}|${(ix.predicate ?? "").trim().toLowerCase()}`;
}

function constraintSignature(c: ConstraintModel): string {
  return `${c.kind}|${c.columns.join(",")}|${c.referencedEntity ?? ""}|${(c.referencedColumns ?? []).join(",")}|${(c.onDelete ?? "").toUpperCase()}|${(c.onUpdate ?? "").toUpperCase()}|${(c.definition ?? "").trim()}`;
}

function typeRisk(from: string, to: string): "low" | "medium" | "high" {
  const f = canonicalType(from);
  const t = canonicalType(to);
  if (f === t) return "low";
  if ((f.includes("varchar") || f === "text") && (t.includes("varchar") || t === "text")) return "low";
  if (f === "integer" && t === "bigint") return "medium";
  if (t.includes("json")) return "medium";
  return "high";
}

// ─── PostgreSQL migration generation (dependency-ordered) ──────────
export function generatePostgresMigration(diff: SchemaDiff, source: SchemaModel, target: SchemaModel): { up: string; down: string; risks: string[] } {
  const up: string[] = [
    `-- DB Architect migration (postgres)`,
    `-- Generated: ${new Date().toISOString()}`,
    `-- Source: ${diff.sourceLabel} → Target: ${diff.targetLabel}`,
    `-- REVIEW REQUIRED. Destructive data changes remain commented out.`,
    `BEGIN;`,
    ``,
  ];
  const down: string[] = [`-- DB Architect rollback (best-effort; irreversible steps marked)`, `BEGIN;`, ``];
  const onlineUp: string[] = [];
  const onlineDown: string[] = [];
  const risks: string[] = [];
  const tMap = new Map(target.entities.map((e) => [e.name, e]));
  const sMap = new Map(source.entities.map((e) => [e.name, e]));

  // 0. Ensure any newly introduced schemas exist before creating tables inside them.
  const sourceSchemas = new Set(source.namespaces);
  const newSchemas = [...new Set(target.namespaces.filter((ns) => ns && ns !== "public" && !sourceSchemas.has(ns)))];
  for (const ns of newSchemas) {
    up.push(`CREATE SCHEMA IF NOT EXISTS ${q(ns)};`);
  }
  if (newSchemas.length) up.push("");

  // 1. New tables, referenced entities first.
  const newTables = diff.changes.filter((c) => c.kind === "add_entity");
  for (const name of topoOrder(newTables.map((c) => c.entity), target)) {
    const entity = tMap.get(name)!;
    if (entity.kind !== "table") continue;
    up.push(`-- + table ${name}`, createTable(entity, "postgres", target), ...createIndexes(entity, "postgres"));
    down.splice(3, 0, `DROP TABLE IF EXISTS ${q(name)};`);
  }
  // 2. New columns.
  for (const c of diff.changes.filter((x) => x.kind === "add_field")) {
    const f = c.to as { name: string; type: string; nullable: boolean; defaultValue?: string | null };
    const colSql = `${q(f.name)} ${f.type}${f.nullable ? "" : " NOT NULL"}${f.defaultValue ? ` DEFAULT ${f.defaultValue}` : ""}`;
    if (!f.nullable && !f.defaultValue) {
      up.push(`-- HIGH RISK: backfill ${c.entity}.${f.name} before applying on populated tables`);
      risks.push(`ADD NOT NULL column ${c.entity}.${f.name} without default requires a backfill and can lock/fail.`);
    }
    up.push(`ALTER TABLE ${q(c.entity)} ADD COLUMN ${colSql};`);
    down.push(`ALTER TABLE ${q(c.entity)} DROP COLUMN IF EXISTS ${q(f.name)}; -- removes values written after rollout`);
  }
  // 3. Type, nullability and default changes are generated independently.
  for (const c of diff.changes.filter((x) => x.kind === "alter_field")) {
    const to = c.to as { name: string; type: string; nullable: boolean; defaultValue?: string | null };
    const from = c.from as { name: string; type: string; nullable: boolean; defaultValue?: string | null };
    up.push(`-- alter ${c.entity}.${to.name}`);
    if (from.type.toLowerCase() !== to.type.toLowerCase()) {
      up.push(`ALTER TABLE ${q(c.entity)} ALTER COLUMN ${q(to.name)} TYPE ${to.type} USING ${q(to.name)}::${to.type};`);
      down.push(`ALTER TABLE ${q(c.entity)} ALTER COLUMN ${q(to.name)} TYPE ${from.type} USING ${q(to.name)}::${from.type}; -- may lose precision`);
      risks.push(`ALTER TYPE ${c.entity}.${to.name} may rewrite the table and fail on uncastable values.`);
    }
    if (from.nullable !== to.nullable) {
      up.push(`ALTER TABLE ${q(c.entity)} ALTER COLUMN ${q(to.name)} ${to.nullable ? "DROP NOT NULL" : "SET NOT NULL"};`);
      down.push(`ALTER TABLE ${q(c.entity)} ALTER COLUMN ${q(to.name)} ${from.nullable ? "DROP NOT NULL" : "SET NOT NULL"};`);
      if (!to.nullable) risks.push(`SET NOT NULL ${c.entity}.${to.name} scans existing rows and fails if NULLs remain.`);
    }
    if ((from.defaultValue ?? null) !== (to.defaultValue ?? null)) {
      up.push(`ALTER TABLE ${q(c.entity)} ALTER COLUMN ${q(to.name)} ${to.defaultValue ? `SET DEFAULT ${to.defaultValue}` : "DROP DEFAULT"};`);
      down.push(`ALTER TABLE ${q(c.entity)} ALTER COLUMN ${q(to.name)} ${from.defaultValue ? `SET DEFAULT ${from.defaultValue}` : "DROP DEFAULT"};`);
    }
  }
  const formatPgIndex = (entityName: string, ix: IndexModel): string => {
    const cols = ix.columns.map((x) => qcol("postgres", x)).join(", ");
    const incl = ix.includeColumns?.length ? ` INCLUDE (${ix.includeColumns.map((x) => q(x)).join(", ")})` : "";
    const pred = ix.partial && ix.predicate ? ` ${ix.predicate.replace(/^\s*WHERE\s+/i, "WHERE ")}` : "";
    return `CREATE ${ix.unique ? "UNIQUE " : ""}INDEX CONCURRENTLY IF NOT EXISTS ${q(ix.name)} ON ${q(entityName)} USING ${ix.method ?? "btree"} (${cols})${incl}${pred};`;
  };
  const qualifyIndex = (entityName: string, indexName: string): string => {
    const ns = entityName.includes(".") ? entityName.split(".")[0] : null;
    return ns ? `${q(ns)}.${q(indexName)}` : q(indexName);
  };
  const pgConstraintAdd = (entityName: string, k: ConstraintModel): string[] => {
    if (k.kind === "foreign_key") {
      const del = k.onDelete && !/^no action$/i.test(k.onDelete) ? ` ON DELETE ${k.onDelete}` : "";
      const upd = k.onUpdate && !/^no action$/i.test(k.onUpdate) ? ` ON UPDATE ${k.onUpdate}` : "";
      return [
        `ALTER TABLE ${q(entityName)} ADD CONSTRAINT ${q(k.name)} FOREIGN KEY (${k.columns.map((x) => q(x)).join(", ")}) REFERENCES ${q(k.referencedEntity ?? "")} (${(k.referencedColumns?.length ? k.referencedColumns : ["id"]).map((x) => q(x)).join(", ")})${del}${upd} NOT VALID;`,
        `ALTER TABLE ${q(entityName)} VALIDATE CONSTRAINT ${q(k.name)};`,
      ];
    }
    if (k.kind === "unique") return [`ALTER TABLE ${q(entityName)} ADD CONSTRAINT ${q(k.name)} UNIQUE (${k.columns.map((x) => q(x)).join(", ")});`];
    if (k.kind === "check") return [`ALTER TABLE ${q(entityName)} ADD CONSTRAINT ${q(k.name)} CHECK (${k.definition ?? "TRUE"}) NOT VALID;`, `ALTER TABLE ${q(entityName)} VALIDATE CONSTRAINT ${q(k.name)};`];
    if (k.kind === "primary_key") return [`ALTER TABLE ${q(entityName)} ADD CONSTRAINT ${q(k.name)} PRIMARY KEY (${k.columns.map((x) => q(x)).join(", ")});`];
    return [];
  };

  // 4. Constraints (drop modified/removed first so replacements with the same name succeed).
  for (const c of diff.changes.filter((x) => x.kind === "drop_constraint")) {
    const oldCon = (c.from as ConstraintModel | undefined) ?? sMap.get(c.entity)?.constraints.find((k) => k.name === (c.detail.split(".").pop() ?? ""));
    const name = oldCon?.name ?? c.detail.split(".").pop() ?? "";
    up.push(`-- REVIEW: removing an integrity rule`, `ALTER TABLE ${q(c.entity)} DROP CONSTRAINT IF EXISTS ${q(name)};`);
    if (oldCon) down.push(...pgConstraintAdd(c.entity, oldCon));
    else down.push(`-- MANUAL: restore constraint ${name} from the source schema backup`);
    risks.push(`${c.detail} removes an integrity rule.`);
  }
  for (const c of diff.changes.filter((x) => x.kind === "add_constraint")) {
    const k = c.to as ConstraintModel;
    up.push(...pgConstraintAdd(c.entity, k));
    if (k.kind === "foreign_key") risks.push(`FK ${k.name} validation scans the child table; NOT VALID + VALIDATE limits the lock window.`);
    down.push(`ALTER TABLE ${q(c.entity)} DROP CONSTRAINT IF EXISTS ${q(k.name)};`);
  }
  // 5. Index changes run after COMMIT: CONCURRENTLY is illegal in a transaction.
  // Drops go before adds so modified indexes with the same name can be recreated cleanly.
  for (const c of diff.changes.filter((x) => x.kind === "drop_index")) {
    const old = (c.from as IndexModel | undefined) ?? sMap.get(c.entity)?.indexes.find((ix) => ix.name === c.detail.replace(/^DROP INDEX\s+/, ""));
    const name = old?.name ?? c.detail.replace(/^DROP INDEX\s+/, "");
    onlineUp.push(`DROP INDEX CONCURRENTLY IF EXISTS ${qualifyIndex(c.entity, name)};`);
    if (old) onlineDown.push(formatPgIndex(c.entity, old));
    risks.push(`${c.detail} can regress dependent queries; verify workload before applying.`);
  }
  for (const c of diff.changes.filter((x) => x.kind === "add_index")) {
    const ix = c.to as IndexModel;
    onlineUp.push(formatPgIndex(c.entity, ix));
    onlineDown.push(`DROP INDEX CONCURRENTLY IF EXISTS ${qualifyIndex(c.entity, ix.name)};`);
  }
  // 6. Data-destructive operations stay disabled until explicitly reviewed.
  for (const c of diff.changes.filter((x) => x.kind === "drop_field")) {
    up.push(`-- DESTRUCTIVE (disabled): ${c.detail}; verify backup + application deploy first`, `-- ALTER TABLE ${q(c.entity)} DROP COLUMN ${q((c.from as { name: string }).name)};`);
    risks.push(`DROP COLUMN ${c.entity}.${(c.from as { name: string }).name} destroys data.`);
    down.push(`-- IRREVERSIBLE without backup: ${c.entity}.${(c.from as { name: string }).name}`);
  }
  for (const c of diff.changes.filter((x) => x.kind === "drop_entity")) {
    up.push(`-- DESTRUCTIVE (disabled): DROP TABLE ${q(c.entity)}; backup required`, `-- DROP TABLE ${q(c.entity)};`);
    risks.push(`DROP TABLE ${c.entity} destroys all rows.`);
    down.push(`-- IRREVERSIBLE without backup: ${c.entity}`);
  }
  up.push(``, `COMMIT;`);
  down.push(``, `COMMIT;`);
  if (onlineUp.length) up.push(``, `-- Online index phase (must remain outside the transaction)`, ...onlineUp);
  if (onlineDown.length) down.push(``, `-- Online rollback index phase`, ...onlineDown);
  return { up: up.join("\n"), down: down.join("\n"), risks };
}

// Table DDL is rendered via sql-dialects.createTable so ON DELETE, ON UPDATE,
// CHECK, IDENTITY and PARTITION BY clauses stay consistent across DDL & migrations.

// ─── Mongo migration generation ────────────────────────────────────
export function generateMongoMigration(diff: SchemaDiff, source: SchemaModel, target: SchemaModel): { up: string; down: string; risks: string[] } {
  const up: string[] = [
    `// DB Architect migration (mongodb) — mongosh script`,
    `// Generated: ${new Date().toISOString()}`,
    `// REVIEW REQUIRED. Run against a staging copy first.`,
    ``,
  ];
  const down: string[] = [`// Rollback (best-effort)`, ``];
  const risks: string[] = [];
  const tMap = new Map(target.entities.map((e) => [e.name, e]));
  for (const c of diff.changes.filter((x) => x.kind === "add_entity")) {
    const e = tMap.get(c.entity);
    up.push(`db.createCollection("${c.entity}"${e?.metadata?.validator ? `, { validator: ${JSON.stringify(e.metadata.validator)} }` : ""});`);
    down.push(`db.getCollection("${c.entity}").drop(); // DATA LOSS`);
    risks.push(`createCollection ${c.entity}`);
  }
  for (const c of diff.changes.filter((x) => x.kind === "add_index")) {
    const ix = c.to as { name: string; columns: string[]; unique?: boolean };
    const keys = ix.columns.map((k) => `${k}: 1`).join(", ");
    up.push(`db.getCollection("${c.entity}").createIndex({ ${keys} }, { name: "${ix.name}"${ix.unique ? ", unique: true" : ""}, background: true });`);
    down.push(`db.getCollection("${c.entity}").dropIndex("${ix.name}");`);
  }
  for (const c of diff.changes.filter((x) => x.kind === "add_field")) {
    const f = c.to as { name: string; defaultValue?: string | null };
    up.push(`// field transform: set default for missing ${c.entity}.${f.name}`);
    up.push(`db.getCollection("${c.entity}").updateMany({ "${f.name}": { $exists: false } }, { $set: { "${f.name}": ${f.defaultValue ?? "null"} } });`);
    risks.push(`updateMany backfill on ${c.entity}.${f.name} — batch on large collections.`);
    down.push(`db.getCollection("${c.entity}").updateMany({}, { $unset: { "${f.name}": "" } }); // DATA LOSS`);
  }
  for (const c of diff.changes.filter((x) => x.kind === "drop_index")) {
    const name = c.detail.replace(/^DROP INDEX\s+/, "");
    up.push(`db.getCollection("${c.entity}").dropIndex("${name}");`);
    const old = source.entities.find((e) => e.name === c.entity)?.indexes.find((ix) => ix.name === name);
    if (old) down.push(`db.getCollection("${c.entity}").createIndex({ ${old.columns.map((k) => `${k}: 1`).join(", ")} }, { name: "${old.name}"${old.unique ? ", unique: true" : ""} });`);
    risks.push(`dropIndex ${name} on ${c.entity} can regress queries; review explain() output first.`);
  }
  for (const c of diff.changes.filter((x) => x.kind === "alter_field")) {
    const from = c.from as { name: string; type: string };
    const to = c.to as { name: string; type: string };
    if (from.type !== to.type) {
      up.push(`// MANUAL DATA TRANSFORM REQUIRED: ${c.entity}.${to.name} (${from.type} → ${to.type})`);
      up.push(`// Conversion and error handling must be reviewed for your workload:`);
      up.push(`// db.getCollection("${c.entity}").updateMany({ "${to.name}": { $exists: true } }, [ { $set: { "${to.name}": { $convert: { input: "$${to.name}", to: "TARGET_BSON_TYPE", onError: "$${to.name}", onNull: null } } } } ]);`);
      risks.push(`${c.entity}.${to.name} type conversion needs an application-specific, tested document transform.`);
    }
  }
  for (const c of diff.changes.filter((x) => x.kind === "drop_field")) {
    up.push(`// ⛔ DESTRUCTIVE (commented): db.getCollection("${c.entity}").updateMany({}, { $unset: { "${(c.from as { name: string }).name}": "" } });`);
    risks.push(`$unset ${(c.from as { name: string }).name} on ${c.entity} destroys data.`);
  }
  for (const c of diff.changes.filter((x) => x.kind === "drop_entity")) {
    up.push(`// ⛔ DESTRUCTIVE (commented): db.getCollection("${c.entity}").drop(); // backup first`);
    risks.push(`drop ${c.entity} destroys all documents.`);
  }
  for (const r of diff.renames) {
    up.push(`// ⚠ possible rename: ${r.detail} — confirm, then use renameCollection`);
  }
  return { up: up.join("\n"), down: down.join("\n"), risks };
}

export function validateMigration(up: string, engine?: string): { ok: boolean; checks: string[] } {
  const checks: string[] = [];
  const active = up.split("\n").filter((line) => !line.trimStart().startsWith("--") && !line.trimStart().startsWith("//")).join("\n");
  const isMongo = /mongosh|db\.getCollection|db\.createCollection/.test(up);
  if (engine === "mysql") {
    checks.push("MySQL DDL implicitly commits — the script is not transactional; take a backup and use a maintenance window");
  } else if (isMongo) {
    checks.push(/mongosh/.test(up) ? "MongoDB script header present" : "Missing mongosh header");
    const open = (active.match(/\(/g) ?? []).length, close = (active.match(/\)/g) ?? []).length;
    checks.push(open === close ? "Balanced call parentheses" : `Unbalanced call parentheses (${open} open / ${close} close)`);
  } else {
    const begins = (active.match(/\bBEGIN\s*;/gi) ?? []).length, commits = (active.match(/\bCOMMIT\s*;/gi) ?? []).length;
    checks.push(begins === commits && begins > 0 ? "Balanced transaction block" : "Missing or unbalanced BEGIN/COMMIT");
    const tx = active.match(/BEGIN\s*;([\s\S]*?)COMMIT\s*;/i)?.[1] ?? "";
    checks.push(/CONCURRENTLY/i.test(tx) ? "ERROR: CONCURRENTLY appears inside a transaction" : "Concurrent index operations are outside the transaction");
  }
  const destructive = /DROP\s+TABLE|DROP\s+COLUMN|\.drop\s*\(|\$unset/i.test(active);
  checks.push(destructive ? "ACTIVE destructive statements require backup + approval" : "No active data-destructive statements");
  checks.push(/CONCURRENTLY|NOT VALID|VALIDATE CONSTRAINT|background:\s*true/i.test(up) ? "Online migration patterns detected where applicable" : "No online-pattern operations required or detected");
  checks.push("Static validation only — no statements were executed");
  const ok = checks.every((c) => !c.startsWith("ERROR") && !c.startsWith("Missing") && !c.startsWith("Unbalanced"));
  return { ok, checks };
}

export function scriptHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function topoOrder(names: string[], target: SchemaModel): string[] {
  // referenced tables first
  const deps = new Map<string, string[]>();
  for (const n of names) {
    const e = target.entities.find((x) => x.name === n);
    deps.set(n, (e?.constraints ?? []).filter((c) => c.kind === "foreign_key" && c.referencedEntity && names.includes(c.referencedEntity)).map((c) => c.referencedEntity as string));
  }
  const out: string[] = [];
  const visit = (n: string, seen: Set<string>) => {
    if (out.includes(n) || seen.has(n)) return;
    seen.add(n);
    for (const d of deps.get(n) ?? []) visit(d, seen);
    out.push(n);
  };
  for (const n of names) visit(n, new Set());
  return out;
}

function q(name: string): string {
  if (name.includes(".")) return name.split(".").map((p) => `"${p}"`).join(".");
  if (/[^a-z0-9_]/i.test(name)) return `"${name}"`;
  return name;
}

export function generateMigration(engine: string, diff: SchemaDiff, source: SchemaModel, target: SchemaModel): { up: string; down: string; risks: string[] } {
  if (engine === "mongodb") return generateMongoMigration(diff, source, target);
  if (engine === "mysql" || engine === "sqlite") return generateSqlMigration(engine, diff, source, target);
  return generatePostgresMigration(diff, source, target);
}
