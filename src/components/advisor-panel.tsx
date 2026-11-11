"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Check, Compass, Layers, Lightbulb, RotateCcw, Sparkles, Trophy } from "lucide-react";
import { advise, CAP_LABEL, DEFAULT_PROFILE, deriveProfile, migrationHint, type Cap, type Need, type WorkloadProfile } from "@/lib/advisor";
import type { SchemaModel } from "@/lib/schema-model";

const OPTIONS: { key: keyof Omit<WorkloadProfile, "needs">; label: string; hint?: string; choices: [string, string][] }[] = [
  { key: "dataShape", label: "What does the data look like?", choices: [["relational", "Relational / transactional"], ["document", "Documents / JSON"], ["key_value", "Key-value / cache"], ["time_series", "Time-series / events"], ["search", "Search-centric"], ["analytics", "Analytics / BI"], ["graph", "Graph / relationships"], ["mixed", "A mix"]] },
  { key: "consistency", label: "Consistency", choices: [["strong", "Strong (ACID)"], ["eventual", "Eventual is fine"]] },
  { key: "scale", label: "Expected scale", choices: [["small", "< 10 GB"], ["medium", "10 GB – 1 TB"], ["large", "1 – 100 TB"], ["massive", "100 TB+ / global"]] },
  { key: "writes", label: "Traffic shape", choices: [["read_heavy", "Read-heavy"], ["balanced", "Balanced"], ["write_heavy", "Write-heavy"]] },
  { key: "queries", label: "Dominant queries", choices: [["key_lookup", "Key lookups"], ["joins", "Ad-hoc joins"], ["aggregations", "Aggregations"], ["full_text", "Full-text"], ["mixed", "Mixed"]] },
  { key: "schema", label: "Schema", choices: [["stable", "Stable"], ["evolving", "Evolving fast"]] },
  { key: "latency", label: "Latency target", choices: [["relaxed", "Seconds OK"], ["low", "< 50 ms"], ["ultra_low", "< 5 ms"]] },
  { key: "deployment", label: "Where will it run?", choices: [["any", "No preference"], ["embedded", "Embedded / on-device"], ["managed_cloud", "Managed cloud"], ["self_hosted", "Self-hosted"]] },
  { key: "stack", label: "Ecosystem preference", choices: [["any", "None"], ["microsoft", "Microsoft / .NET"], ["aws", "AWS-native"], ["open_source_only", "Open-source only"]] },
];
const NEEDS: [Need, string][] = [["transactions", "Multi-row transactions"], ["json", "JSON documents"], ["geo", "Geospatial"], ["full_text", "Full-text search"], ["multi_region", "Multi-region writes"], ["offline", "Offline / local-first"], ["high_availability", "High availability"], ["analytics_sql", "SQL analytics"], ["time_series", "Time-series"], ["graph_traversal", "Graph traversal"], ["ttl", "Auto-expiring data"], ["serverless", "Serverless / scale-to-zero"]];
const FIT: Record<string, string> = { excellent: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", good: "bg-sky-500/10 text-sky-700 dark:text-sky-300", possible: "bg-amber-500/10 text-amber-700 dark:text-amber-300", poor: "bg-muted text-ink-muted" };
const SUPPORT: Record<string, [string, string]> = { full: ["Fully supported", "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"], import: ["Import & transform", "bg-sky-500/10 text-sky-700 dark:text-sky-300"], planned: ["Adapter planned", "bg-amber-500/10 text-amber-700 dark:text-amber-300"], advisor: ["Advice only", "bg-muted text-ink-muted"] };

export default function AdvisorPanel({ model, onTransform }: { model: unknown | null; onTransform: (target: string) => void }) {
  const m = model as SchemaModel | null;
  const [profile, setProfile] = useState<WorkloadProfile>(DEFAULT_PROFILE);
  const [signals, setSignals] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const result = useMemo(() => advise(profile), [profile]);
  const top = result.ranked[0];

  function prefill() {
    if (!m) return;
    const d = deriveProfile(m);
    setProfile({ ...DEFAULT_PROFILE, ...d.profile, needs: d.profile.needs ?? [] });
    setSignals(d.signals);
  }
  const setKey = (k: string, v: string) => setProfile((p) => ({ ...p, [k]: v }) as WorkloadProfile);
  const toggle = (n: Need) => setProfile((p) => ({ ...p, needs: p.needs.includes(n) ? p.needs.filter((x) => x !== n) : [...p.needs, n] }));
  const weighted = (Object.entries(result.weights) as [Cap, number][]).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <div className="grid gap-5 xl:grid-cols-[400px_1fr]">
      <aside className="h-fit space-y-5 surface p-5 xl:sticky xl:top-24">
        <div className="flex items-center gap-2"><Compass size={18} className="text-indigo-500" /><h2 className="text-sm font-bold">Describe the workload</h2><button onClick={() => { setProfile(DEFAULT_PROFILE); setSignals([]); }} className="ml-auto rounded-lg p-1.5 text-ink-muted hover:bg-muted" title="Reset"><RotateCcw size={14} /></button></div>
        {m && <button onClick={prefill} className="flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 py-2.5 text-sm font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/15"><Sparkles size={15} /> Prefill from “{m.database}”</button>}
        {signals.length > 0 && <ul className="space-y-1 rounded-xl bg-muted p-3">{signals.map((s, i) => <li key={i} className="flex gap-2 text-[11px] leading-4 text-ink-muted"><Check size={12} className="mt-0.5 shrink-0 text-emerald-500" />{s}</li>)}</ul>}
        {OPTIONS.map((o) => <div key={o.key}><div className="mb-1.5 text-xs font-semibold text-ink-muted">{o.label}</div><div className="flex flex-wrap gap-1.5">{o.choices.map(([v, l]) => <button key={v} onClick={() => setKey(o.key, v)} className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${profile[o.key] === v ? "border-slate-900 bg-ink text-canvas" : "border-line text-ink-muted hover:border-slate-300"}`}>{l}</button>)}</div></div>)}
        <div><div className="mb-1.5 text-xs font-semibold text-ink-muted">Must-haves</div><div className="flex flex-wrap gap-1.5">{NEEDS.map(([v, l]) => <button key={v} onClick={() => toggle(v)} className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${profile.needs.includes(v) ? "border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" : "border-line text-ink-muted hover:border-slate-300"}`}>{l}</button>)}</div></div>
      </aside>

      <div className="min-w-0 space-y-5">
        <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-2xl bg-[#101828] p-6 text-white"><div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-indigo-600/25 blur-3xl" />
          <div className="flex items-start gap-4"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-400/15 text-amber-300"><Trophy size={22} /></div><div className="min-w-0"><div className="text-[11px] font-bold uppercase tracking-widest text-indigo-300">Best fit for this workload</div><h2 className="mt-1 text-2xl font-semibold tracking-tight">{top.label} <span className="ml-2 text-lg font-medium text-slate-400">{top.score}/100</span></h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{result.summary}</p></div></div>
          {m && m.engine !== top.id && <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-300"><Layers size={14} className="text-indigo-300" />You are currently on <b>{m.engine}</b>. {migrationHint(m.engine, top.id).message}{migrationHint(m.engine, top.id).supported && <button onClick={() => onTransform(top.id)} className="ml-auto flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 font-bold text-white hover:bg-indigo-400">Plan migration <ArrowRight size={13} /></button>}</div>}
        </motion.section>

        {result.polyglot.length > 0 && <section className="surface p-5"><h3 className="flex items-center gap-2 text-sm font-bold"><Lightbulb size={16} className="text-amber-500" /> Consider a polyglot setup</h3><div className="mt-3 grid gap-3 md:grid-cols-2">{result.polyglot.map((p) => <div key={p.db} className="rounded-xl border border-line/60 bg-muted p-4"><div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">{p.role}</div><div className="mt-1 text-sm font-semibold">{p.db}</div><p className="mt-1 text-xs leading-5 text-ink-muted">{p.reason}</p></div>)}</div></section>}

        <section className="space-y-3">
          <AnimatePresence initial={false}>{result.ranked.map((r) => { const expanded = open === r.id || r.rank === 1; const mh = m ? migrationHint(m.engine, r.id) : null; return (
            <motion.article layout key={r.id} transition={{ type: "spring", stiffness: 300, damping: 30 }} className={`rounded-2xl border bg-elevated p-5 ${r.rank === 1 ? "border-indigo-400/50 shadow-md shadow-indigo-500/10" : "border-line"}`}>
              <button className="flex w-full items-center gap-4 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted text-sm font-bold text-ink-muted">{r.rank}</div>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-[15px] font-bold">{r.label}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${FIT[r.fit]}`}>{r.fit}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SUPPORT[r.toolSupport][1]}`}>{SUPPORT[r.toolSupport][0]}</span></div><div className="mt-0.5 truncate text-xs text-ink-muted">{r.tagline}</div></div>
                <div className="hidden w-44 sm:block"><div className="h-2 overflow-hidden rounded-full bg-muted"><motion.div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" initial={false} animate={{ width: `${r.score}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} /></div></div>
                <div className="w-10 text-right text-lg font-bold tabular-nums">{r.score}</div>
              </button>
              {expanded && <div className="mt-4 grid gap-4 border-t border-line/60 pt-4 md:grid-cols-2">
                <div><h4 className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">Why it fits</h4><ul className="mt-2 space-y-1.5 text-xs leading-5 text-ink-muted">{r.why.length ? r.why.map((w, i) => <li key={i} className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-emerald-500" />{w}</li>) : <li className="text-ink-muted">No standout strengths for this profile.</li>}</ul><h4 className="mt-4 text-[11px] font-bold uppercase tracking-wider text-ink-muted">Best for</h4><ul className="mt-2 space-y-1 text-xs text-ink-muted">{r.bestFor.map((b) => <li key={b}>• {b}</li>)}</ul></div>
                <div><h4 className="text-[11px] font-bold uppercase tracking-wider text-amber-600">Watch out for</h4><ul className="mt-2 space-y-1.5 text-xs leading-5 text-ink-muted">{r.watchOuts.map((w, i) => <li key={i} className="flex gap-2"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />{w}</li>)}</ul><h4 className="mt-4 text-[11px] font-bold uppercase tracking-wider text-ink-muted">Avoid when</h4><ul className="mt-2 space-y-1 text-xs text-ink-muted">{r.avoidWhen.map((b) => <li key={b}>• {b}</li>)}</ul></div>
                {mh?.supported && m && m.engine !== r.id && <div className="md:col-span-2"><button onClick={() => onTransform(r.id)} className="flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-xs font-bold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/15">Convert “{m.database}” to {r.label} in Transform Studio <ArrowRight size={13} /></button></div>}
              </div>}
            </motion.article>); })}</AnimatePresence>
        </section>

        <section className="surface p-5">
          <h3 className="text-sm font-bold">Capability heat-map <span className="font-normal text-ink-muted">— top 5 vs. what you weighted most</span></h3>
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[560px] text-xs"><thead><tr><th className="py-2 text-left font-semibold text-ink-muted">Capability (weight)</th>{result.ranked.slice(0, 5).map((r) => <th key={r.id} className="px-2 py-2 text-center font-semibold">{r.label.split(" ")[0]}</th>)}</tr></thead><tbody>{weighted.map(([cap, w]) => <tr key={cap} className="border-t border-slate-50"><td className="py-2 text-ink-muted">{CAP_LABEL[cap]} <span className="text-ink-muted/60">×{w.toFixed(1)}</span></td>{result.ranked.slice(0, 5).map((r) => <td key={r.id} className="px-2 py-1.5 text-center"><span className="inline-grid h-7 w-9 place-items-center rounded-md text-[11px] font-bold" style={{ background: `rgba(79,70,229,${0.08 + r.caps[cap] * 0.16})`, color: r.caps[cap] >= 4 ? "#fff" : "#4338ca" }}>{r.caps[cap]}</span></td>)}</tr>)}</tbody></table></div>
        </section>

        <ul className="space-y-1 px-1 text-[11px] leading-5 text-ink-muted">{result.assumptions.map((a) => <li key={a}>• {a}</li>)}</ul>
      </div>
    </div>
  );
}
