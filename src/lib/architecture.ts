import type { EntityModel, FieldModel, SchemaModel, Severity } from "./schema-model";

// ─── System architecture analysis ──────────────────────────────────
// Real systems rarely run on one database, and one database rarely has one
// schema. This module looks *across* the stores of a project:
//   store  →  namespaces (schemas / databases / logical dbs)  →  entities
// It derives the schema-dependency graph inside each store, infers references
// and copies between stores, and applies deterministic architecture rules.
// Pure (types-only imports) so the constants are safe in client bundles.

export type StoreRole = "primary" | "service" | "replica" | "cache" | "session" | "queue" | "search" | "analytics" | "archive" | "other";

export const STORE_ROLES: { id: StoreRole; label: string; hint: string; tier: 0 | 1 | 2 }[] = [
  { id: "primary", label: "System of record", hint: "Authoritative source for its data", tier: 1 },
  { id: "service", label: "Service database", hint: "Owned by one service or bounded context", tier: 1 },
  { id: "cache", label: "Cache", hint: "Disposable copy, rebuilt from a source", tier: 0 },
  { id: "session", label: "Sessions / ephemeral", hint: "Short-lived state that should expire", tier: 0 },
  { id: "queue", label: "Queue / stream", hint: "Work or event transport", tier: 0 },
  { id: "replica", label: "Read replica", hint: "Read-only copy of another store", tier: 2 },
  { id: "search", label: "Search index", hint: "Derived, query-optimised copy", tier: 2 },
  { id: "analytics", label: "Analytics / warehouse", hint: "Derived, read-optimised copy", tier: 2 },
  { id: "archive", label: "Archive", hint: "Cold or historical data", tier: 2 },
  { id: "other", label: "Other", hint: "Anything else", tier: 1 },
];

export const FLOW_KINDS: { id: string; label: string; hint: string }[] = [
  { id: "cache_aside", label: "Cache-aside", hint: "Read on miss, invalidate on write" },
  { id: "write_through", label: "Write-through", hint: "Every write updates both" },
  { id: "replication", label: "Replication", hint: "Engine-level streaming copy" },
  { id: "cdc", label: "CDC / outbox", hint: "Change stream from the source of truth" },
  { id: "etl", label: "Batch ETL", hint: "Scheduled bulk copy" },
  { id: "events", label: "Events / queue", hint: "Asynchronous messages" },
  { id: "dual_write", label: "Dual write", hint: "Application writes to both stores" },
  { id: "reads", label: "Reads from", hint: "Queries the other store at runtime" },
];

const DERIVED_ROLES = new Set<string>(["replica", "cache", "session", "search", "analytics", "archive"]);
const ROLE_RANK: Record<string, number> = { primary: 0, service: 1, other: 2, replica: 3, analytics: 4, search: 4, archive: 5, queue: 6, session: 7, cache: 8 };

export function isStoreRole(v: unknown): v is StoreRole {
  return typeof v === "string" && STORE_ROLES.some((r) => r.id === v);
}
export function defaultRole(engine: string, existingRoles: string[]): StoreRole {
  if (engine === "redis") return "cache";
  return existingRoles.includes("primary") ? "service" : "primary";
}

export interface StoreInput { id: string; name: string; engine: string; role: string; description?: string | null; model: SchemaModel | null; scanId?: string | null; designScore?: number | null; findingCount?: number | null; versions?: number }
export interface FlowInput { id: string; fromStoreId: string; toStoreId: string; kind: string; description?: string | null }

export interface NamespaceSummary { name: string; entities: number; tables: number; views: number; fields: number; rows: number | null; outbound: number; inbound: number; external?: boolean }
export interface SchemaEdge { from: string; to: string; count: number; examples: string[] }
export interface NamespaceGraph { namespaces: NamespaceSummary[]; edges: SchemaEdge[]; cycles: [string, string][] }

export interface StoreSummary extends NamespaceGraph {
  id: string; name: string; engine: string; role: string; description: string | null;
  hasModel: boolean; scanId: string | null; database: string | null; version: string | null;
  entities: number; fields: number; relationships: number; versions: number;
  designScore: number | null; findingCount: number | null; linkCount: number;
}
export interface CrossLink {
  id: string; kind: "reference" | "duplicate" | "cache";
  fromStoreId: string; fromEntity: string; fromField: string | null;
  toStoreId: string; toEntity: string; toField: string | null;
  confidence: number; reason: string; typeFrom?: string | null; typeTo?: string | null; typeMismatch: boolean; overlap?: number;
}
export interface ArchFinding { ruleId: string; severity: Severity; title: string; object: string; explanation: string; recommendation: string; evidence: Record<string, unknown>; storeIds: string[] }
export interface ArchitectureReport {
  stores: StoreSummary[]; links: CrossLink[]; findings: ArchFinding[]; score: number;
  totals: { stores: number; engines: number; namespaces: number; entities: number; links: number; flows: number; crossSchemaEdges: number };
  limitations: string[];
}

// ── naming helpers ──
const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[\s\-.]+/g, "_").toLowerCase();
function singular(w: string): string {
  if (w.length > 3 && /ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 2 && /s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}
const isParam = (seg: string) => /^\{.+\}$/.test(seg);

/** The business noun an entity stores: `auth.users` → user, `cache:product:{product_id}` → product. */
function entityBase(e: EntityModel): string | null {
  if (e.kind === "keyspace") {
    const segs = e.shortName.split(/[:/]/);
    if (segs.length >= 2 && isParam(segs[segs.length - 1]) && !isParam(segs[segs.length - 2])) return singular(snake(segs[segs.length - 2]));
    return null;
  }
  return singular(snake(e.shortName));
}
function refBase(fieldName: string): string | null {
  const m = snake(fieldName).match(/^(.+?)_(id|ids|uuid|key|ref)$/);
  return m ? singular(m[1]) : null;
}
function keyFieldOf(e: EntityModel): FieldModel | null {
  const pk = e.constraints.find((c) => c.kind === "primary_key");
  if (pk && pk.columns.length === 1) return e.fields.find((f) => f.name === pk.columns[0]) ?? null;
  const flagged = e.fields.filter((f) => f.isPrimaryKey);
  if (flagged.length === 1) return flagged[0];
  return e.fields.find((f) => f.name === "_id" || f.name === "id") ?? null;
}
type KeyFamily = "uuid" | "int" | "objectid" | "string" | "unknown";
function keyFamily(type: string | null | undefined, comment?: string | null): KeyFamily {
  const s = (type ?? "").toLowerCase();
  if (!s || s === "key" || s === "mixed" || comment === "key segment") return "unknown";
  if (/uuid/.test(s)) return "uuid";
  if (/objectid/.test(s)) return "objectid";
  if (/int|serial|long|number|numeric|decimal|double|float/.test(s)) return "int";
  if (/char|text|string/.test(s)) return "string";
  return "unknown";
}
function compatible(a: KeyFamily, b: KeyFamily): boolean {
  if (a === b || a === "unknown" || b === "unknown") return true;
  const pair = [a, b].sort().join("|");
  return pair === "string|uuid" || pair === "objectid|string";
}
function flatFields(fields: FieldModel[], prefix = "", depth = 0): { path: string; field: FieldModel }[] {
  const out: { path: string; field: FieldModel }[] = [];
  for (const f of fields) {
    out.push({ path: prefix + f.name, field: f });
    if (f.nested?.length && depth < 2) out.push(...flatFields(f.nested, `${prefix}${f.name}.`, depth + 1));
  }
  return out;
}
const NOISE_FIELDS = new Set(["id", "_id", "key", "created_at", "updated_at", "deleted_at"]);
function fieldOverlap(a: EntityModel, b: EntityModel): number {
  const names = (e: EntityModel) => new Set(e.fields.map((f) => snake(f.name)).filter((n) => !NOISE_FIELDS.has(n)));
  const x = names(a), y = names(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const n of x) if (y.has(n)) shared++;
  return shared / (x.size + y.size - shared);
}

// ── inside one store: the schema dependency graph ──
export function namespaceGraph(model: SchemaModel): NamespaceGraph {
  const byName = new Map(model.entities.map((e) => [e.name, e]));
  const summary = new Map<string, NamespaceSummary>();
  const ensure = (name: string, external = false) => {
    let s = summary.get(name);
    if (!s) { s = { name, entities: 0, tables: 0, views: 0, fields: 0, rows: null, outbound: 0, inbound: 0, ...(external ? { external: true } : {}) }; summary.set(name, s); }
    return s;
  };
  for (const ns of model.namespaces) ensure(ns);
  for (const e of model.entities) {
    const s = ensure(e.namespace);
    s.entities++;
    if (e.kind === "view" || e.kind === "materialized_view") s.views++; else s.tables++;
    s.fields += e.fields.length;
    if (typeof e.rowEstimate === "number") s.rows = (s.rows ?? 0) + e.rowEstimate;
  }
  const edges = new Map<string, SchemaEdge>();
  for (const r of model.relationships) {
    const from = byName.get(r.fromEntity);
    if (!from) continue;
    const to = byName.get(r.toEntity);
    const toNs = to?.namespace ?? (r.toEntity.includes(".") ? r.toEntity.split(".")[0] : from.namespace);
    if (toNs === from.namespace) continue;
    if (!to) ensure(toNs, true);
    const key = `${from.namespace}\u0000${toNs}`;
    const edge = edges.get(key) ?? { from: from.namespace, to: toNs, count: 0, examples: [] };
    edge.count++;
    if (edge.examples.length < 4) edge.examples.push(`${from.shortName}.${r.fromColumns.join(",")} → ${to?.shortName ?? r.toEntity}.${r.toColumns.join(",")}`);
    edges.set(key, edge);
    ensure(from.namespace).outbound++;
    ensure(toNs).inbound++;
  }
  const list = [...edges.values()].sort((a, b) => b.count - a.count);
  const cycles: [string, string][] = [];
  for (const e of list) if (e.from < e.to && edges.has(`${e.to}\u0000${e.from}`)) cycles.push([e.from, e.to]);
  return { namespaces: [...summary.values()].sort((a, b) => b.entities - a.entities || a.name.localeCompare(b.name)), edges: list, cycles };
}

// ── across stores ──
interface Located { storeId: string; role: string; entity: EntityModel; base: string }

export function analyzeArchitecture(stores: StoreInput[], flows: FlowInput[]): ArchitectureReport {
  const storeById = new Map(stores.map((s) => [s.id, s]));
  const validFlows = flows.filter((f) => storeById.has(f.fromStoreId) && storeById.has(f.toStoreId));
  const flowBetween = (a: string, b: string) => validFlows.some((f) => (f.fromStoreId === a && f.toStoreId === b) || (f.fromStoreId === b && f.toStoreId === a));
  const rank = (role: string) => ROLE_RANK[role] ?? 2;

  // index every entity by the noun it stores
  const targets = new Map<string, Located[]>(); // tables / collections that can be referenced
  const keyspaces: Located[] = [];
  const localBases = new Map<string, Set<string>>();
  for (const s of stores) {
    const bases = new Set<string>();
    for (const e of s.model?.entities ?? []) {
      const base = entityBase(e);
      if (!base) continue;
      bases.add(base);
      const loc = { storeId: s.id, role: s.role, entity: e, base };
      if (e.kind === "keyspace") keyspaces.push(loc);
      else if (e.kind === "table" || e.kind === "collection") targets.set(base, [...(targets.get(base) ?? []), loc]);
    }
    localBases.set(s.id, bases);
  }

  const links = new Map<string, CrossLink>();
  const add = (l: CrossLink) => { if (!links.has(l.id)) links.set(l.id, l); };

  // 1) references: a field named like another store's entity key
  for (const s of stores) {
    for (const e of s.model?.entities ?? []) {
      const own = entityBase(e);
      const enforced = new Set(e.constraints.filter((c) => c.kind === "foreign_key").flatMap((c) => c.columns));
      for (const { path, field } of flatFields(e.fields)) {
        if (enforced.has(field.name)) continue;
        const base = refBase(field.name);
        if (!base || base === own) continue;
        // a table/collection with that name in the same store means it is a local reference
        if ((targets.get(base) ?? []).some((t) => t.storeId === s.id)) continue;
        const candidates = (targets.get(base) ?? []).filter((t) => t.storeId !== s.id).sort((a, b) => rank(a.role) - rank(b.role));
        if (!candidates.length) continue;
        const target = candidates[0];
        const key = keyFieldOf(target.entity);
        const from = keyFamily(field.isArray ? field.arrayOf : field.type, field.comment);
        const to = keyFamily(key?.type);
        const ok = compatible(from, to);
        let confidence = 0.6;
        if (rank(target.role) <= 1) confidence += 0.1;
        if (from !== "unknown" && to !== "unknown") confidence += ok ? 0.15 : -0.1;
        if (candidates.length > 1) confidence -= 0.1;
        add({
          id: `ref|${s.id}|${e.name}|${path}|${target.storeId}|${target.entity.name}`, kind: "reference",
          fromStoreId: s.id, fromEntity: e.name, fromField: path, toStoreId: target.storeId, toEntity: target.entity.name, toField: key?.name ?? null,
          confidence: Math.max(0.3, Math.min(0.95, Number(confidence.toFixed(2)))),
          reason: `${path} is named after ${target.entity.shortName}${key ? `.${key.name}` : ""}, which only exists in ${storeById.get(target.storeId)?.name ?? "another store"}${candidates.length > 1 ? ` (${candidates.length - 1} other candidate${candidates.length > 2 ? "s" : ""})` : ""}.`,
          typeFrom: field.comment === "key segment" ? null : field.type, typeTo: key?.type ?? null, typeMismatch: !ok,
        });
      }
    }
  }

  // 2) the same entity stored in two stores
  for (const [, located] of targets) {
    for (let i = 0; i < located.length; i++) for (let j = i + 1; j < located.length; j++) {
      let a = located[i], b = located[j];
      if (a.storeId === b.storeId) continue;
      if (rank(a.role) < rank(b.role)) [a, b] = [b, a]; // from = less authoritative
      const overlap = fieldOverlap(a.entity, b.entity);
      add({
        id: `dup|${a.storeId}|${a.entity.name}|${b.storeId}|${b.entity.name}`, kind: "duplicate",
        fromStoreId: a.storeId, fromEntity: a.entity.name, fromField: null, toStoreId: b.storeId, toEntity: b.entity.name, toField: null,
        confidence: Number((0.45 + overlap * 0.5).toFixed(2)), overlap: Number(overlap.toFixed(2)), typeMismatch: false,
        reason: `"${a.base}" is stored in both systems; ${Math.round(overlap * 100)}% of the field names overlap.`,
      });
    }
  }

  // 3) Redis keyspaces that hold a projection of an entity owned elsewhere
  for (const k of keyspaces) {
    const candidates = (targets.get(k.base) ?? []).filter((t) => t.storeId !== k.storeId).sort((a, b) => rank(a.role) - rank(b.role));
    if (!candidates.length) continue;
    const target = candidates[0];
    const key = keyFieldOf(target.entity);
    add({
      id: `cache|${k.storeId}|${k.entity.name}|${target.storeId}|${target.entity.name}`, kind: "cache",
      fromStoreId: k.storeId, fromEntity: k.entity.name, fromField: ((k.entity.metadata?.params as string[] | undefined) ?? []).slice(-1)[0] ?? null,
      toStoreId: target.storeId, toEntity: target.entity.name, toField: key?.name ?? null, confidence: 0.7, typeMismatch: false,
      reason: `Keys ${k.entity.shortName} are addressed by the identifier of ${target.entity.shortName}.`,
    });
  }

  const allLinks = [...links.values()].sort((a, b) => b.confidence - a.confidence);
  const findings: ArchFinding[] = [];
  const nameOf = (id: string) => storeById.get(id)?.name ?? "unknown store";
  const short = (entity: string) => entity;

  // ARCH-001 / ARCH-002 — duplicated entities
  for (const l of allLinks.filter((x) => x.kind === "duplicate")) {
    const a = storeById.get(l.fromStoreId)!, b = storeById.get(l.toStoreId)!;
    const declared = flowBetween(a.id, b.id);
    const derived = DERIVED_ROLES.has(a.role) || DERIVED_ROLES.has(b.role);
    if (declared || derived) {
      findings.push({
        ruleId: "ARCH-002", severity: "info", title: "Derived copy of an entity", object: `${nameOf(a.id)} · ${short(l.fromEntity)} ⇄ ${nameOf(b.id)} · ${short(l.toEntity)}`,
        explanation: `${l.fromEntity} and ${l.toEntity} hold the same entity${declared ? " and a data flow is declared between the stores" : ` and ${DERIVED_ROLES.has(a.role) ? a.name : b.name} is a derived store`}. Copies drift unless lag and failure handling are defined.`,
        recommendation: "Record the acceptable staleness, how a missed update is detected, and how the copy is rebuilt from the source.",
        evidence: { overlap: l.overlap, declaredFlow: declared }, storeIds: [a.id, b.id],
      });
    } else {
      findings.push({
        ruleId: "ARCH-001", severity: (l.overlap ?? 0) >= 0.5 ? "high" : "medium", title: "Entity stored in two systems with no declared sync", object: `${nameOf(a.id)} · ${short(l.fromEntity)} ⇄ ${nameOf(b.id)} · ${short(l.toEntity)}`,
        explanation: `${l.fromEntity} (${a.name}) and ${l.toEntity} (${b.name}) both store "${l.fromEntity.split(".").pop()}" and ${Math.round((l.overlap ?? 0) * 100)}% of their fields overlap, but no flow connects the two stores. Nothing states which one is the source of truth, so they can silently disagree.`,
        recommendation: "Choose one system of record, then declare how the other is populated (CDC/outbox, events or ETL) — or remove the duplicate.",
        evidence: { overlap: l.overlap, reason: l.reason }, storeIds: [a.id, b.id],
      });
    }
  }

  // ARCH-003 — key type mismatch across stores
  for (const l of allLinks.filter((x) => x.kind === "reference" && x.typeMismatch)) {
    findings.push({
      ruleId: "ARCH-003", severity: "medium", title: "Cross-store reference with incompatible key types", object: `${nameOf(l.fromStoreId)} · ${l.fromEntity}.${l.fromField}`,
      explanation: `${l.fromEntity}.${l.fromField} is ${l.typeFrom ?? "unknown"} but appears to reference ${l.toEntity}.${l.toField ?? "id"} (${l.typeTo ?? "unknown"}) in ${nameOf(l.toStoreId)}. Joins in application code need a conversion and lookups can miss.`,
      recommendation: "Store the identifier in the referencing store using the same representation as the owning store, or document the mapping explicitly.",
      evidence: { from: l.typeFrom, to: l.typeTo, confidence: l.confidence }, storeIds: [l.fromStoreId, l.toStoreId],
    });
  }

  // ARCH-004 — references no database can enforce (aggregated per store pair)
  const pairs = new Map<string, CrossLink[]>();
  for (const l of allLinks.filter((x) => x.kind === "reference")) pairs.set(`${l.fromStoreId}|${l.toStoreId}`, [...(pairs.get(`${l.fromStoreId}|${l.toStoreId}`) ?? []), l]);
  for (const [key, group] of pairs) {
    const [from, to] = key.split("|");
    findings.push({
      ruleId: "ARCH-004", severity: "low", title: `${group.length} reference${group.length === 1 ? "" : "s"} cross a database boundary`, object: `${nameOf(from)} → ${nameOf(to)}`,
      explanation: `${group.length} field${group.length === 1 ? "" : "s"} in ${nameOf(from)} point at rows owned by ${nameOf(to)}. No foreign key can span two databases, so deletes and failed writes leave orphans that nothing detects.`,
      recommendation: "Add a scheduled orphan check, propagate deletes through events or an outbox, and treat these identifiers as soft references in application code.",
      evidence: { references: group.slice(0, 8).map((l) => `${l.fromEntity}.${l.fromField} → ${l.toEntity}.${l.toField ?? "id"}`), inferred: true }, storeIds: [from, to],
    });
  }

  // ARCH-005 — nothing is the system of record
  if (stores.length >= 2 && !stores.some((s) => s.role === "primary")) {
    findings.push({
      ruleId: "ARCH-005", severity: "medium", title: "No system of record is designated", object: stores.map((s) => s.name).join(", "),
      explanation: `The project has ${stores.length} datastores but none is marked as the system of record, so ownership of shared data is undefined.`,
      recommendation: "Mark the authoritative store as “System of record”. Every other store should be a service database or a derived copy with a declared flow.",
      evidence: { roles: Object.fromEntries(stores.map((s) => [s.name, s.role])) }, storeIds: stores.map((s) => s.id),
    });
  }

  // ARCH-006 — ephemeral stores holding keys that never expire
  for (const s of stores.filter((x) => (x.role === "cache" || x.role === "session") && x.model)) {
    const persistent = s.model!.entities.filter((e) => {
      const ttl = e.metadata?.ttl as { known?: number; with?: number } | undefined;
      return e.kind === "keyspace" && ttl && (ttl.known ?? 0) > 0 && (ttl.with ?? 0) === 0;
    });
    if (!persistent.length) continue;
    const unowned = persistent.filter((e) => !allLinks.some((l) => l.fromStoreId === s.id && l.fromEntity === e.name));
    findings.push({
      ruleId: "ARCH-006", severity: unowned.length ? "high" : "medium", title: `${persistent.length} keyspace${persistent.length === 1 ? "" : "s"} in a ${s.role} store never expire`, object: s.name,
      explanation: `${s.name} is declared as a ${s.role} store, yet ${persistent.map((e) => e.shortName).slice(0, 6).join(", ")}${persistent.length > 6 ? "…" : ""} have no TTL.${unowned.length ? ` ${unowned.length} of them match no entity in any other store, so Redis may hold the only copy of that data.` : ""} Memory grows without bound and an eviction or restart loses state nothing else can rebuild.`,
      recommendation: "Set a TTL on cache and session keys. For data that must survive, move it to a durable store or declare this Redis as a system of record with persistence and backups.",
      evidence: { keyspaces: persistent.map((e) => e.shortName), withoutOwner: unowned.map((e) => e.shortName), maxmemoryPolicy: s.model!.catalog?.settings?.maxmemoryPolicy ?? null }, storeIds: [s.id],
    });
  }

  // ARCH-007 — a store with no captured schema
  for (const s of stores.filter((x) => !x.model)) {
    findings.push({
      ruleId: "ARCH-007", severity: "low", title: "Datastore has no captured schema", object: s.name,
      explanation: `${s.name} is part of the architecture but nothing has been imported or scanned for it, so it is invisible to cross-store analysis.`,
      recommendation: "Connect it read-only or import a schema dump from the Connect view.",
      evidence: { engine: s.engine, role: s.role }, storeIds: [s.id],
    });
  }

  // ARCH-008 — dual writes and two-way sync
  for (const f of validFlows) {
    const reverse = validFlows.find((g) => g.fromStoreId === f.toStoreId && g.toStoreId === f.fromStoreId);
    if (f.kind === "dual_write") {
      findings.push({
        ruleId: "ARCH-008", severity: "medium", title: "Dual write between stores", object: `${nameOf(f.fromStoreId)} → ${nameOf(f.toStoreId)}`,
        explanation: "The application writes to both stores itself. If the second write fails or the process dies between them, the stores diverge permanently and nothing replays the change.",
        recommendation: "Write to one store and derive the other with a transactional outbox or change-data-capture.",
        evidence: { flow: f.kind }, storeIds: [f.fromStoreId, f.toStoreId],
      });
    } else if (reverse && f.id < reverse.id && f.kind !== "reads" && reverse.kind !== "reads") {
      findings.push({
        ruleId: "ARCH-008", severity: "medium", title: "Two-way data flow between stores", object: `${nameOf(f.fromStoreId)} ⇄ ${nameOf(f.toStoreId)}`,
        explanation: "Data is declared to flow in both directions. Concurrent changes on each side need a conflict rule, otherwise the last writer silently wins.",
        recommendation: "Give each entity a single owning store, or document the conflict-resolution rule per entity.",
        evidence: { flows: [f.kind, reverse.kind] }, storeIds: [f.fromStoreId, f.toStoreId],
      });
    }
  }

  // ARCH-009 — derived stores with no declared source; ARCH-010 — isolated stores
  if (stores.length >= 2) {
    for (const s of stores) {
      const touched = allLinks.some((l) => l.fromStoreId === s.id || l.toStoreId === s.id);
      const hasFlow = validFlows.some((f) => f.fromStoreId === s.id || f.toStoreId === s.id);
      if (DERIVED_ROLES.has(s.role) && !validFlows.some((f) => f.toStoreId === s.id)) {
        findings.push({
          ruleId: "ARCH-009", severity: "low", title: "Derived store has no declared source", object: s.name,
          explanation: `${s.name} is a ${s.role} store, which by definition is filled from somewhere else, but no inbound data flow is documented.`,
          recommendation: "Declare the flow that populates it (cache-aside, replication, CDC, ETL…) so invalidation and rebuild paths are reviewable.",
          evidence: { role: s.role, inferredLinks: allLinks.filter((l) => l.fromStoreId === s.id).length }, storeIds: [s.id],
        });
      } else if (s.model && !touched && !hasFlow) {
        findings.push({
          ruleId: "ARCH-010", severity: "info", title: "Datastore is not connected to the rest of the system", object: s.name,
          explanation: `No shared entities, references or declared flows connect ${s.name} to the other stores. That is fine for an isolated bounded context, and worth confirming.`,
          recommendation: "If it exchanges data with another store, declare the flow; otherwise no action is needed.",
          evidence: {}, storeIds: [s.id],
        });
      }
    }
  }

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const penalty = findings.reduce((a, f) => a + ({ critical: 14, high: 9, medium: 5, low: 2, info: 0 } as Record<Severity, number>)[f.severity], 0);

  const summaries: StoreSummary[] = stores.map((s) => {
    const graph = s.model ? namespaceGraph(s.model) : { namespaces: [], edges: [], cycles: [] as [string, string][] };
    return {
      id: s.id, name: s.name, engine: s.engine, role: s.role, description: s.description ?? null,
      hasModel: Boolean(s.model), scanId: s.scanId ?? null, database: s.model?.database ?? null, version: s.model?.version ?? null,
      entities: s.model?.entities.length ?? 0, fields: s.model?.entities.reduce((a, e) => a + e.fields.length, 0) ?? 0, relationships: s.model?.relationships.length ?? 0,
      versions: s.versions ?? 0, designScore: s.designScore ?? null, findingCount: s.findingCount ?? null,
      linkCount: allLinks.filter((l) => l.fromStoreId === s.id || l.toStoreId === s.id).length,
      ...graph,
    };
  });

  return {
    stores: summaries, links: allLinks, findings,
    score: stores.length ? Math.max(5, Math.min(100, 100 - penalty)) : 0,
    totals: {
      stores: stores.length, engines: new Set(stores.map((s) => s.engine)).size,
      namespaces: summaries.reduce((a, s) => a + s.namespaces.filter((n) => !n.external).length, 0),
      entities: summaries.reduce((a, s) => a + s.entities, 0), links: allLinks.length, flows: validFlows.length,
      crossSchemaEdges: summaries.reduce((a, s) => a + s.edges.length, 0),
    },
    limitations: [
      "Cross-store links are inferred from entity and field names — they are candidates to confirm, not constraints.",
      "Data flows are declared by you; DB Architect does not observe replication or application traffic.",
    ],
  };
}
