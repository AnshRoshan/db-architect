"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeftRight, ArrowRight, Box, Braces, ChevronRight, Database, FileText, KeyRound, Link2, ListTree, Network, ScanSearch, Sparkles, Table2 } from "lucide-react";
import { Card, Chip, EmptyState, EngineChip, SearchInput, Segmented, SeverityChip, TypeLabel, sev } from "@/components/ui";
import type { EntityT, FieldT, Finding, ModelT } from "./types";

type Tab = "fields" | "indexes" | "constraints" | "relationships" | "findings";

export default function ExplorerView({ model, findings, onOpenDiagram, onOpenAnalysis }: { model: ModelT | null; findings: Finding[]; onOpenDiagram: () => void; onOpenAnalysis: () => void }) {
  const [q, setQ] = useState("");
  const [ns, setNs] = useState("all");
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState<string>("");

  const findingsByEntity = useMemo(() => {
    const m = new Map<string, Finding[]>();
    for (const f of findings) for (const e of model?.entities ?? []) if (f.object === e.name || f.object.startsWith(`${e.name}.`) || f.object.split(/[ ,→]+/).includes(e.shortName)) m.set(e.name, [...(m.get(e.name) ?? []), f]);
    return m;
  }, [findings, model]);

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const r of model?.relationships ?? []) { d.set(r.fromEntity, (d.get(r.fromEntity) ?? 0) + 1); d.set(r.toEntity, (d.get(r.toEntity) ?? 0) + 1); }
    return d;
  }, [model]);

  const entities = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (model?.entities ?? []).filter((e) =>
      (ns === "all" || e.namespace === ns) && (kind === "all" || e.kind === kind) &&
      (!needle || e.name.toLowerCase().includes(needle) || e.fields.some((f) => f.name.toLowerCase().includes(needle))));
  }, [model, q, ns, kind]);

  useEffect(() => { if (entities.length && !entities.some((e) => e.name === selected)) setSelected(entities[0].name); }, [entities, selected]);

  if (!model) return <EmptyState icon={Database} title="No schema selected" hint="Import a schema or run a live scan from Connect, then pick a version in the top bar." />;

  const current = model.entities.find((e) => e.name === selected) ?? null;
  const kinds = [...new Set(model.entities.map((e) => e.kind))];
  const totalFields = model.entities.reduce((a, e) => a + e.fields.length, 0);
  const totalIdx = model.entities.reduce((a, e) => a + e.indexes.length, 0);

  return (
    <div className="space-y-4">
      {/* schema summary strip */}
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 !py-4">
        <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"><Database size={19} /></div><div><div className="font-mono text-sm font-bold text-ink">{model.database}</div><div className="mt-0.5 flex items-center gap-2"><EngineChip engine={model.engine} />{model.version && <span className="text-[11px] text-ink-muted">v{model.version.split(" ")[0]}</span>}</div></div></div>
        {[["Entities", model.entities.length], ["Fields", totalFields], ["Indexes", totalIdx], ["Relationships", model.relationships.length], ["Namespaces", model.namespaces.length]].map(([l, v]) => <div key={String(l)}><div className="text-lg font-bold tabular-nums text-ink">{v}</div><div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{l}</div></div>)}
        <div className="ml-auto flex gap-2"><button onClick={onOpenDiagram} className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-muted"><Network size={14} />Diagram</button><button onClick={onOpenAnalysis} className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-500"><ScanSearch size={14} />{findings.length} findings</button></div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
        {/* entity list */}
        <Card padded={false} className="flex max-h-[calc(100vh-15rem)] min-h-[420px] flex-col overflow-hidden">
          <div className="space-y-2.5 border-b border-line p-3">
            <SearchInput value={q} onChange={setQ} placeholder="Search tables and fields…" />
            <div className="flex gap-2">
              <select value={ns} onChange={(e) => setNs(e.target.value)} aria-label="Namespace" className="min-w-0 flex-1 rounded-lg border border-line bg-elevated px-2 py-1.5 text-xs text-ink"><option value="all">All namespaces</option>{model.namespaces.map((n) => <option key={n}>{n}</option>)}</select>
              {kinds.length > 1 && <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind" className="min-w-0 flex-1 rounded-lg border border-line bg-elevated px-2 py-1.5 text-xs text-ink"><option value="all">All kinds</option>{kinds.map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}</select>}
            </div>
            <div className="text-[11px] text-ink-muted">{entities.length} of {model.entities.length} entities</div>
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto p-2">
            {entities.map((e) => {
              const f = findingsByEntity.get(e.name) ?? [];
              const worst = f.length ? f.reduce((a, b) => (["critical", "high", "medium", "low", "info"].indexOf(a.severity) <= ["critical", "high", "medium", "low", "info"].indexOf(b.severity) ? a : b)).severity : null;
              const active = current?.name === e.name;
              return (
                <button key={e.id} onClick={() => setSelected(e.name)} aria-current={active} className={`group relative mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? "bg-indigo-500/10 ring-1 ring-inset ring-indigo-400/40" : "hover:bg-muted"}`}>
                  <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${e.kind === "collection" ? "bg-violet-500/12 text-violet-600 dark:text-violet-300" : "bg-sky-500/12 text-sky-600 dark:text-sky-300"}`}>{e.kind === "collection" ? <Braces size={15} /> : <Table2 size={15} />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5"><span className="truncate font-mono text-[13px] font-semibold text-ink">{e.shortName}</span>{worst && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sev(worst).dot}`} title={`${f.length} finding(s)`} />}</div>
                    <div className="mt-0.5 truncate text-[11px] text-ink-muted">{e.fields.length} fields · {e.indexes.length} idx · {degree.get(e.name) ?? 0} links{e.rowEstimate ? ` · ~${Intl.NumberFormat("en", { notation: "compact" }).format(e.rowEstimate)} rows` : ""}</div>
                  </div>
                  <ChevronRight size={14} className={`shrink-0 transition ${active ? "text-indigo-500" : "text-ink-muted/40 group-hover:text-ink-muted"}`} />
                </button>
              );
            })}
            {!entities.length && <p className="p-6 text-center text-xs text-ink-muted">Nothing matches “{q}”.</p>}
          </div>
        </Card>

        {/* entity detail */}
        <AnimatePresence mode="wait">
          {current ? <motion.div key={current.name} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: .2 }}><EntityDetail e={current} model={model} findings={findingsByEntity.get(current.name) ?? []} onSelect={setSelected} /></motion.div> : <EmptyState title="Select an entity" hint="Pick a table or collection on the left." />}
        </AnimatePresence>
      </div>

      {(model.warnings.length > 0 || model.sourceMetadata.limitations.length > 0) && (
        <Card className="!py-4">
          <div className="grid gap-4 md:grid-cols-2">
            {model.warnings.length > 0 && <div><div className="flex items-center gap-1.5 text-xs font-bold text-amber-600 dark:text-amber-400"><FileText size={13} />Import notes ({model.warnings.length})</div><ul className="mt-2 space-y-1 text-xs text-ink-muted">{model.warnings.slice(0, 6).map((w, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />{w}</li>)}</ul></div>}
            {model.sourceMetadata.limitations.length > 0 && <div><div className="flex items-center gap-1.5 text-xs font-bold text-ink"><Sparkles size={13} />Analysis limitations</div><ul className="mt-2 space-y-1 text-xs text-ink-muted">{model.sourceMetadata.limitations.map((w, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-muted" />{w}</li>)}</ul></div>}
          </div>
        </Card>
      )}
    </div>
  );
}

function FieldRow({ f, fks, depth = 0 }: { f: FieldT; fks: Set<string>; depth?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-t border-line/60 transition hover:bg-muted/50">
        <td className="py-2 pl-4 pr-2" style={{ paddingLeft: 16 + depth * 18 }}>
          <div className="flex items-center gap-2">
            {f.nested?.length ? <button onClick={() => setOpen((v) => !v)} aria-label="Toggle nested fields" className="text-ink-muted"><ChevronRight size={13} className={`transition ${open ? "rotate-90" : ""}`} /></button> : <span className="w-[13px]" />}
            <span className={`font-mono text-[12.5px] ${f.isPrimaryKey ? "font-bold text-ink" : "text-ink"}`}>{f.name}</span>
            {f.isPrimaryKey && <Chip className="bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300"><KeyRound size={10} />PK</Chip>}
            {fks.has(f.name) && <Chip className="bg-indigo-500/12 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300"><Link2 size={10} />FK</Chip>}
            {f.isUnique && !f.isPrimaryKey && <Chip className="bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300">UQ</Chip>}
          </div>
        </td>
        <td className="px-2"><TypeLabel type={f.isArray ? `${f.arrayOf ?? "mixed"}[]` : f.type} /></td>
        <td className="px-2 text-xs">{f.nullable ? <span className="text-ink-muted">nullable</span> : <span className="font-semibold text-ink">required</span>}</td>
        <td className="px-2 font-mono text-[11px] text-ink-muted">{f.defaultValue ?? "—"}</td>
        <td className="py-2 pl-2 pr-4">
          {f.presence !== undefined ? <div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.round((f.presence ?? 0) * 100)}%` }} /></div><span className="text-[11px] tabular-nums text-ink-muted">{Math.round((f.presence ?? 0) * 100)}%</span>{(f.bsonTypes?.filter((t) => t !== "null").length ?? 0) > 1 && <Chip className="bg-orange-500/12 text-orange-700 ring-orange-500/25 dark:text-orange-300" title={f.bsonTypes?.join(", ")}>mixed</Chip>}</div> : f.comment ? <span className="text-[11px] text-ink-muted">{f.comment}</span> : null}
        </td>
      </tr>
      {open && f.nested?.map((n) => <FieldRow key={n.name} f={n} fks={new Set()} depth={depth + 1} />)}
    </>
  );
}

function EntityDetail({ e, model, findings, onSelect }: { e: EntityT; model: ModelT; findings: Finding[]; onSelect: (name: string) => void }) {
  const [tab, setTab] = useState<Tab>("fields");
  const fks = new Set(e.constraints.filter((c) => c.kind === "foreign_key").flatMap((c) => c.columns));
  const rels = model.relationships.filter((r) => r.fromEntity === e.name || r.toEntity === e.name);
  const pk = e.constraints.find((c) => c.kind === "primary_key")?.columns ?? e.fields.filter((f) => f.isPrimaryKey).map((f) => f.name);
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="border-b border-line bg-gradient-to-br from-indigo-500/[.06] to-transparent p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className={`grid h-11 w-11 place-items-center rounded-xl ${e.kind === "collection" ? "bg-violet-500/15 text-violet-600 dark:text-violet-300" : "bg-sky-500/15 text-sky-600 dark:text-sky-300"}`}>{e.kind === "collection" ? <Braces size={20} /> : <Table2 size={20} />}</div>
          <div className="min-w-0 flex-1"><div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{e.namespace} · {e.kind.replace("_", " ")}</div><h2 className="mt-0.5 break-all font-mono text-xl font-bold text-ink">{e.shortName}</h2>{e.comment && <p className="mt-1 text-sm text-ink-muted">{e.comment}</p>}</div>
          <div className="flex flex-wrap gap-1.5">{pk.length ? <Chip className="bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300"><KeyRound size={10} />PK ({pk.join(", ")})</Chip> : <Chip className="bg-red-500/12 text-red-700 ring-red-500/25 dark:text-red-300">No primary key</Chip>}{e.rowEstimate ? <Chip className="bg-muted text-ink ring-line">~{e.rowEstimate.toLocaleString()} rows</Chip> : null}</div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <Segmented<Tab> layoutId={`entity-tab`} value={tab} onChange={setTab} options={[
            { value: "fields", label: <><ListTree size={13} />Fields</>, count: e.fields.length },
            { value: "indexes", label: <><Box size={13} />Indexes</>, count: e.indexes.length },
            { value: "constraints", label: <><KeyRound size={13} />Constraints</>, count: e.constraints.length },
            { value: "relationships", label: <><ArrowLeftRight size={13} />Relationships</>, count: rels.length },
            { value: "findings", label: <><ScanSearch size={13} />Findings</>, count: findings.length },
          ]} />
        </div>
      </div>
      <div className="min-h-[300px]">
        {tab === "fields" && (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left">
            <thead><tr className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted"><th className="py-2.5 pl-4 pr-2">Field</th><th className="px-2">Type</th><th className="px-2">Null</th><th className="px-2">Default</th><th className="py-2.5 pl-2 pr-4">{model.engine === "mongodb" ? "Presence" : "Notes"}</th></tr></thead>
            <tbody>{e.fields.map((f) => <FieldRow key={f.name} f={f} fks={fks} />)}</tbody>
          </table></div>
        )}
        {tab === "indexes" && <div className="grid gap-2 p-4 md:grid-cols-2">{e.indexes.map((ix) => <div key={ix.name} className="rounded-xl border border-line bg-muted/40 p-3.5"><div className="flex items-center gap-2"><Box size={14} className="text-ink-muted" /><span className="truncate font-mono text-[13px] font-semibold text-ink">{ix.name}</span><span className="ml-auto flex gap-1">{ix.unique && <Chip className="bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300">unique</Chip>}{ix.partial && <Chip className="bg-violet-500/12 text-violet-700 ring-violet-500/25 dark:text-violet-300">partial</Chip>}<Chip className="bg-muted text-ink-muted ring-line">{ix.method ?? "btree"}</Chip></span></div><div className="mt-2 flex flex-wrap gap-1">{ix.columns.map((c, i) => <span key={c + i} className="flex items-center gap-1 rounded-md bg-elevated px-2 py-0.5 font-mono text-[11px] text-ink ring-1 ring-line"><span className="text-ink-muted">{i + 1}</span>{c}</span>)}</div>{ix.predicate && <div className="mt-2 font-mono text-[11px] text-ink-muted">WHERE {ix.predicate.replace(/^WHERE\s+/i, "")}</div>}</div>)}{!e.indexes.length && <p className="col-span-2 py-10 text-center text-sm text-ink-muted">No indexes on this entity.</p>}</div>}
        {tab === "constraints" && <div className="space-y-2 p-4">{e.constraints.map((c) => <div key={c.name} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-muted/40 p-3.5"><Chip className={c.kind === "primary_key" ? "bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300" : c.kind === "foreign_key" ? "bg-indigo-500/12 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300" : c.kind === "unique" ? "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300" : "bg-muted text-ink ring-line"}>{c.kind.replace("_", " ")}</Chip><span className="font-mono text-[13px] font-semibold text-ink">{c.name}</span><span className="font-mono text-[12px] text-ink-muted">({c.columns.join(", ")})</span>{c.referencedEntity && <><ArrowRight size={13} className="text-ink-muted" /><button onClick={() => onSelect(c.referencedEntity!)} className="font-mono text-[12px] font-semibold text-indigo-600 hover:underline dark:text-indigo-300">{c.referencedEntity}({(c.referencedColumns ?? []).join(", ")})</button></>}{c.onDelete && <Chip className="bg-muted text-ink-muted ring-line">on delete {c.onDelete.toLowerCase()}</Chip>}{c.definition && <code className="w-full font-mono text-[11px] text-ink-muted">{c.definition}</code>}</div>)}{!e.constraints.length && <p className="py-10 text-center text-sm text-ink-muted">No constraints declared.</p>}</div>}
        {tab === "relationships" && <div className="space-y-2 p-4">{rels.map((r) => { const outgoing = r.fromEntity === e.name; const other = outgoing ? r.toEntity : r.fromEntity; return <button key={r.id} onClick={() => onSelect(other)} className="group flex w-full flex-wrap items-center gap-2 rounded-xl border border-line bg-muted/40 p-3.5 text-left transition hover:border-indigo-400/50"><Chip className={outgoing ? "bg-indigo-500/12 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300" : "bg-sky-500/12 text-sky-700 ring-sky-500/25 dark:text-sky-300"}>{outgoing ? "references" : "referenced by"}</Chip><span className="font-mono text-[13px] font-semibold text-ink">{other}</span><span className="font-mono text-[11px] text-ink-muted">{r.fromColumns.join(", ")} → {r.toColumns.join(", ")}</span><span className="ml-auto flex items-center gap-1.5"><Chip className="bg-muted text-ink-muted ring-line">{r.cardinality}</Chip><Chip className={r.provenance === "explicit" ? "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300" : "bg-violet-500/12 text-violet-700 ring-violet-500/25 dark:text-violet-300"}>{r.provenance === "explicit" ? "enforced" : `inferred ${Math.round((r.confidence ?? .5) * 100)}%`}</Chip><ChevronRight size={14} className="text-ink-muted/50 group-hover:text-indigo-500" /></span></button>; })}{!rels.length && <p className="py-10 text-center text-sm text-ink-muted">No relationships touch this entity.</p>}</div>}
        {tab === "findings" && <div className="space-y-2 p-4">{findings.map((f) => <div key={f.id} className="rounded-xl border border-line bg-muted/40 p-3.5"><div className="flex flex-wrap items-center gap-2"><SeverityChip severity={f.severity} /><span className="text-[13px] font-semibold text-ink">{f.title}</span><code className="ml-auto text-[10px] text-ink-muted">{f.ruleId}</code></div><p className="mt-1.5 text-xs leading-5 text-ink-muted">{f.recommendation}</p></div>)}{!findings.length && <p className="py-10 text-center text-sm text-ink-muted">No findings on this entity.</p>}</div>}
      </div>
    </Card>
  );
}
