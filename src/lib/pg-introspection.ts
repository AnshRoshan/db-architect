import { Pool } from "pg";
import { SchemaModel, EntityModel, emptyModel, entityId, fieldId, indexId, constraintId } from "./schema-model";
import { deriveExplicitRelationships } from "./dsl";
import { type PgConnConfig, resolvePgSsl, validateHost } from "./introspection";

// ─── PostgreSQL live introspection (read-only, pg_catalog based) ───
// Works across every schema of a database, not just `public`:
//  • schema discovery with table/view counts
//  • selection by list, glob (`tenant_*`), exclusion (`!audit`) or `*` for all
//  • foreign keys resolved by OID, so cross-schema and composite keys are exact
//  • views, materialized views, partitioned and foreign tables keep their kind

export interface DiscoveredNamespace { name: string; tables: number; views: number; owner?: string | null; comment?: string | null; keys?: number }

const FK_ACTION: Record<string, string> = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };
const MAX_RELATIONS = 3000;
const unquote = (s: string) => (/^".*"$/.test(s) ? s.slice(1, -1).replace(/""/g, '"') : s);

/**
 * Resolve a schema selection against what exists on the server.
 * "" or "*" → everything; "a,b" → those; "tenant_*" → glob; "!x" → exclude.
 */
export function resolveSchemaSelection(selection: string | null | undefined, available: string[]): { selected: string[]; missing: string[] } {
  const tokens = (selection ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const include = tokens.filter((t) => !t.startsWith("!"));
  const exclude = tokens.filter((t) => t.startsWith("!")).map((t) => t.slice(1)).filter(Boolean);
  const glob = (pattern: string) => {
    const escaped = pattern.replace(/[.+?^$(){}|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp("^" + escaped + "$");
  };
  const missing: string[] = [];
  let selected: string[];
  if (!include.length) selected = [...available];
  else {
    const hit = new Set<string>();
    for (const token of include) {
      const re = glob(token);
      const matches = available.filter((a) => re.test(a));
      if (!matches.length && !token.includes("*")) missing.push(token);
      for (const m of matches) hit.add(m);
    }
    selected = available.filter((a) => hit.has(a));
  }
  const excluded = exclude.map(glob);
  return { selected: selected.filter((s) => !excluded.some((re) => re.test(s))), missing };
}

async function openPool(cfg: PgConnConfig, max = 2): Promise<Pool> {
  const hv = validateHost(cfg.host);
  if (!hv.ok) throw new Error(hv.reason);
  const ssl = await resolvePgSsl(cfg);
  return new Pool({ host: cfg.host, port: cfg.port, database: cfg.database, user: cfg.username, password: cfg.password, ssl, connectionTimeoutMillis: 10000, query_timeout: 30000, max });
}

const SCHEMAS_SQL = `
SELECT n.nspname AS name,
       pg_catalog.pg_get_userbyid(n.nspowner) AS owner,
       pg_catalog.obj_description(n.oid, 'pg_namespace') AS comment,
       (count(c.oid) FILTER (WHERE c.relkind IN ('r','p','f') AND NOT c.relispartition))::int AS tables,
       (count(c.oid) FILTER (WHERE c.relkind IN ('v','m')))::int AS views
FROM pg_catalog.pg_namespace n
LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relkind IN ('r','p','v','m','f')
WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
GROUP BY n.oid, n.nspname, n.nspowner
ORDER BY n.nspname`;

/** Every non-system schema in the database, with how much it contains. */
export async function listPostgresSchemas(cfg: PgConnConfig): Promise<DiscoveredNamespace[]> {
  const pool = await openPool(cfg, 1);
  try {
    const r = await pool.query(SCHEMAS_SQL);
    return r.rows as DiscoveredNamespace[];
  } finally {
    await pool.end().catch(() => undefined);
  }
}

type RelRow = { oid: string; schema: string; name: string; kind: string; tuples: number | null; is_partition: boolean; comment: string | null };
type ColRow = { rel: string; num: number; name: string; type: string; notnull: boolean; def: string | null; identity: string | null; generated: string | null; comment: string | null };
type ConRow = { rel: string; name: string; type: string; cols: number[] | null; ref: string; refcols: number[] | null; del: string; upd: string; def: string | null };
type IdxRow = { rel: string; name: string; is_unique: boolean; is_primary: boolean; is_valid: boolean; method: string; nkeys: number; cols: string[] | null; attnums: number[] | null; predicate: string | null; def: string; scans: number | null };

export async function introspectPostgres(cfg: PgConnConfig, onStage?: (s: string) => void): Promise<SchemaModel> {
  const pool = await openPool(cfg);
  try {
    onStage?.("connecting");
    const ver = await pool.query("SHOW server_version");
    const model = emptyModel("postgres", cfg.database);
    model.version = ver.rows[0]?.server_version ?? null;
    model.sourceMetadata.source = "introspection:postgres";

    const available = (await pool.query(SCHEMAS_SQL)).rows as DiscoveredNamespace[];
    const { selected, missing } = resolveSchemaSelection(cfg.schemaSelection, available.map((s) => s.name));
    if (!selected.length) {
      throw new Error(`None of the requested schemas exist in "${cfg.database}" (asked for: ${cfg.schemaSelection || "*"}). Available: ${available.map((s) => s.name).join(", ") || "none"}.`);
    }
    if (missing.length) model.warnings.push(`Requested schema${missing.length > 1 ? "s" : ""} not found and skipped: ${missing.join(", ")}.`);
    model.namespaces = selected;
    const excluded = available.filter((s) => !selected.includes(s.name) && s.tables + s.views > 0);
    model.catalog = {
      namespaces: available.filter((s) => selected.includes(s.name)).map((s) => ({ name: s.name, owner: s.owner ?? null, comment: s.comment ?? null, tables: s.tables, views: s.views })),
      excludedNamespaces: excluded.map((s) => s.name),
    };

    onStage?.("introspecting");
    const relRes = await pool.query(
      `SELECT c.oid::text AS oid, n.nspname AS schema, c.relname AS name, c.relkind AS kind,
              c.reltuples::float8 AS tuples, c.relispartition AS is_partition,
              pg_catalog.obj_description(c.oid, 'pg_class') AS comment
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r','p','v','m','f')
       ORDER BY n.nspname, c.relname`,
      [selected]
    );
    let rels = (relRes.rows as RelRow[]).filter((r) => !r.is_partition);
    const partitionChildren = relRes.rows.length - rels.length;
    if (rels.length > MAX_RELATIONS) {
      model.warnings.push(`Database has ${rels.length} relations in the selected schemas; the first ${MAX_RELATIONS} were introspected. Narrow the schema selection for a complete model.`);
      rels = rels.slice(0, MAX_RELATIONS);
    }
    const oids = rels.map((r) => r.oid);
    const entByOid = new Map<string, EntityModel>();
    const colName = new Map<string, Map<number, string>>();
    for (const r of rels) {
      const eid = entityId("postgres", r.schema, r.name);
      const kind: EntityModel["kind"] = r.kind === "v" ? "view" : r.kind === "m" ? "materialized_view" : r.kind === "f" ? "foreign_table" : "table";
      const entity: EntityModel = {
        id: eid, name: `${r.schema}.${r.name}`, shortName: r.name, namespace: r.schema, kind, engine: "postgres",
        fields: [], indexes: [], constraints: [], comment: r.comment ?? null,
        rowEstimate: kind === "table" || kind === "materialized_view" ? (typeof r.tuples === "number" && r.tuples >= 0 ? Math.round(r.tuples) : null) : null,
        metadata: { isPgTable: r.kind === "r" || r.kind === "p", ...(r.kind === "p" ? { partitioned: true } : {}) },
      };
      entByOid.set(r.oid, entity);
      colName.set(r.oid, new Map());
      model.entities.push(entity);
    }

    if (oids.length) {
      const cols = await pool.query(
        `SELECT a.attrelid::text AS rel, a.attnum::int AS num, a.attname AS name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS notnull,
                pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS def,
                NULLIF(to_jsonb(a)->>'attidentity', '') AS identity,
                NULLIF(to_jsonb(a)->>'attgenerated', '') AS generated,
                pg_catalog.col_description(a.attrelid, a.attnum) AS comment
         FROM pg_catalog.pg_attribute a
         LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attrelid = ANY($1::oid[]) AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attrelid, a.attnum`,
        [oids]
      );
      for (const c of cols.rows as ColRow[]) {
        const ent = entByOid.get(c.rel);
        if (!ent) continue;
        colName.get(c.rel)!.set(c.num, c.name);
        ent.fields.push({
          id: fieldId(ent.id, c.name), name: c.name, type: c.type, nullable: !c.notnull,
          defaultValue: c.generated ? null : c.def ?? null,
          generated: c.generated ? "ALWAYS" : null,
          identity: c.identity === "a" ? "ALWAYS" : c.identity === "d" ? "BY DEFAULT" : null,
          comment: c.comment ?? null,
        });
      }

      onStage?.("normalizing");
      const cons = await pool.query(
        `SELECT con.conrelid::text AS rel, con.conname AS name, con.contype AS type,
                con.conkey::int[] AS cols, con.confrelid::text AS ref, con.confkey::int[] AS refcols,
                con.confdeltype AS del, con.confupdtype AS upd,
                pg_catalog.pg_get_constraintdef(con.oid, true) AS def
         FROM pg_catalog.pg_constraint con
         WHERE con.conrelid = ANY($1::oid[]) AND con.contype IN ('p','f','u','c','x')
         ORDER BY con.conrelid, con.conname`,
        [oids]
      );
      const conRows = cons.rows as ConRow[];

      // Foreign keys may point at tables outside the selected schemas: resolve their names too.
      const externalOids = [...new Set(conRows.filter((c) => c.type === "f" && c.ref !== "0" && !entByOid.has(c.ref)).map((c) => c.ref))];
      const externalName = new Map<string, string>();
      if (externalOids.length) {
        const ext = await pool.query(`SELECT c.oid::text AS oid, n.nspname AS schema, c.relname AS name FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = ANY($1::oid[])`, [externalOids]);
        for (const r of ext.rows as { oid: string; schema: string; name: string }[]) { externalName.set(r.oid, `${r.schema}.${r.name}`); colName.set(r.oid, new Map()); }
        const extCols = await pool.query(`SELECT attrelid::text AS rel, attnum::int AS num, attname AS name FROM pg_catalog.pg_attribute WHERE attrelid = ANY($1::oid[]) AND attnum > 0 AND NOT attisdropped`, [externalOids]);
        for (const r of extCols.rows as { rel: string; num: number; name: string }[]) colName.get(r.rel)?.set(r.num, r.name);
      }
      const outside = new Set<string>();
      for (const c of conRows) {
        const ent = entByOid.get(c.rel);
        if (!ent) continue;
        const names = colName.get(c.rel)!;
        const columns = (c.cols ?? []).map((n) => names.get(n) ?? `#${n}`);
        const kind = c.type === "p" ? "primary_key" : c.type === "f" ? "foreign_key" : c.type === "u" ? "unique" : c.type === "x" ? "exclusion" : "check";
        const refEntity = c.type === "f" ? entByOid.get(c.ref)?.name ?? externalName.get(c.ref) ?? null : null;
        if (c.type === "f" && refEntity && !entByOid.has(c.ref)) outside.add(refEntity.split(".")[0]);
        ent.constraints.push({
          id: constraintId(ent.id, c.name), name: c.name, kind, columns,
          referencedEntity: refEntity,
          referencedColumns: c.type === "f" ? (c.refcols ?? []).map((n) => colName.get(c.ref)?.get(n) ?? `#${n}`) : [],
          onDelete: c.type === "f" ? FK_ACTION[c.del] ?? null : null,
          onUpdate: c.type === "f" ? FK_ACTION[c.upd] ?? null : null,
          definition: kind === "check" || kind === "exclusion" ? c.def : null,
        });
        if (kind === "primary_key") for (const f of ent.fields) if (columns.includes(f.name)) { f.isPrimaryKey = true; f.nullable = false; }
        if (kind === "unique" && columns.length === 1) { const f = ent.fields.find((x) => x.name === columns[0]); if (f) f.isUnique = true; }
      }
      if (outside.size) model.warnings.push(`Foreign keys reference tables in schema${outside.size > 1 ? "s" : ""} outside this scan: ${[...outside].join(", ")}. Add ${outside.size > 1 ? "them" : "it"} to the selection for a complete relationship graph.`);

      const idx = await pool.query(
        `SELECT i.indrelid::text AS rel, ic.relname AS name, i.indisunique AS is_unique, i.indisprimary AS is_primary, i.indisvalid AS is_valid,
                am.amname AS method,
                coalesce((to_jsonb(i)->>'indnkeyatts')::int, i.indnatts::int) AS nkeys,
                ARRAY(SELECT pg_catalog.pg_get_indexdef(i.indexrelid, k, true) FROM generate_series(1, i.indnatts::int) AS k ORDER BY k) AS cols,
                string_to_array(i.indkey::text, ' ')::int[] AS attnums,
                pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS predicate,
                pg_catalog.pg_get_indexdef(i.indexrelid) AS def,
                s.idx_scan::float8 AS scans
         FROM pg_catalog.pg_index i
         JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
         JOIN pg_catalog.pg_am am ON am.oid = ic.relam
         LEFT JOIN pg_catalog.pg_stat_all_indexes s ON s.indexrelid = i.indexrelid
         WHERE i.indrelid = ANY($1::oid[])
         ORDER BY i.indrelid, ic.relname`,
        [oids]
      );
      for (const r of idx.rows as IdxRow[]) {
        const ent = entByOid.get(r.rel);
        if (!ent) continue;
        const all = (r.cols ?? []).map(unquote);
        ent.indexes.push({
          id: indexId(ent.id, r.name), name: r.name,
          columns: all.slice(0, r.nkeys), includeColumns: all.length > r.nkeys ? all.slice(r.nkeys) : undefined,
          method: r.method, unique: r.is_unique, partial: Boolean(r.predicate), predicate: r.predicate ?? null,
          expression: (r.attnums ?? []).slice(0, r.nkeys).some((n) => n === 0),
          definition: r.def, usageCount: typeof r.scans === "number" ? r.scans : null,
          ...(r.is_valid ? {} : { kind: "invalid" }),
        });
      }

      // best-effort extras — never fatal
      try {
        const parts = await pool.query(`SELECT inhparent::text AS parent, count(*)::int AS n FROM pg_catalog.pg_inherits WHERE inhparent = ANY($1::oid[]) GROUP BY inhparent`, [oids]);
        for (const r of parts.rows as { parent: string; n: number }[]) { const ent = entByOid.get(r.parent); if (ent) ent.metadata.partitions = r.n; }
        const ext = await pool.query(`SELECT extname FROM pg_catalog.pg_extension WHERE extname <> 'plpgsql' ORDER BY 1`);
        model.catalog.extensions = (ext.rows as { extname: string }[]).map((r) => r.extname);
        const enums = await pool.query(
          `SELECT n.nspname AS namespace, t.typname AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
           FROM pg_catalog.pg_type t JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = ANY($1::text[]) GROUP BY 1, 2 ORDER BY 1, 2`,
          [selected]
        );
        model.catalog.enums = (enums.rows as { namespace: string; name: string; labels: string[] }[]).map((r) => ({ namespace: r.namespace, name: r.name, values: r.labels ?? [] }));
      } catch {
        model.sourceMetadata.limitations.push("Extensions, enum types and partition counts could not be read with this role.");
      }
    }

    const tables = model.entities.filter((e) => e.kind === "table");
    if (tables.length && tables.every((e) => e.rowEstimate === null)) model.sourceMetadata.limitations.push("Row estimates come from pg_class.reltuples and are empty until the tables have been ANALYZEd.");
    if (partitionChildren) model.sourceMetadata.limitations.push(`${partitionChildren} partition${partitionChildren === 1 ? "" : "s"} are represented by their partitioned parent table.`);
    if (excluded.length) model.sourceMetadata.limitations.push(`${excluded.length} schema${excluded.length === 1 ? "" : "s"} with objects ${excluded.length === 1 ? "was" : "were"} not part of this scan: ${excluded.map((s) => s.name).slice(0, 12).join(", ")}${excluded.length > 12 ? "…" : ""}.`);
    model.sourceMetadata.limitations.push("Runtime workload (pg_stat_statements, EXPLAIN) requires extra grants; schema-evidence only unless provided.");
    deriveExplicitRelationships(model);
    return model;
  } finally {
    await pool.end().catch(() => undefined);
  }
}
