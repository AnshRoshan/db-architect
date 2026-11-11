"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Braces, Cable, Clock, Code2, Download, ExternalLink, FileJson, FileText, Globe, History, Image as ImageIcon, KeyRound, ListChecks, ShieldCheck } from "lucide-react";
import { Card, CardHeader, Chip, EmptyState, EngineChip, SearchInput, StatusChip } from "@/components/ui";
import type { ModelT, ScanRow } from "./types";

// ── Reports ─────────────────────────────────────────────────────────
export function ReportsView({ scanId, model, findingsCount, onOpenDiagram }: { scanId: string; model: ModelT | null; findingsCount: number; onOpenDiagram: () => void }) {
  if (!scanId || !model) return <EmptyState icon={FileText} title="No schema selected" hint="Pick a schema version to export reports and documentation." />;
  const base = `/api/v1/reports?scanId=${scanId}`;
  const exports = [
    { href: `${base}&format=html`, icon: Globe, title: "Interactive HTML report", desc: "Overview, diagram, findings with evidence, and full entity inventory. Share as a single file.", tag: "Best for stakeholders", primary: true, newTab: true },
    { href: `${base}&format=markdown`, icon: FileText, title: "Markdown documentation", desc: "Drop into a wiki, README or pull request. Tables per entity, findings per rule.", tag: "Best for engineers" },
    { href: `${base}&format=json`, icon: FileJson, title: "Canonical JSON model", desc: "Engine-neutral schema model v1 plus findings — for CI, drift checks and tooling.", tag: "Best for automation", newTab: true },
    { href: `/api/v1/scans/${scanId}`, icon: Braces, title: "Raw scan payload", desc: "Model, findings, saved diagram layout and SVG for this version.", tag: "Debugging", newTab: true },
  ];
  const fields = model.entities.reduce((a, e) => a + e.fields.length, 0);
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {exports.map((x, i) => (
            <motion.a key={x.title} href={x.href} target={x.newTab ? "_blank" : undefined} rel="noreferrer" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }} className={`group relative overflow-hidden rounded-2xl border p-5 transition card-hover ${x.primary ? "border-indigo-400/40 bg-gradient-to-br from-indigo-500/10 to-violet-500/5" : "surface"}`}>
              <div className="flex items-start gap-3"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${x.primary ? "bg-indigo-600 text-white" : "bg-muted text-ink"}`}><x.icon size={18} /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="text-sm font-bold text-ink">{x.title}</h3>{x.newTab ? <ExternalLink size={12} className="text-ink-muted" /> : <Download size={12} className="text-ink-muted" />}</div><p className="mt-1 text-xs leading-5 text-ink-muted">{x.desc}</p><Chip className="mt-3 bg-muted text-ink-muted ring-line">{x.tag}</Chip></div></div>
            </motion.a>
          ))}
        </div>
        <Card>
          <CardHeader icon={ImageIcon} title="Diagram exports" subtitle="SVG and PNG are exported from the live diagram canvas, so they include your saved layout, hidden entities and collapsed nodes." actions={<button onClick={onOpenDiagram} className="rounded-xl border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-muted">Open diagram</button>} />
        </Card>
      </div>
      <Card>
        <CardHeader icon={ListChecks} title="What's in this report" />
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between"><span className="text-ink-muted">Database</span><span className="font-mono font-semibold text-ink">{model.database}</span></div>
          <div className="flex items-center justify-between"><span className="text-ink-muted">Engine</span><EngineChip engine={model.engine} /></div>
          {[["Entities", model.entities.length], ["Fields", fields], ["Relationships", model.relationships.length], ["Findings", findingsCount]].map(([l, v]) => <div key={String(l)} className="flex items-center justify-between"><span className="text-ink-muted">{l}</span><span className="font-semibold tabular-nums text-ink">{v}</span></div>)}
        </div>
        <div className="mt-5 space-y-2 border-t border-line pt-4 text-xs text-ink-muted">
          {["Every recommendation cites a rule id, object and evidence level", "Workload-dependent claims are labelled as such", "Inferred document links are never shown as constraints", "Analysis limitations are printed in the report"].map((t) => <div key={t} className="flex gap-2"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-emerald-500" />{t}</div>)}
        </div>
      </Card>
    </div>
  );
}

// ── History ─────────────────────────────────────────────────────────
type Conn = { id: string; name: string; engine: string; status: string; maskedConnection?: string; lastTestedAt?: string | null };
function rel(d?: string | null) {
  if (!d) return "—";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(d).toLocaleDateString();
}
export function HistoryView({ projectId, scans, currentScanId, onOpen, reload }: { projectId: string; scans: ScanRow[]; currentScanId: string; onOpen: (id: string) => void; reload: () => void }) {
  const [conns, setConns] = useState<Conn[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => { if (projectId) fetch(`/api/v1/connections?projectId=${projectId}`).then((x) => x.json()).then((r) => setConns(r.connections ?? [])).catch(() => undefined); }, [projectId]);
  useEffect(() => { reload(); }, [reload]);
  const filtered = useMemo(() => scans.filter((s) => !q || `${s.id} ${s.engine} ${s.source} ${s.status} ${s.label ?? ""} ${s.storeName ?? ""}`.toLowerCase().includes(q.toLowerCase())), [scans, q]);
  if (!scans.length && !conns.length) return <EmptyState icon={History} title="No history yet" hint="Every import, live scan and transformation saves an immutable schema version here." />;
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4"><div><h3 className="text-sm font-bold text-ink">Schema versions</h3><p className="text-xs text-ink-muted">{scans.length} immutable snapshot{scans.length === 1 ? "" : "s"} · newest first</p></div><SearchInput value={q} onChange={setQ} placeholder="Filter versions…" className="ml-auto w-56" /></div>
        <ol className="relative p-4">
          <div className="absolute bottom-6 left-[29px] top-6 w-px bg-line" />
          {filtered.map((s, i) => { const current = s.id === currentScanId; return (
            <motion.li key={s.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 12) * .03 }} className="relative mb-2 flex items-start gap-4 last:mb-0">
              <div className={`relative z-10 mt-3 grid h-6 w-6 shrink-0 place-items-center rounded-full ring-4 ring-[var(--bg-elevated)] ${current ? "bg-indigo-600 text-white" : "bg-muted text-ink-muted"}`}>{s.source === "introspection" ? <Cable size={11} /> : s.source === "transform" ? <Code2 size={11} /> : <FileText size={11} />}</div>
              <button onClick={() => onOpen(s.id)} className={`flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border p-3 text-left transition ${current ? "border-indigo-400/50 bg-indigo-500/[.06]" : "border-line hover:bg-muted"}`}>
                <EngineChip engine={s.engine} /><span className="text-xs font-semibold capitalize text-ink">{s.source === "introspection" ? "Live scan" : s.source === "transform" ? "Transform design" : "Import"}</span><StatusChip status={s.status} />{current && <Chip className="bg-indigo-500/12 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300">viewing</Chip>}
                <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-muted"><Clock size={11} />{rel(s.createdAt)}</span>
                <div className="w-full font-mono text-[11px] text-ink-muted">{s.storeName ? `${s.storeName} · ` : ""}{s.label ? `${s.label} · ` : ""}{s.id.slice(0, 8)}{s.stats ? ` · ${s.stats.entities ?? 0} entities · ${s.stats.fields ?? 0} fields · ${s.stats.indexes ?? 0} indexes · ${s.stats.findings ?? 0} findings` : ""}{s.error ? ` · ${s.error.slice(0, 80)}` : ""}</div>
              </button>
            </motion.li>); })}
          {!filtered.length && <p className="py-8 text-center text-sm text-ink-muted">No versions match.</p>}
        </ol>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader icon={Cable} title="Saved connections" subtitle="Credentials are AES-256-GCM encrypted and never returned by any API." />
          <div className="space-y-2">{conns.map((c) => <div key={c.id} className="rounded-xl border border-line p-3"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${c.status === "healthy" ? "bg-emerald-500" : c.status === "error" || c.status === "revoked" ? "bg-red-500" : "bg-slate-400"}`} /><span className="truncate text-xs font-semibold text-ink">{c.name}</span><span className="ml-auto"><EngineChip engine={c.engine} /></span></div><div className="mt-1 truncate font-mono text-[10px] text-ink-muted">{c.maskedConnection}</div><div className="mt-1 text-[10px] text-ink-muted">{c.status} · tested {rel(c.lastTestedAt)}</div></div>)}{!conns.length && <p className="text-xs text-ink-muted">No saved connections. Save one from Connect to rescan later.</p>}</div>
        </Card>
        <Card>
          <CardHeader icon={KeyRound} title="Retention & audit" />
          <p className="text-xs leading-5 text-ink-muted">Versions are immutable, so findings can always be reproduced. Imports, scans, live previews, migrations and triage decisions are written to the audit log (Settings → Audit). No production rows are stored.</p>
        </Card>
      </div>
    </div>
  );
}
