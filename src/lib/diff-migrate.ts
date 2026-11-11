import { createHash } from "crypto";
import { SchemaModel, EntityModel } from "./schema-model";
import { generateSqlMigration, createIndexes } from "./sql-dialects";

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
    for (const f of s.fields) {
      if (!tf.has(f.name)) {
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
      } else if (old.type.toLowerCase() !== f.type.toLowerCase() || old.nullable !== f.nullable || (old.defaultValue ?? null) !== (f.defaultValue ?? null)) {
        changes.push({
          kind: "alter_field",
          entity: t.name,
          detail: `ALTER ${t.name}.${f.name}: ${old.type}${old.nullable ? "" : " NOT NULL"} → ${f.type}${f.nullable ? "" : " NOT NULL"}`,
          from: old,
          to: f,
          destructive: !f.nullable && old.nullable ? true : false,
          risk: typeRisk(old.type, f.type),
          riskReason: "Type/nullability change may rewrite the table and fail on existing values.",
        });
      }
    }
    // indexes
    const si = new Map(s.indexes.map((i) => [i.name, i]));
    const ti = new Map(t.indexes.map((i) => [i.name, i]));
    for (const n of si.keys()) {
      if (!ti.has(n))
        changes.push({ kind: "drop_index", entity: t.name, detail: `DROP INDEX ${n}`, destructive: false, risk: "medium", riskReason: "Dropping an index can regress dependent queries; verify workload." });
    }
    for (const [n, ix] of ti) {
      if (!si.has(n))
        changes.push({ kind: "add_index", entity: t.name, detail: `CREATE ${ix.unique ? "UNIQUE " : ""}INDEX ${n} ON ${t.name} (${ix.columns.join(", ")})`, to: ix, destructive: false, risk: "medium", riskReason: "CREATE INDEX locks writes (use CONCURRENTLY on large tables)." });
    }
    // constraints
    const sc = new Map(s.constraints.map((c) => [c.name, c]));
    const tc = new Map(t.constraints.map((c) => [c.name, c]));
    for (const n of sc.keys()) {
      if (!tc.has(n))
        changes.push({ kind: "drop_constraint", entity: t.name, detail: `DROP CONSTRAINT ${t.name}.${n}`, destructive: n.includes("pkey") || n.startsWith("fk"), risk: "medium", riskReason: "Removing integrity rules can admit bad data." });
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

function typeRisk(from: string, to: string): "low" | "medium" | "high" {
  const f = from.toLowerCase();
  const t = to.toLowerCase();
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

  // 1. New tables, referenced entities first.
  const newTables = diff.changes.filter((c) => c.kind === "add_entity");
  for (const name of topoOrder(newTables.map((c) => c.entity), target)) {
    const entity = tMap.get(name)!;
    if (entity.kind === "collection") continue;
    up.push(`-- + table ${name}`, createTableSql(entity), ...createIndexes(entity, "postgres"));
    down.unshift(`DROP TABLE IF EXISTS ${q(name)};`);
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
  // 4. Constraints.
  for (const c of diff.changes.filter((x) => x.kind === "add_constraint")) {
    const k = c.to as { kind: string; name: string; columns: string[]; referencedEntity?: string | null; referencedColumns?: string[]; definition?: string | null };
    if (k.kind === "foreign_key") {
      up.push(`ALTER TABLE ${q(c.entity)} ADD CONSTRAINT ${q(k.name)} FOREIGN KEY (${k.columns.map((x) => q(x)).join(", ")}) REFERENCES ${q(k.referencedEntity ?? "")} (${(k.referencedColumns ?? ["id"]).map((x) => q(x)).join(", ")}) NOT VALID;`);
      up.push(`ALTER TABLE ${q(c.entity)} VALIDATE CONSTRAINT ${q(k.name)};`);
      risks.push(`FK ${k.name} validation scans the child table; NOT VALID + VALIDATE limits the lock window.`);
    } else if (k.kind === "unique") {
      up.push(`ALTER TABLE ${q(c.entity)} ADD CONSTRAINT ${q(k.name)} UNIQUE (${k.columns.map((x) => q(x)).join(", ")});`);
    } else if (k.kind === "check") {
      up.push(`ALTER TABLE ${q(c.entity)} ADD CONSTRAINT ${q(k.name)} CHECK (${k.definition ?? "TRUE"}) NOT VALID;`, `ALTER TABLE ${q(c.entity)} VALIDATE CONSTRAINT ${q(k.name)};`);
    } else if (k.kind === "primary_key") {
      up.push(`ALTER TABLE ${q(c.entity)} ADD CONSTRAINT ${q(k.name)} PRIMARY KEY (${k.columns.map((x) => q(x)).join(", ")});`);
    }
    down.push(`ALTER TABLE ${q(c.entity)} DROP CONSTRAINT IF EXISTS ${q(k.name)};`);
  }
  // 5. Index changes run after COMMIT: CONCURRENTLY is illegal in a transaction.
  for (const c of diff.changes.filter((x) => x.kind === "add_index")) {
    const ix = c.to as { name: string; columns: string[]; unique: boolean; method?: string };
    onlineUp.push(`CREATE ${ix.unique ? "UNIQUE " : ""}INDEX CONCURRENTLY IF NOT EXISTS ${q(ix.name)} ON ${q(c.entity)} USING ${ix.method ?? "btree"} (${ix.columns.map((x) => q(x)).join(", ")});`);
    onlineDown.push(`DROP INDEX CONCURRENTLY IF EXISTS ${q(ix.name)};`);
  }
  for (const c of diff.changes.filter((x) => x.kind === "drop_index")) {
    const name = c.detail.replace(/^DROP INDEX\s+/, "");
    onlineUp.push(`DROP INDEX CONCURRENTLY IF EXISTS ${q(name)};`);
    const old = sMap.get(c.entity)?.indexes.find((ix) => ix.name === name);
    if (old) onlineDown.push(`CREATE ${old.unique ? "UNIQUE " : ""}INDEX CONCURRENTLY IF NOT EXISTS ${q(old.name)} ON ${q(c.entity)} USING ${old.method ?? "btree"} (${old.columns.map((x) => q(x)).join(", ")});`);
    risks.push(`${c.detail} can regress dependent queries; verify workload before applying.`);
  }
  for (const c of diff.changes.filter((x) => x.kind === "drop_constraint")) {
    const name = c.detail.split(".").pop() ?? "";
    up.push(`-- REVIEW: removing an integrity rule`, `ALTER TABLE ${q(c.entity)} DROP CONSTRAINT IF EXISTS ${q(name)};`);
    down.push(`-- MANUAL: restore constraint ${name} from the source schema backup`);
    risks.push(`${c.detail} removes an integrity rule.`);
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

function createTableSql(e: EntityModel): string {
  const cols = e.fields.map(
    (f) => `  ${q(f.name)} ${f.type}${f.nullable ? "" : " NOT NULL"}${f.defaultValue ? ` DEFAULT ${f.defaultValue}` : ""}`
  );
  const pk = e.constraints.find((c) => c.kind === "primary_key");
  if (pk) cols.push(`  CONSTRAINT ${q(pk.name)} PRIMARY KEY (${pk.columns.map((c) => q(c)).join(", ")})`);
  for (const c of e.constraints.filter((x) => x.kind === "unique")) {
    cols.push(`  CONSTRAINT ${q(c.name)} UNIQUE (${c.columns.map((x) => q(x)).join(", ")})`);
  }
  for (const c of e.constraints.filter((x) => x.kind === "foreign_key")) {
    cols.push(
      `  CONSTRAINT ${q(c.name)} FOREIGN KEY (${c.columns.map((x) => q(x)).join(", ")}) REFERENCES ${q(c.referencedEntity ?? "")} (${(c.referencedColumns ?? ["id"]).map((x) => q(x)).join(", ")})`
    );
  }
  return `CREATE TABLE IF NOT EXISTS ${q(e.name)} (\n${cols.join(",\n")}\n);`;
}

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
