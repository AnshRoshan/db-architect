"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Check, ClipboardCopy, Download, FileCode2, GitMerge, Layers, ListChecks, Loader2, Lock, Play, Save, Shuffle, Table2, Wand2 } from "lucide-react";
import { TRANSFORMABLE_ENGINES as ENGINE_LIST, ENGINES, engineLabel, isRelational, type Engine } from "@/lib/engines";
import type { TransformPlan } from "@/lib/transform";

type Plan = Omit<TransformPlan, "runtime">;
type Rows = Record<string, unknown>[];
type Preview = { mode: "synthetic" | "live"; masked: boolean; input: Record<string, Rows>; output: Record<string, Rows>; notes: string };
type Conn = { id: string; name: string; engine: string; status: string; hasCredentials?: boolean };
type Tab = "decisions" | "mapping" | "schema" | "data" | "runbook";
type Opts = { embed: "auto" | "none"; camelCase: boolean; arrays: "child_table" | "json" | "native"; nested: "flatten" | "json"; targetNamespace: string };

export interface StudioModel { engine: string; database: string; entities: { name: string; shortName: string }[] }

const KIND_STYLE: Record<string, string> = { embed: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300", reference: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300", flatten: "border-violet-200 bg-violet-500/10 text-violet-700", child_table: "border-violet-200 bg-violet-500/10 text-violet-700", info: "border-line bg-muted text-ink-muted", warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" };
const ACTION_STYLE: Record<string, string> = { copy: "bg-muted text-ink-muted", convert: "bg-sky-500/10 text-sky-700 dark:text-sky-300", flatten: "bg-violet-500/10 text-violet-700", embed: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300", reference: "bg-cyan-50 text-cyan-700", child_table: "bg-violet-500/10 text-violet-700", json: "bg-amber-500/10 text-amber-700 dark:text-amber-300", generate: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", drop: "bg-red-500/10 text-red-600" };

function triggerDownload(name: string, text: string) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }

export default function TransformStudio({ scanId, projectId, canWrite, model, initialTarget, onOpenScan, notify }: { scanId: string; projectId: string; canWrite: boolean; model: StudioModel | null; initialTarget?: string; onOpenScan: (scanId: string) => void; notify: (text: string, kind?: "success" | "error") => void }) {
  const source = model?.engine as Engine | undefined;
  const [target, setTarget] = useState<Engine | null>(null);
  const [opts, setOpts] = useState<Opts>({ embed: "auto", camelCase: true, arrays: "child_table", nested: "flatten", targetNamespace: "" });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<Tab>("decisions");
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conns, setConns] = useState<Conn[]>([]);
  const [mode, setMode] = useState<"synthetic" | "live">("synthetic");
  const [connId, setConnId] = useState("");
  const [limit, setLimit] = useState(4);
  const [mask, setMask] = useState(true);
  const [consent, setConsent] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [mapFilter, setMapFilter] = useState("");
  const [lossyOnly, setLossyOnly] = useState(false);

  useEffect(() => {
    setPlan(null); setPreview(null); setSaved(null); setErr("");
    if (!source) { setTarget(null); return; }
    const want = initialTarget && initialTarget !== source ? (initialTarget as Engine) : null;
    setTarget(want && want in ENGINES ? want : source === "mongodb" ? "postgres" : "mongodb");
  }, [scanId, source, initialTarget]);

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/v1/connections?projectId=${projectId}`).then((x) => x.json()).then((r) => setConns((r.connections ?? []).filter((c: Conn) => c.hasCredentials && c.status !== "revoked"))).catch(() => undefined);
  }, [projectId]);

  const optsKey = JSON.stringify(opts);
  const run = useCallback(async () => {
    if (!scanId || !target) return;
    setLoading(true); setErr(""); setPreview(null); setSaved(null);
    const r = await fetch("/api/v1/transform", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "plan", scanId, targetEngine: target, options: { ...opts, targetNamespace: opts.targetNamespace || undefined } }) }).then((x) => x.json()).catch(() => ({ error: "Could not reach the server" }));
    setLoading(false);
    if (r.plan) setPlan(r.plan); else { setPlan(null); setErr(r.error ?? "Could not build a plan"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId, target, optsKey]);
  useEffect(() => { const t = window.setTimeout(run, 250); return () => window.clearTimeout(t); }, [run]);

  async function save() {
    if (!target) return;
    setSaving(true);
    const r = await fetch("/api/v1/transform", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "plan", scanId, targetEngine: target, options: { ...opts, targetNamespace: opts.targetNamespace || undefined }, save: true, label: `${engineLabel(source ?? "")} → ${engineLabel(target)} design` }) }).then((x) => x.json()).catch(() => ({ error: "Could not reach the server" }));
    setSaving(false);
    if (r.saved) { setSaved(r.saved.scanId); notify("Target design saved as a new schema version — open it in Diagram, Analysis or Diff"); } else notify(r.error ?? "Could not save", "error");
  }
  async function runPreview() {
    if (!target) return;
    setPreviewing(true);
    const r = await fetch("/api/v1/transform", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", scanId, targetEngine: target, options: { ...opts, targetNamespace: opts.targetNamespace || undefined }, source: mode, connectionId: connId, limit, mask, consent }) }).then((x) => x.json()).catch(() => ({ error: "Could not reach the server" }));
    setPreviewing(false);
    if (r.output) setPreview(r); else notify(r.error ?? "Preview failed", "error");
  }

  const mappings = useMemo(() => (plan?.mappings ?? []).filter((m) => (!lossyOnly || m.lossy) && (!mapFilter || `${m.sourceEntity}.${m.sourceField} ${m.targetField}`.toLowerCase().includes(mapFilter.toLowerCase()))), [plan, mapFilter, lossyOnly]);
  const grouped = useMemo(() => { const g = new Map<string, typeof mappings>(); for (const m of mappings) g.set(m.sourceEntity, [...(g.get(m.sourceEntity) ?? []), m]); return [...g]; }, [mappings]);

  if (source === "redis") return <div className="surface p-12 text-center"><Shuffle className="mx-auto text-ink-muted/60" /><h3 className="mt-3 font-semibold text-ink">Redis key models are not transformed</h3><p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">A keyspace is not a schema, so there is nothing to convert. Pick a relational or document version in the top bar — or open Architecture to see how this Redis relates to your other stores.</p></div>;
  if (!model || !source) return <div className="surface p-12 text-center"><Shuffle className="mx-auto text-ink-muted/60" /><h3 className="mt-3 font-semibold">Select a schema version first</h3><p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">The Transformation Studio converts an analyzed schema into another database engine — schema, field mapping, sample data and an ETL runbook.</p></div>;

  const seg = (value: string, current: string, set: (v: string) => void, label: string, disabled = false) => <button disabled={disabled} onClick={() => set(value)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${current === value ? "bg-ink text-canvas" : "bg-muted text-ink-muted hover:bg-line"} disabled:opacity-40`}>{label}</button>;
  const toMongo = target === "mongodb";
  const fromMongo = source === "mongodb";

  return (
    <div className="space-y-5">
      {/* flow header */}
      <section className="surface p-5">
        <div className="grid items-center gap-4 lg:grid-cols-[220px_40px_1fr]">
          <div className="rounded-xl border border-line bg-muted p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Source</div>
            <div className="mt-1 flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: ENGINES[source].color }} /><span className="font-semibold">{engineLabel(source)}</span></div>
            <div className="mt-1 truncate font-mono text-xs text-ink-muted">{model.database}</div>
            <div className="mt-2 text-[11px] text-ink-muted">{model.entities.length} {fromMongo ? "collections" : "tables"}</div>
          </div>
          <ArrowRight className="mx-auto hidden text-ink-muted/60 lg:block" />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">Convert to</div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ENGINE_LIST.map((e) => { const same = e.id === source; return <button key={e.id} disabled={same} onClick={() => setTarget(e.id)} className={`rounded-xl border p-3 text-left transition ${target === e.id ? "border-slate-900 bg-ink text-canvas shadow-md" : same ? "cursor-not-allowed border-dashed border-line opacity-40" : "border-line hover:border-slate-300 hover:shadow-sm"}`}><div className="flex items-center gap-2 text-sm font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: e.color }} />{e.label}</div><div className={`mt-1 text-[10px] leading-4 ${target === e.id ? "text-ink-muted/60" : "text-ink-muted"}`}>{same ? "current engine" : e.tagline}</div></button>; })}
            </div>
          </div>
        </div>
        {target && <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line/60 pt-4">
          {toMongo && <><Opt label="Embed owned children">{seg("auto", opts.embed, (v) => setOpts({ ...opts, embed: v as Opts["embed"] }), "Auto")}{seg("none", opts.embed, (v) => setOpts({ ...opts, embed: v as Opts["embed"] }), "Never")}</Opt><Opt label="Field names">{seg("camel", opts.camelCase ? "camel" : "keep", (v) => setOpts({ ...opts, camelCase: v === "camel" }), "camelCase")}{seg("keep", opts.camelCase ? "camel" : "keep", (v) => setOpts({ ...opts, camelCase: v === "camel" }), "Keep")}</Opt></>}
          {fromMongo && isRelational(target) && <><Opt label="Arrays">{seg("child_table", opts.arrays, (v) => setOpts({ ...opts, arrays: v as Opts["arrays"] }), "Child tables")}{seg("json", opts.arrays, (v) => setOpts({ ...opts, arrays: v as Opts["arrays"] }), "JSON")}{seg("native", opts.arrays, (v) => setOpts({ ...opts, arrays: v as Opts["arrays"] }), "Native", target !== "postgres")}</Opt><Opt label="Nested objects">{seg("flatten", opts.nested, (v) => setOpts({ ...opts, nested: v as Opts["nested"] }), "Flatten")}{seg("json", opts.nested, (v) => setOpts({ ...opts, nested: v as Opts["nested"] }), "JSON")}</Opt></>}
          {isRelational(target) && target !== "sqlite" && <Opt label={target === "postgres" ? "Target schema" : "Target database"}><input value={opts.targetNamespace} onChange={(e) => setOpts({ ...opts, targetNamespace: e.target.value })} placeholder={target === "postgres" ? "public" : model.database} className="w-36 rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none focus:border-indigo-400" /></Opt>}
          {loading && <span className="ml-auto flex items-center gap-2 text-xs text-ink-muted"><Loader2 size={14} className="animate-spin" /> Planning…</span>}
        </div>}
      </section>

      {err && <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300"><AlertTriangle size={18} className="mt-0.5 shrink-0" />{err}</div>}

      {plan && !err && <>
        <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: .06 } } }} className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[["Entities", `${plan.stats.sourceEntities} → ${plan.stats.targetEntities}`, "slate"], ["Fields mapped", plan.stats.fieldsMapped, "slate"], ["Lossy conversions", plan.stats.lossy, plan.stats.lossy ? "amber" : "emerald"], ["Embedded", plan.stats.embedded, "indigo"], ["Risks / warnings", `${plan.stats.risks} / ${plan.stats.warnings}`, plan.stats.risks ? "amber" : "emerald"]].map(([l, v, c]) => <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} key={String(l)} className="surface p-4"><div className="text-[11px] font-semibold text-ink-muted">{l}</div><div className={`mt-1 text-xl font-bold tracking-tight ${c === "amber" ? "text-amber-600" : c === "emerald" ? "text-emerald-600" : c === "indigo" ? "text-indigo-600" : ""}`}>{String(v)}</div></motion.div>)}
        </motion.div>

        <div className="overflow-hidden surface">
          <div className="flex gap-1 overflow-x-auto border-b border-line/60 p-2">
            {([["decisions", "Decisions", GitMerge], ["mapping", "Field mapping", Layers], ["schema", "Target schema", Table2], ["data", "Live data", Wand2], ["runbook", "Runbook & ETL", ListChecks]] as const).map(([id, label, Icon]) => <button key={id} onClick={() => setTab(id)} className={`relative flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${tab === id ? "text-canvas" : "text-ink-muted hover:bg-muted"}`}>{tab === id && <motion.span layoutId="studio-tab" className="absolute inset-0 rounded-xl bg-ink" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}<Icon size={15} className="relative" /><span className="relative">{label}</span></button>)}
          </div>
          <div className="p-5"><AnimatePresence mode="wait"><motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .22 }}>
            {tab === "decisions" && <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
              <div className="space-y-2.5">
                <h3 className="text-sm font-bold">Design decisions</h3>
                {plan.decisions.map((d, i) => <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 10) * .05 }} className="rounded-xl border border-line/60 p-3.5"><div className="flex items-center gap-2"><span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${KIND_STYLE[d.kind]}`}>{d.kind.replace("_", " ")}</span><b className="text-[13px]">{d.title}</b></div><p className="mt-1.5 text-xs leading-5 text-ink-muted">{d.detail}</p></motion.div>)}
              </div>
              <div className="space-y-4">
                <div><h3 className="flex items-center gap-2 text-sm font-bold"><AlertTriangle size={15} className="text-amber-500" /> Risks to plan for</h3><ul className="mt-2 space-y-2">{plan.risks.map((r, i) => <li key={i} className="rounded-lg bg-amber-500/10 p-2.5 text-xs leading-5 text-amber-900">{r}</li>)}{!plan.risks.length && <li className="text-xs text-ink-muted">No structural risks detected.</li>}</ul></div>
                {plan.warnings.length > 0 && <div><h3 className="text-sm font-bold">Not carried over ({plan.warnings.length})</h3><ul className="mt-2 max-h-56 space-y-1.5 overflow-auto">{plan.warnings.map((w, i) => <li key={i} className="rounded-lg bg-muted p-2.5 text-xs leading-5 text-ink-muted">{w}</li>)}</ul></div>}
              </div>
            </div>}

            {tab === "mapping" && <div>
              <div className="mb-4 flex flex-wrap items-center gap-3"><input value={mapFilter} onChange={(e) => setMapFilter(e.target.value)} placeholder="Filter fields…" className="w-60 rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-indigo-400" /><label className="flex items-center gap-2 text-xs text-ink-muted"><input type="checkbox" checked={lossyOnly} onChange={(e) => setLossyOnly(e.target.checked)} /> Lossy conversions only</label><span className="ml-auto text-xs text-ink-muted">{mappings.length} of {plan.mappings.length}</span></div>
              <div className="space-y-4">{grouped.map(([entity, rows]) => <div key={entity} className="overflow-hidden rounded-xl border border-line/60"><div className="flex items-center gap-2 bg-muted px-4 py-2 text-xs font-bold"><Table2 size={13} className="text-ink-muted" /><span className="font-mono">{entity}</span><ArrowRight size={12} className="text-ink-muted/60" /><span className="font-mono text-indigo-600">{[...new Set(rows.map((r) => r.targetEntity))].join(", ")}</span></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-xs"><tbody>{rows.map((m, i) => <tr key={i} className="border-t border-slate-50"><td className="w-[22%] px-4 py-2 font-mono font-semibold">{m.sourceField}</td><td className="w-[14%] px-2 font-mono text-ink-muted">{m.sourceType}</td><td className="w-[4%] text-ink-muted/60"><ArrowRight size={12} /></td><td className="w-[22%] px-2 font-mono font-semibold text-indigo-700 dark:text-indigo-300">{m.targetField}</td><td className="w-[14%] px-2 font-mono text-ink-muted">{m.targetType}</td><td className="w-[10%] px-2"><span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${ACTION_STYLE[m.action]}`}>{m.action.replace("_", " ")}</span></td><td className="px-3 py-2 text-[11px] leading-4 text-ink-muted">{m.lossy && <span className="mr-1 rounded bg-amber-500/15 px-1 font-bold text-amber-700 dark:text-amber-300">LOSSY</span>}{m.note}</td></tr>)}</tbody></table></div></div>)}</div>
            </div>}

            {tab === "schema" && <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted p-3.5"><div className="min-w-0 flex-1"><div className="text-sm font-bold">Save this design as a schema version</div><p className="mt-0.5 text-xs text-ink-muted">Creates a new version you can open in Diagram, run Analysis on, or compare with Diff & Migrate. Nothing touches any database.</p></div>{saved ? <button onClick={() => onOpenScan(saved)} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white"><Check size={16} /> Open target diagram</button> : <button disabled={!canWrite || saving} onClick={save} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={15} />} Save as version</button>}</div>
              <Code title={`${engineLabel(plan.targetEngine)} ${plan.targetEngine === "mongodb" ? "script (mongosh)" : "DDL"}`} code={plan.ddl} file={`target-${plan.targetEngine}.${plan.targetEngine === "mongodb" ? "js" : "sql"}`} tall />
            </div>}

            {tab === "data" && <div className="space-y-5">
              <div className="grid gap-4 rounded-xl bg-muted p-4 lg:grid-cols-[1fr_auto]">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-ink-muted">Data source</span>{seg("synthetic", mode, (v) => setMode(v as "synthetic" | "live"), "Synthetic sample")}{seg("live", mode, (v) => setMode(v as "synthetic" | "live"), "Live connection", !canWrite)}</div>
                  {mode === "synthetic" ? <p className="text-xs leading-5 text-ink-muted">Plausible rows are generated from your schema — no real data involved. Foreign keys and references line up so embedding, flattening and child tables are visible.</p> : <div className="space-y-2">
                    <select value={connId} onChange={(e) => setConnId(e.target.value)} className="w-full max-w-md rounded-xl border border-line bg-elevated px-3 py-2 text-sm"><option value="">Choose a saved {engineLabel(source)} connection…</option>{conns.filter((c) => c.engine === source).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                    {conns.filter((c) => c.engine === source).length === 0 && <p className="text-xs text-amber-700 dark:text-amber-300">No saved {engineLabel(source)} connection in this project — save one on the Connect page.</p>}
                    <label className="flex items-start gap-2 text-xs leading-5 text-ink-muted"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" /><span><Lock size={11} className="mr-1 inline" />I am authorized to view real rows. A bounded sample is read inside a <b>read-only</b> transaction, shown once, and <b>never stored</b>. The read is audit-logged.</span></label>
                  </div>}
                  <div className="flex flex-wrap items-center gap-4 text-xs text-ink-muted"><label className="flex items-center gap-2">Rows per table <input type="range" min={1} max={10} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /> <b>{limit}</b></label><label className="flex items-center gap-2"><input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} /> Mask sensitive-looking text columns (keys are kept)</label></div>
                </div>
                <button disabled={previewing || (mode === "live" && (!connId || !consent))} onClick={runPreview} className="flex h-fit items-center justify-center gap-2 self-end rounded-xl bg-ink px-6 py-3 text-sm font-bold text-white disabled:opacity-40">{previewing ? <Loader2 size={16} className="animate-spin" /> : <Play size={15} />} Run transformation</button>
              </div>
              {preview ? <PreviewPane preview={preview} plan={plan} /> : <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-ink-muted">Run the transformation to watch source rows become {toMongo ? "documents" : "target rows"} — with every converter applied.</div>}
            </div>}

            {tab === "runbook" && <div className="space-y-5">
              <div className="grid gap-3 lg:grid-cols-2">{plan.runbook.map((p) => <div key={p.title} className="rounded-xl border border-line/60 p-4"><h4 className="text-sm font-bold">{p.title}</h4><ul className="mt-2 space-y-1.5">{p.steps.map((s, i) => <li key={i} className="flex gap-2 text-xs leading-5 text-ink-muted"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-300" /><span>{s.startsWith("npm i") || s.startsWith("export ") || s.startsWith("SELECT ") ? <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{s}</code> : s}</span></li>)}</ul></div>)}</div>
              <Code title={`ETL script — ${engineLabel(plan.sourceEngine)} → ${engineLabel(plan.targetEngine)} (Node.js)`} code={plan.etlScript} file={`etl_${plan.sourceEngine}_to_${plan.targetEngine}.cjs`} tall icon={<FileCode2 size={14} />} />
              <Code title="Validation queries" code={plan.validationQueries.join("\n")} file="validation.txt" />
              <p className="rounded-xl bg-amber-500/10 p-3 text-[11px] leading-5 text-amber-700 dark:text-amber-300"><b>Not executed by DB Architect.</b> The script reads the source with SELECT/find only and inserts idempotently into the target. Rehearse on a staging copy, compare counts and run orphan checks before cutover.</p>
            </div>}
          </motion.div></AnimatePresence></div>
        </div>
      </>}
    </div>
  );
}

function Opt({ label, children }: { label: string; children: React.ReactNode }) { return <div className="flex items-center gap-2"><span className="text-xs font-semibold text-ink-muted">{label}</span><div className="flex gap-1">{children}</div></div>; }

function Code({ title, code, file, tall, icon }: { title: string; code: string; file: string; tall?: boolean; icon?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950"><div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5"><span className="text-xs font-semibold text-slate-300">{icon}{title}</span><div className="ml-auto flex gap-1.5"><button onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="flex items-center gap-1 rounded-md bg-elevated/10 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-elevated/20">{copied ? <Check size={12} /> : <ClipboardCopy size={12} />}{copied ? "Copied" : "Copy"}</button><button onClick={() => triggerDownload(file, code)} className="flex items-center gap-1 rounded-md bg-elevated/10 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-elevated/20"><Download size={12} />Download</button></div></div><pre className={`scroll-thin overflow-auto p-4 font-mono text-[11px] leading-relaxed text-emerald-200 ${tall ? "max-h-[460px]" : "max-h-60"}`}>{code}</pre></div>;
}

function Cell({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="text-ink-muted/60">∅</span>;
  if (typeof v === "boolean") return <span className={v ? "text-emerald-600" : "text-ink-muted"}>{String(v)}</span>;
  const s = String(v);
  return <span title={s}>{s.length > 26 ? `${s.slice(0, 25)}…` : s}</span>;
}
function DataView({ rows }: { rows: Rows }) {
  if (!rows.length) return <div className="p-4 text-xs text-ink-muted">No rows</div>;
  const flat = rows.every((r) => Object.values(r).every((v) => v === null || typeof v !== "object"));
  if (!flat) return <pre className="scroll-thin max-h-80 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-ink">{JSON.stringify(rows, null, 2)}</pre>;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 10);
  return <div className="scroll-thin max-h-80 overflow-auto"><table className="w-full text-[11px]"><thead className="sticky top-0 bg-muted"><tr>{cols.map((c) => <th key={c} className="px-3 py-2 text-left font-mono font-semibold text-ink-muted">{c}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i} className="border-t border-slate-50">{cols.map((c) => <td key={c} className="px-3 py-1.5 font-mono"><Cell v={r[c]} /></td>)}</tr>)}</tbody></table></div>;
}
function Pane({ title, tone, names, rows, active, setActive }: { title: string; tone: string; names: string[]; rows: Record<string, Rows>; active: string; setActive: (n: string) => void }) {
  const total = names.reduce((a, n) => a + (rows[n]?.length ?? 0), 0);
  return <div className="min-w-0 overflow-hidden rounded-xl border border-line"><div className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold ${tone}`}>{title}<span className="ml-auto font-medium opacity-70">{total} rows/docs</span></div><div className="flex gap-1 overflow-x-auto border-b border-line/60 bg-elevated p-2">{names.map((n) => <button key={n} onClick={() => setActive(n)} className={`shrink-0 rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold ${active === n ? "bg-ink text-canvas" : "bg-muted text-ink-muted hover:bg-line"}`}>{n.split(".").pop()} <span className="opacity-60">{rows[n]?.length ?? 0}</span></button>)}</div><div className="bg-elevated"><DataView rows={rows[active] ?? []} /></div></div>;
}
function PreviewPane({ preview, plan }: { preview: Preview; plan: Plan }) {
  const inNames = Object.keys(preview.input), outNames = Object.keys(preview.output);
  const [a, setA] = useState(inNames[0] ?? "");
  const [b, setB] = useState(outNames[0] ?? "");
  useEffect(() => { setA(Object.keys(preview.input)[0] ?? ""); setB(Object.keys(preview.output)[0] ?? ""); }, [preview]);
  const nIn = inNames.reduce((s, n) => s + preview.input[n].length, 0), nOut = outNames.reduce((s, n) => s + preview.output[n].length, 0);
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 text-xs"><span className={`rounded-full px-2.5 py-1 font-bold ${preview.mode === "live" ? "bg-rose-50 text-rose-700" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>{preview.mode === "live" ? "LIVE DATA" : "SYNTHETIC"}{preview.masked ? " · masked" : ""}</span><span className="text-ink-muted">{nIn} source rows → {nOut} {plan.targetEngine === "mongodb" ? "documents" : "target rows"} across {outNames.length} {plan.targetEngine === "mongodb" ? "collections" : "tables"}</span><span className="ml-auto text-ink-muted">{preview.notes}</span></div>
    <div className="grid items-start gap-3 xl:grid-cols-[1fr_28px_1fr]">
      <Pane title={`SOURCE · ${engineLabel(plan.sourceEngine)}`} tone="bg-muted text-ink" names={inNames} rows={preview.input} active={a} setActive={setA} />
      <div className="hidden h-full items-center justify-center xl:flex"><ArrowRight className="text-ink-muted/60" /></div>
      <Pane title={`TARGET · ${engineLabel(plan.targetEngine)}`} tone="bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" names={outNames} rows={preview.output} active={b} setActive={setB} />
    </div>
    {plan.targetEngine === "mongodb" && <p className="text-[11px] text-ink-muted">Extended JSON: <code>{"{ \"$date\": … }"}</code> and <code>{"{ \"$numberDecimal\": … }"}</code> mark BSON types the ETL script creates natively.</p>}
  </div>;
}
