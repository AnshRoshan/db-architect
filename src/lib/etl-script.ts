import type { Engine } from "./engines";
import type { SchemaModel } from "./schema-model";
import type { Runtime } from "./transform";

// Generates a standalone Node.js ETL script. The source is only ever read
// (SELECT / find); the target receives idempotent inserts.

function sqlDriver(engine: Exclude<Engine, "mongodb">, role: "src" | "dst"): string[] {
  const env = role === "src" ? "SOURCE_URL" : "TARGET_URL";
  const pool = `${role}Pool`;
  const insertNote = role === "dst";
  if (engine === "postgres") {
    return [
      "const { Pool } = require('pg');",
      `const ${pool} = new Pool({ connectionString: process.env.${env} });`,
      `const ${role} = {`,
      "  ph: (i) => '$' + i,",
      "  quote: (n) => '\"' + n.split('\"').join('\"\"') + '\"',",
      "  table: (n) => n.split('.').map((p) => '\"' + p.split('\"').join('\"\"') + '\"').join('.'),",
      `  async query(text, params) { const r = await ${pool}.query(text, params || []); return r.rows; },`,
      "  inList(col, values) { return { text: this.quote(col) + ' = ANY($1)', params: [values] }; },",
      ...(insertNote ? [
        "  async insert(table, cols, rows) {",
        "    if (!rows.length || DRY) return;",
        "    const per = Math.max(1, Math.floor(60000 / cols.length));",
        "    for (let i = 0; i < rows.length; i += per) {",
        "      const params = [];",
        "      const vals = rows.slice(i, i + per).map((r) => '(' + r.map((v) => { params.push(v); return '$' + params.length; }).join(',') + ')').join(',');",
        `      await ${pool}.query('INSERT INTO ' + this.table(table) + ' (' + cols.map((c) => this.quote(c)).join(',') + ') VALUES ' + vals + ' ON CONFLICT DO NOTHING', params);`,
        "    }",
        "  },",
      ] : []),
      `  async close() { await ${pool}.end(); },`,
      "};",
    ];
  }
  if (engine === "mysql") {
    return [
      "const mysql = require('mysql2/promise');",
      "const BT = String.fromCharCode(96);",
      `const ${pool} = mysql.createPool({ uri: process.env.${env} });`,
      `const ${role} = {`,
      "  ph: () => '?',",
      "  quote: (n) => BT + n.split(BT).join(BT + BT) + BT,",
      "  table(n) { return this.quote(n.split('.').pop()); },",
      `  async query(text, params) { const [rows] = await ${pool}.query(text, params || []); return rows; },`,
      "  inList(col, values) { return { text: this.quote(col) + ' IN (?)', params: [values] }; },",
      ...(insertNote ? [
        "  async insert(table, cols, rows) {",
        "    if (!rows.length || DRY) return;",
        `    await ${pool}.query('INSERT IGNORE INTO ' + this.table(table) + ' (' + cols.map((c) => this.quote(c)).join(',') + ') VALUES ?', [rows]);`,
        "  },",
      ] : []),
      `  async close() { await ${pool}.end(); },`,
      "};",
    ];
  }
  return [
    "const Database = require('better-sqlite3');",
    `const ${role}Db = new Database(process.env.${env}${role === "src" ? ", { readonly: true }" : ""});`,
    `const ${role} = {`,
    "  ph: () => '?',",
    "  quote: (n) => '\"' + n.split('\"').join('\"\"') + '\"',",
    "  table(n) { return this.quote(n.split('.').pop()); },",
    `  async query(text, params) { return ${role}Db.prepare(text).all(...(params || [])); },`,
    "  inList(col, values) { return { text: this.quote(col) + ' IN (' + values.map(() => '?').join(',') + ')', params: values }; },",
    ...(insertNote ? [
      "  async insert(table, cols, rows) {",
      "    if (!rows.length || DRY) return;",
      "    const stmt = dstDb.prepare('INSERT OR IGNORE INTO ' + this.table(table) + ' (' + cols.map((c) => this.quote(c)).join(',') + ') VALUES (' + cols.map(() => '?').join(',') + ')');",
      "    dstDb.transaction((rs) => { for (const r of rs) stmt.run(...r); })(rows);",
      "  },",
    ] : []),
    `  async close() { ${role}Db.close(); },`,
    "};",
  ];
}

const MONGO_DRIVER = (role: "src" | "dst"): string[] => [
  "const { MongoClient, Decimal128 } = require('mongodb');",
  `const ${role}Client = new MongoClient(process.env.${role === "src" ? "SOURCE_URL" : "TARGET_URL"});`,
];

const READ_TABLE = [
  "async function* readTable(spec) {",
  "  const t = src.table(spec.source);",
  "  const pk = spec.pk && spec.pk.length === 1 ? spec.pk[0] : null;",
  "  if (pk) {",
  "    let last = null;",
  "    for (;;) {",
  "      const where = last === null ? '' : ' WHERE ' + src.quote(pk) + ' > ' + src.ph(1);",
  "      const rows = await src.query('SELECT * FROM ' + t + where + ' ORDER BY ' + src.quote(pk) + ' LIMIT ' + BATCH, last === null ? [] : [last]);",
  "      if (!rows.length) return;",
  "      yield rows;",
  "      last = rows[rows.length - 1][pk];",
  "      if (rows.length < BATCH) return;",
  "    }",
  "  }",
  "  // No single-column primary key: OFFSET paging (stable only while the source is quiescent).",
  "  for (let off = 0; ; off += BATCH) {",
  "    const rows = await src.query('SELECT * FROM ' + t + ' LIMIT ' + BATCH + ' OFFSET ' + off);",
  "    if (!rows.length) return;",
  "    yield rows;",
  "    if (rows.length < BATCH) return;",
  "  }",
  "}",
];

const CONV_COMMON = [
  "identity: (v) => v,",
  "bool_to_int: (v) => (v == null ? null : v === true || v === 't' || v === 'true' || v === 1 || v === '1' ? 1 : 0),",
  "int_to_bool: (v) => (v == null ? null : v === true || Number(v) === 1 || v === 't' || v === 'true'),",
  "json_stringify: (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v)),",
  "json_parse: (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { return v; } },",
  "to_string: (v) => (v == null ? null : v instanceof Date ? v.toISOString() : v && v._bsontype ? String(v) : typeof v === 'object' ? JSON.stringify(v) : String(v)),",
  "to_iso: (v) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v)),",
];

export function buildEtlScript(plan: { sourceEngine: Engine; targetEngine: Engine; runtime: Runtime; targetModel: SchemaModel }): string {
  const { sourceEngine: src, targetEngine: dst, runtime } = plan;
  const dstMongo = dst === "mongodb";
  const srcMongo = src === "mongodb";
  const out: string[] = [
    "#!/usr/bin/env node",
    "/* Generated by DB Architect — REVIEW BEFORE RUNNING.",
    ` * Direction : ${src} -> ${dst}`,
    " * Source    : accessed READ-ONLY (SELECT / find). Target receives idempotent inserts.",
    " * Env       : SOURCE_URL, TARGET_URL   (optional: BATCH_SIZE=1000, DRY_RUN=1)",
    " * Always rehearse on a staging copy and compare counts before cutover. */",
    "'use strict';",
    "const BATCH = Number(process.env.BATCH_SIZE || 1000);",
    "const DRY = process.env.DRY_RUN === '1';",
    "",
  ];
  const planJson = JSON.stringify(
    runtime.kind === "sql_to_sql" ? { tables: runtime.tables }
      : runtime.kind === "sql_to_mongo" ? { collections: runtime.collections, indexes: plan.targetModel.entities.flatMap((e) => e.indexes.map((ix) => ({ collection: e.name, name: ix.name, unique: ix.unique, keys: Object.fromEntries(ix.columns.map((c) => [c, 1])) }))) }
        : { roots: runtime.roots },
    null, 2);
  out.push(`const PLAN = ${planJson};`, "");
  out.push("const conv = {", ...CONV_COMMON.map((l) => "  " + l));
  out.push(dstMongo ? "  to_date: (v) => (v == null ? null : new Date(v))," : "  to_date: (v) => v,");
  out.push(dstMongo ? "  to_decimal: (v) => (v == null ? null : Decimal128.fromString(String(v)))," : "  to_decimal: (v) => v,");
  out.push("};", "");
  // drivers
  if (srcMongo) out.push(...MONGO_DRIVER("src")); else out.push(...sqlDriver(src as Exclude<Engine, "mongodb">, "src"));
  if (dstMongo) out.push(...MONGO_DRIVER("dst")); else out.push(...sqlDriver(dst as Exclude<Engine, "mongodb">, "dst"));
  out.push("");
  if (!srcMongo) out.push(...READ_TABLE, "");
  if (dstMongo) {
    out.push(
      "async function insertDocs(coll, docs) {",
      "  if (!docs.length || DRY) return;",
      "  try { await dstClient.db().collection(coll).insertMany(docs, { ordered: false }); }",
      "  catch (e) { if (e && e.code === 11000) return; if (e && e.writeErrors && e.writeErrors.every((w) => w.code === 11000)) return; throw e; }",
      "}", "",
    );
  }
  if (runtime.kind === "sql_to_sql") {
    out.push(
      "async function main() {",
      "  for (const spec of PLAN.tables) {",
      "    let n = 0;",
      "    const cols = spec.columns.map((c) => c.dst);",
      "    for await (const rows of readTable(spec)) {",
      "      const batch = rows.map((r) => spec.columns.map((c) => conv[c.convert](r[c.src])));",
      "      await dst.insert(spec.target, cols, batch);",
      "      n += rows.length;",
      "      console.log(spec.source + ' -> ' + spec.target + ': ' + n + ' rows');",
      "    }",
      "  }",
      "  await src.close(); await dst.close();",
      "  console.log('Load complete. If the DDL has a Phase 2 section, apply it now (after validating counts).');",
      "}",
    );
  } else if (runtime.kind === "sql_to_mongo") {
    out.push(
      "function buildDoc(cols, row) {",
      "  const d = {};",
      "  for (const c of cols) { const v = conv[c.convert](row[c.src]); if (v !== null && v !== undefined) d[c.dst] = v; }",
      "  return d;",
      "}",
      "async function main() {",
      "  await dstClient.connect();",
      "  for (const spec of PLAN.collections) {",
      "    let n = 0;",
      "    for await (const rows of readTable(spec)) {",
      "      const related = {};",
      "      for (const em of spec.embeds) {",
      "        const keys = rows.map((r) => r[em.parentKey]).filter((v) => v != null);",
      "        if (!keys.length) { related[em.source] = []; continue; }",
      "        const q = src.inList(em.fk, keys);",
      "        related[em.source] = await src.query('SELECT * FROM ' + src.table(em.source) + ' WHERE ' + q.text, q.params);",
      "      }",
      "      for (const j of spec.junctions) {",
      "        const keys = rows.map((r) => r[j.parentKey]).filter((v) => v != null);",
      "        if (!keys.length) { related[j.source] = []; continue; }",
      "        const q = src.inList(j.fkParent, keys);",
      "        related[j.source] = await src.query('SELECT * FROM ' + src.table(j.source) + ' WHERE ' + q.text, q.params);",
      "      }",
      "      const docs = rows.map((r) => {",
      "        const d = buildDoc(spec.columns, r);",
      "        for (const em of spec.embeds) d[em.field] = (related[em.source] || []).filter((x) => String(x[em.fk]) === String(r[em.parentKey])).map((x) => buildDoc(em.columns, x));",
      "        for (const j of spec.junctions) d[j.field] = (related[j.source] || []).filter((x) => String(x[j.fkParent]) === String(r[j.parentKey])).map((x) => x[j.fkOther]);",
      "        return d;",
      "      });",
      "      await insertDocs(spec.target, docs);",
      "      n += rows.length;",
      "      console.log(spec.source + ' -> ' + spec.target + ': ' + n + ' documents');",
      "    }",
      "  }",
      "  if (!DRY) for (const ix of PLAN.indexes) await dstClient.db().collection(ix.collection).createIndex(ix.keys, { name: ix.name, unique: ix.unique });",
      "  await src.close(); await dstClient.close();",
      "  console.log('Load complete. Validate counts and orphans, then set validationAction to \"error\".');",
      "}",
    );
  } else {
    out.push(
      "const getPath = (o, p) => { let c = o; for (const k of p) { if (c == null || typeof c !== 'object') return undefined; c = c[k]; } return c; };",
      "async function main() {",
      "  await srcClient.connect();",
      "  for (const root of PLAN.roots) {",
      "    const buf = {}; const cols = {}; let n = 0;",
      "    const add = (table, columns, row) => { (buf[table] = buf[table] || []).push(columns.map((c) => row[c])); cols[table] = columns; };",
      "    const flush = async (force) => {",
      "      if (!force && !Object.values(buf).some((r) => r.length >= BATCH)) return;",
      "      for (const t of [root.target].concat(root.children.map((c) => c.target))) {",
      "        if (buf[t] && buf[t].length) { await dst.insert(t, cols[t], buf[t]); buf[t] = []; }",
      "      }",
      "    };",
      "    for await (const doc of srcClient.db().collection(root.source).find({}).batchSize(BATCH)) {",
      "      const row = {}; row[root.idColumn] = String(doc._id);",
      "      for (const c of root.columns) { const v = getPath(doc, c.path); row[c.dst] = v === undefined ? null : conv[c.convert](v); }",
      "      add(root.target, [root.idColumn].concat(root.columns.map((c) => c.dst)), row);",
      "      for (const ch of root.children) {",
      "        const arr = getPath(doc, ch.path);",
      "        if (!Array.isArray(arr)) continue;",
      "        arr.forEach((item, i) => {",
      "          const r = {}; r[ch.fk] = row[root.idColumn]; r.position = i;",
      "          if (ch.kind === 'scalar') r[ch.valueColumn] = conv[ch.scalarConvert](item);",
      "          else for (const c of ch.columns) { const v = getPath(item, c.path); r[c.dst] = v === undefined ? null : conv[c.convert](v); }",
      "          add(ch.target, [ch.fk, 'position'].concat(ch.kind === 'scalar' ? [ch.valueColumn] : ch.columns.map((c) => c.dst)), r);",
      "        });",
      "      }",
      "      n++; await flush(false);",
      "      if (n % 10000 === 0) console.log(root.source + ': ' + n + ' documents');",
      "    }",
      "    await flush(true);",
      "    console.log(root.source + ' -> ' + root.target + ': ' + n + ' documents');",
      "  }",
      "  await srcClient.close(); await dst.close();",
      "  console.log('Load complete. Validate counts, run orphan checks, then apply Phase 2 foreign keys from the DDL.');",
      "}",
    );
  }
  out.push("", "main().catch((e) => { console.error(e); process.exit(1); });", "");
  return out.join("\n");
}
