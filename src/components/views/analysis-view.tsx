"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, ClipboardCheck, Eye, FlaskConical, Gauge, Layers, ScanSearch, ShieldQuestion, X } from "lucide-react";
import { Card, Chip, EmptyState, SEVERITY, SEVERITY_ORDER, SearchInput, Segmented, SeverityBar, SeverityChip, StatusChip, sev } from "@/components/ui";
import type { Finding } from "./types";

type Group = "severity" | "category" | "object";
const STATUSES = [["open", "Open"], ["accepted", "Accept"], ["needs_review", "Needs review"], ["fixed", "Fixed"], ["dismissed", "Dismiss"]] as const;
const EVIDENCE: Record<string, { label: string; hint: string }> = {
  schema: { label: "Schema", hint: "Derived from definitions" },
  statistics: { label: "Statistics", hint: "From database statistics" },
  workload: { label: "Workload", hint: "From queries and plans" },
  sample: { label: "Sample", hint: "From sampled documents" },
  heuristic: { label: "Heuristic", hint: "Pattern-based, unproven at runtime" },
};

export default function AnalysisView({ findings, scanId, canReview, onStatusChanged }: { findings: Finding[]; scanId: string; canReview: boolean; onStatusChanged: () => void }) {
  const [q, setQ] = useState("");
  const [sevFilter, setSevFilter] = useState<Set<string>>(new Set());
  const [cat, setCat] = useState("all");
  const [status, setStatus] = useState("active");
  const [group, setGroup] = useState<Group>("severity");
  const [open, setOpen] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);

  const withStatus = useMemo(() => findings.map((f) => ({ ...f, status: overrides[f.id] ?? f.status })), [findings, overrides]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const f of withStatus) if (f.status !== "dismissed" && f.status !== "fixed") c[f.severity] = (c[f.severity] ?? 0) + 1; return c; }, [withStatus]);
  const categories = useMemo(() => [...new Set(findings.map((f) => f.category))].sort(), [findings]);
  const statusCounts = useMemo(() => { const c: Record<string, number> = {}; for (const f of withStatus) c[f.status] = (c[f.status] ?? 0) + 1; return c; }, [withStatus]);

  const list = useMemo(() => withStatus.filter((f) =>
    (sevFilter.size === 0 || sevFilter.has(f.severity)) && (cat === "all" || f.category === cat) &&
    (status === "all" || (status === "active" ? f.status !== "dismissed" && f.status !== "fixed" : f.status === status)) &&
    (!q || `${f.title} ${f.object} ${f.ruleId} ${f.recommendation}`.toLowerCase().includes(q.toLowerCase()))
  ).sort((a, b) => SEVERITY_ORDER.indexOf(a.severity as never) - SEVERITY_ORDER.indexOf(b.severity as never)), [withStatus, sevFilter, cat, status, q]);

  const groups = useMemo(() => {
    const g = new Map<string, Finding[]>();
    for (const f of list) { const key = group === "severity" ? f.severity : group === "category" ? f.category : f.object.split(".").slice(0, 2).join(".").split(" ")[0]; g.set(key, [...(g.get(key) ?? []), f]); }
    return [...g];
  }, [list, group]);

  async function changeStatus(id: string, next: string) {
    const prev = overrides[id];
    setOverrides((o) => ({ ...o, [id]: next })); setPending(id);
    const r = await fetch("/api/v1/findings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ findingId: id, status: next }) }).then((x) => x.json()).catch(() => ({ error: "network" }));
    setPending(null);
    if (r.ok) onStatusChanged(); else setOverrides((o) => ({ ...o, [id]: prev as string }));
  }
  const toggleSev = (s: string) => setSevFilter((cur) => { const n = new Set(cur); if (n.has(s)) n.delete(s); else n.add(s); return n; });

  if (!scanId) return <EmptyState icon={ScanSearch} title="No schema selected" hint="Pick a schema version to see its deterministic findings, each with evidence and limitations." />;
  if (!findings.length) return <EmptyState icon={ClipboardCheck} title="No findings — clean schema" hint="Every rule passed for this version. Findings appear here when rules detect integrity, index, type or document-design issues." />;

  const active = SEVERITY_ORDER.reduce((a, k) => a + (counts[k] ?? 0), 0);
  const resolved = (statusCounts.fixed ?? 0) + (statusCounts.accepted ?? 0) + (statusCounts.dismissed ?? 0);

  return (
    <div className="space-y-4">
      {/* overview */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <div className="flex items-end justify-between gap-4"><div><div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Open findings</div><div className="mt-1 text-3xl font-bold tabular-nums text-ink">{active}</div></div><div className="text-right text-xs text-ink-muted">{resolved} triaged · {findings.length} total</div></div>
          <div className="mt-4"><SeverityBar counts={counts} /></div>
          <div className="mt-4 flex flex-wrap gap-2">
            {SEVERITY_ORDER.map((s) => { const on = sevFilter.has(s); const n = counts[s] ?? 0; const I = SEVERITY[s].icon; return (
              <button key={s} onClick={() => toggleSev(s)} disabled={!n && !on} aria-pressed={on} className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40 ${on ? `${SEVERITY[s].chip} border-transparent ring-1 ring-inset` : "border-line text-ink hover:bg-muted"}`}><I size={13} />{SEVERITY[s].label}<span className="tabular-nums text-ink-muted">{n}</span></button>); })}
            {sevFilter.size > 0 && <button onClick={() => setSevFilter(new Set())} className="flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs text-ink-muted hover:text-ink"><X size={12} />Clear</button>}
          </div>
        </Card>
        <Card>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">How to read confidence</div>
          <div className="mt-3 space-y-2">{Object.entries(EVIDENCE).map(([k, v]) => <div key={k} className="flex items-center gap-2 text-xs"><Chip className={k === "heuristic" ? "bg-violet-500/12 text-violet-700 ring-violet-500/25 dark:text-violet-300" : "bg-muted text-ink ring-line"}>{v.label}</Chip><span className="text-ink-muted">{v.hint}</span><span className="ml-auto tabular-nums text-ink-muted">{findings.filter((f) => f.evidenceLevel === k).length}</span></div>)}</div>
          <p className="mt-3 text-[11px] leading-5 text-ink-muted">Findings marked <b className="text-ink">needs workload</b> are schema signals only — validate them against real query statistics before acting.</p>
        </Card>
      </div>

      {/* toolbar */}
      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Search title, object, rule…" className="min-w-[220px] flex-1" />
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category" className="rounded-xl border border-line bg-elevated px-3 py-2 text-xs text-ink"><option value="all">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="rounded-xl border border-line bg-elevated px-3 py-2 text-xs text-ink"><option value="active">Active (not fixed/dismissed)</option><option value="all">All statuses</option>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l === "Accept" ? "Accepted" : l === "Dismiss" ? "Dismissed" : l} ({statusCounts[v] ?? 0})</option>)}</select>
          <Segmented<Group> layoutId="analysis-group" value={group} onChange={setGroup} options={[{ value: "severity", label: <><Gauge size={12} />Severity</> }, { value: "category", label: <><Layers size={12} />Category</> }, { value: "object", label: <><Eye size={12} />Object</> }]} />
        </div>
      </Card>

      {/* groups */}
      {!list.length && <EmptyState title="No findings match these filters" hint="Clear a filter or switch the status view to see triaged findings." />}
      {groups.map(([key, items]) => (
        <section key={key}>
          <div className="mb-2 flex items-center gap-2 px-1">
            {group === "severity" ? <SeverityChip severity={key} /> : <span className="font-mono text-xs font-bold text-ink">{key}</span>}
            <span className="text-xs text-ink-muted">{items.length} finding{items.length === 1 ? "" : "s"}</span>
            <div className="ml-2 h-px flex-1 bg-line" />
          </div>
          <div className="space-y-2">
            {items.map((f, i) => {
              const expanded = open === f.id;
              const s = sev(f.severity);
              return (
                <motion.article layout key={f.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * .03 }} className={`surface overflow-hidden border-l-4 ${s.edge} ${f.status === "dismissed" || f.status === "fixed" ? "opacity-60" : ""}`}>
                  <button onClick={() => setOpen(expanded ? null : f.id)} aria-expanded={expanded} className="flex w-full items-start gap-3 p-4 text-left">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="text-[14px] font-semibold text-ink">{f.title}</span>{group !== "severity" && <SeverityChip severity={f.severity} />}<StatusChip status={f.status} /></div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted"><code className="font-mono text-indigo-600 dark:text-indigo-300">{f.object}</code><span>{f.ruleId}</span><span>{f.category}</span><span>{EVIDENCE[f.evidenceLevel]?.label ?? f.evidenceLevel} evidence</span>{f.requiresWorkload && <span className="flex items-center gap-1 text-violet-600 dark:text-violet-300"><FlaskConical size={11} />needs workload</span>}</div>
                    </div>
                    <div className="hidden shrink-0 items-center gap-2 sm:flex"><div className="text-right"><div className="text-[10px] uppercase tracking-wider text-ink-muted">Confidence</div><div className="text-sm font-bold tabular-nums text-ink">{f.confidence}%</div></div><div className="h-8 w-1.5 overflow-hidden rounded-full bg-muted"><div className={`w-full rounded-full ${s.bar}`} style={{ height: `${f.confidence}%`, marginTop: `${100 - f.confidence}%` }} /></div></div>
                    <ChevronDown size={16} className={`mt-1 shrink-0 text-ink-muted transition ${expanded ? "rotate-180" : ""}`} />
                  </button>
                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: .22 }} className="overflow-hidden">
                        <div className="grid gap-4 border-t border-line px-4 pb-4 pt-4 lg:grid-cols-2">
                          <div><div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">Why it matters</div><p className="mt-1.5 text-[13px] leading-6 text-ink">{f.explanation}</p></div>
                          <div><div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Recommended action</div><p className="mt-1.5 text-[13px] leading-6 text-ink">{f.recommendation}</p></div>
                          {f.limitations.length > 0 && <div className="lg:col-span-2"><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400"><ShieldQuestion size={12} />Limitations</div><ul className="mt-1.5 space-y-1 text-xs text-ink-muted">{f.limitations.map((l, j) => <li key={j}>• {l}</li>)}</ul></div>}
                          <details className="lg:col-span-2"><summary className="cursor-pointer text-[11px] font-semibold text-ink-muted hover:text-ink">Evidence</summary><pre className="scroll-thin mt-2 max-h-56 overflow-auto rounded-xl bg-slate-950 p-3 font-mono text-[11px] text-emerald-200">{JSON.stringify(f.evidence, null, 2)}</pre></details>
                          <div className="flex flex-wrap items-center gap-1.5 lg:col-span-2">
                            {canReview ? STATUSES.map(([v, l]) => <button key={v} disabled={pending === f.id} onClick={() => changeStatus(f.id, v)} className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${f.status === v ? "bg-ink text-canvas" : "border border-line text-ink hover:bg-muted"}`}>{f.status === v && <Check size={12} />}{l}</button>) : <span className="text-xs text-ink-muted">Architect role or above is needed to triage findings.</span>}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
