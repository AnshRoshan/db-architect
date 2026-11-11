import { createHash } from "crypto";

// ─── Canonical internal schema model (v1) ───────────────────────────
// Preserves engine-specific metadata; Mongo is NOT forced relational.

export const SCHEMA_MODEL_VERSION = "1.0.0";

import type { Engine } from "./engines";
export type { Engine };
export type EvidenceLevel = "schema" | "statistics" | "workload" | "sample" | "heuristic";
export type Severity = "critical" | "high" | "medium" | "low" | "info";

export interface FieldModel {
  id: string;
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string | null;
  isPrimaryKey?: boolean;
  isUnique?: boolean;
  comment?: string | null;
  // postgres extras
  generated?: string | null;
  identity?: string | null;
  // mongo extras
  bsonTypes?: string[];
  optional?: boolean; // estimated optionality (1 - presence)
  presence?: number; // 0..1 observed
  nested?: FieldModel[]; // embedded object shape
  isArray?: boolean;
  arrayOf?: string | null;
  sampleValues?: unknown[];
}

export interface IndexModel {
  id: string;
  name: string;
  columns: string[];
  method?: string; // btree, gin, gist, brin, text, 2dsphere, hashed...
  unique: boolean;
  partial?: boolean;
  predicate?: string | null;
  expression?: boolean;
  includeColumns?: string[];
  sortOrders?: string[];
  definition?: string | null;
  kind?: string; // ttl, text, geospatial, compound...
  ttlSeconds?: number | null;
  usageCount?: number | null;
}

export interface ConstraintModel {
  id: string;
  name: string;
  kind: "primary_key" | "foreign_key" | "unique" | "check" | "exclusion" | "validator" | "not_null";
  columns: string[];
  referencedEntity?: string | null;
  referencedColumns?: string[];
  onDelete?: string | null;
  onUpdate?: string | null;
  definition?: string | null;
}

export type RelProvenance = "explicit" | "inferred_schema" | "inferred_sample" | "user_confirmed";
export type Cardinality = "one-to-one" | "one-to-many" | "many-to-many";

export interface RelationshipModel {
  id: string;
  name: string;
  fromEntity: string;
  fromColumns: string[];
  toEntity: string;
  toColumns: string[];
  cardinality: Cardinality;
  optionality: "required" | "optional";
  provenance: RelProvenance;
  constraintName?: string | null;
  confidence?: number; // 0..1 for inferred
}

export interface EntityModel {
  id: string;
  name: string; // original name incl. schema prefix for pg e.g. public.orders
  shortName: string;
  namespace: string; // schema name or db name
  kind: "table" | "view" | "materialized_view" | "collection" | "foreign_table" | "keyspace";
  engine: Engine;
  fields: FieldModel[];
  indexes: IndexModel[];
  constraints: ConstraintModel[];
  comment?: string | null;
  rowEstimate?: number | null;
  metadata: Record<string, unknown>;
}

/** Catalog-level facts about the namespaces (schemas / databases / logical dbs) of a store. */
export interface NamespaceInfo {
  name: string;
  owner?: string | null;
  comment?: string | null;
  tables: number;
  views: number;
}
export interface SchemaCatalog {
  namespaces: NamespaceInfo[];
  /** Namespaces that exist on the server but were not part of this scan. */
  excludedNamespaces?: string[];
  extensions?: string[];
  enums?: { namespace: string; name: string; values: string[] }[];
  settings?: Record<string, string | number | null>;
}

export interface SchemaModel {
  schemaModelVersion: string;
  database: string;
  engine: Engine;
  version?: string | null;
  namespaces: string[];
  entities: EntityModel[];
  relationships: RelationshipModel[];
  dependencies: { from: string; to: string; kind: string }[];
  warnings: string[];
  catalog?: SchemaCatalog;
  sourceMetadata: {
    source: string;
    importedAt: string;
    sampleSize?: number | null;
    limitations: string[];
  };
}

export function stableId(...parts: string[]): string {
  return createHash("sha1").update(parts.join("::")).digest("hex").slice(0, 16);
}

export function entityId(engine: Engine, namespace: string, name: string): string {
  return stableId("entity", engine, namespace, name);
}
export function fieldId(eid: string, field: string): string {
  return stableId("field", eid, field);
}
export function indexId(eid: string, name: string): string {
  return stableId("index", eid, name);
}
export function constraintId(eid: string, name: string): string {
  return stableId("constraint", eid, name);
}
export function relId(from: string, fcols: string[], to: string, tcols: string[]): string {
  return stableId("rel", from, fcols.join(","), to, tcols.join(","));
}

export function emptyModel(engine: Engine, database: string): SchemaModel {
  return {
    schemaModelVersion: SCHEMA_MODEL_VERSION,
    database,
    engine,
    version: null,
    namespaces: [],
    entities: [],
    relationships: [],
    dependencies: [],
    warnings: [],
    sourceMetadata: {
      source: "unknown",
      importedAt: new Date().toISOString(),
      sampleSize: null,
      limitations: [],
    },
  };
}

export function modelStats(m: SchemaModel) {
  return {
    entities: m.entities.length,
    fields: m.entities.reduce((a, e) => a + e.fields.length, 0),
    indexes: m.entities.reduce((a, e) => a + e.indexes.length, 0),
    constraints: m.entities.reduce((a, e) => a + e.constraints.length, 0),
    relationships: m.relationships.length,
    namespaces: m.namespaces.length,
  };
}
