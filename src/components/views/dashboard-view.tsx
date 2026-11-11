"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Boxes, Cable, CheckCircle2, ChevronRight, FileText, FolderTree, GitBranch, GitCompareArrows, Loader2, Network, Plus, ScanSearch, Sparkles, TableProperties, Workflow, type LucideIcon } from "lucide-react";
import { EngineBadge } from "@/components/engine-icon";
import { SEVERITY, SEVERITY_ORDER, SeverityBar, StatusChip, sev } from "@/components/ui";
import { STORE_ROLES } from "@/lib/architecture";
import { engineLabel, namespaceLabel } from "@/lib/engines";
import { FIXTURE_ECOMMERCE_SQL, FIXTURE_MONGO_JSON, FIXTURE_MYSQL_SQL, FIXTURE_SAAS_YAML } from "@/lib/fixtures";
import type { Finding, ModelT, ScanRow } from "./types";

export type DashTarget = "Architecture" | "Connect" | "Explorer" | "Diagram" | "Analysis" | "Transform" | "Advisor" | "Diff & Migrate" | "Reports" | "AI Assistant" | "History";
export type StoreCard = { id: string; name: string; engine: string; role: string; scanId: string | null; versions: number; entities: number; namespaces: number; findings: number; designScore: number | null };
export type DashData = { stats?: Record<string, unknown>; recentScans?: ScanRow[]; latestScanId?: string | null; stores?: StoreCard[] };

const SAMPLES = [
  { id: "pg", label: "PostgreSQL e-commerce", engine: "postgres", payload: { filename: "ecommerce.sql", content: FIXTURE_ECOMMERCE_SQL, label: "E-commerce v1" } },
  { id: "mysql", label: "MySQL shop dump", engine: "mysql", payload: { filename: "shop.sql", content: FIXTURE_MYSQL_SQL, label: "MySQL shop" } },
  { id: "mongo", label: "MongoDB social app", engine: "mongodb", payload: { filename: "social.json", content: FIXTURE_MONGO_JSON, database: "social_demo", label: "MongoDB social" } },
  { id: "saas", label: "Multi-tenant SaaS (YAML)", engine: "postgres", payload: { filename: "saas.yaml", content: FIXTURE_SAAS_YAML, label: "Multi-tenant SaaS" } },
] as const;

const roleLabel = (role: string) => STORE_ROLES.find((r) => r.id === role)?.label ?? role;

export default function DashboardView({ dash, scans, findings, model, go, projectId, reload, setMsg, canWrite }: {
  dash: DashData | null; scans: ScanRow[]; findings: Finding[]; model: ModelT | null;
  go: (v: DashTarget, sid?: string) => void; projectId: string; reload: () => void; setMsg: (s: string) => void; canWrite: boolean;
}) {
  const stats = (dash?.stats ?? {}) as Record<string, number>;
  const bySeverity = ((dash?.stats ?? {}).bySeverity ?? {}) as Record<string, number>;
  const stores = dash?.stores ?? [];
  const [seeding, setSeeding] = useState<string | null>(null);
  const totalFindings = stats.findings ?? findings.length;
  const multi = stores.length > 1;

  async function seedSample(id: (typeof SAMPLES)[number]["id"]) {
    if (!projectId) return setMsg("Create or select a project first");
    const sample = SAMPLES.find((s) => s.id === id)!;
    setSeeding(id);
    const r = await fetch("/api/v1/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, ...sample.payload }) }).then((x) => x.json()).catch(() => ({ error: "Could not reach the server" }));
    setSeeding(null);
    if (r.scanId) { setMsg(`${sample.label} analyzed`); reload(); go("Explorer", r.scanId); } else setMsg(`Seed failed: ${r.error ?? "unknown"}`);
  }
  async function seedSystem() {
    if (!projectId) return setMsg("Create or select a project first");
    setSeeding("system");
    const r = await fetch("/api/v1/architecture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, action: "seed_demo" }) }).then((x) => x.json()).catch(() => ({ error: "Could not reach the server" }));
    setSeeding(null);
    if (r.error) return setMsg(`Seed failed: ${r.error}`);
    setMsg("Sample system loaded: PostgreSQL (8 schemas) + MongoDB + Redis");
    reload();
    go("Architecture");
  }

  const cards: { label: string; value: number; note: string; icon: LucideIcon }[] = [
    { label: "Datastores", value: stats.stores ?? stores.length, note: `${stats.engines ?? 0} engine${stats.engines === 1 ? "" : "s"} · ${stats.flows ?? 0} declared flow${stats.flows === 1 ? "" : "s"}`, icon: Boxes },
    { label: model ? `${namespaceLabel(model.engine, true)}` : "Schemas", value: stats.namespaces ?? model?.namespaces.length ?? 0, note: "in the selected version", icon: FolderTree },
    { label: "Entities", value: stats.entities ?? model?.entities.length ?? 0, note: `${stats.fields ?? 0} fields · ${stats.indexes ?? 0} indexes`, icon: TableProperties },
    { label: "Relationships", value: stats.relationships ?? model?.relationships.length ?? 0, note: "explicit + inferred", icon: GitCompareArrows },
    { label: "Connections", value: stats.connections ?? 0, note: `${stats.healthyConnections ?? 0} healthy`, icon: Cable },
  ];

  return (
    <div className="space-y-5">
      {/* hero */}
      <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5 }} className="relative overflow-hidden rounded-2xl bg-[#0d1424] text-white shadow-sm ring-1 ring-white/5">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-indigo-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="grid-lines pointer-events-none absolute inset-0 opacity-40" />
        <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-center md:p-8">
          <div className="flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[.16em] text-indigo-300">{multi ? `${stores.length} datastores · ${stats.engines ?? 1} engines` : scans.length ? "Latest schema health" : "Start your first analysis"}</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-[28px]">{scans.length ? (multi ? "Your system is mapped, store by store." : `${model?.database ?? "Your database"} is mapped and analyzed.`) : "Turn your databases into engineering knowledge."}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{scans.length ? `${totalFindings} open finding${totalFindings === 1 ? "" : "s"} in the selected version${multi ? `, plus cross-store analysis across ${stores.length} datastores` : ""}. Review the evidence before changing indexes, constraints or ownership.` : "Connect read-only or upload a dump — every schema, not just public. Add each database your system runs on and see how they depend on each other."}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {scans.length > 0 ? <>
                <button onClick={() => go("Architecture")} className="flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-bold transition hover:bg-indigo-400"><Workflow size={15} />Open architecture</button>
                <button onClick={() => go("Diagram")} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10"><Network size={15} />Diagram</button>
                <button onClick={() => go("Analysis")} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10"><ScanSearch size={15} />Review {totalFindings} findings</button>
              </> : canWrite ? <>
                <button disabled={seeding !== null} onClick={seedSystem} className="flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-bold transition hover:bg-indigo-400 disabled:opacity-60">{seeding === "system" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}Load a sample system</button>
                <button onClick={() => go("Connect")} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10"><Plus size={15} />Add a database</button>
              </> : <span className="text-sm text-slate-400">Ask an admin to add the first schema.</span>}
            </div>
          </div>
          {scans.length > 0 && <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[.04] px-5 py-4"><ScoreRing value={Number(stats.designScore ?? 0)} /><div><div className="text-sm font-semibold">Design score</div><div className="mt-0.5 max-w-[150px] text-[11px] leading-4 text-slate-400">Selected version · heuristic from rule severity</div></div></div>}
        </div>
      </motion.section>

      {/* the system */}
      {stores.length > 0 && <section>
        <div className="mb-2.5 flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-bold text-ink"><Workflow size={15} className="text-indigo-500" />Your system</h3><button onClick={() => go("Architecture")} className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300">Architecture &amp; cross-store findings <ArrowRight size={13} /></button></div>
        <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: .06 } } }} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stores.map((s) => (
            <motion.button key={s.id} variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }} onClick={() => (s.scanId ? go("Explorer", s.scanId) : go("Connect"))} className="surface card-hover group p-4 text-left">
              <div className="flex items-center gap-3"><EngineBadge engine={s.engine} size={38} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-ink">{s.name}</div><div className="truncate text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{roleLabel(s.role)}</div></div>{s.designScore !== null && <span className={`rounded-lg px-1.5 py-0.5 text-xs font-bold tabular-nums ${s.designScore >= 80 ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" : "bg-amber-500/12 text-amber-600 dark:text-amber-300"}`}>{s.designScore}</span>}</div>
              <div className="mt-3 flex items-center gap-3 text-[11px] text-ink-muted">{s.scanId ? <><span><b className="text-ink">{s.namespaces || 1}</b> {namespaceLabel(s.engine, (s.namespaces || 1) !== 1)}</span><span><b className="text-ink">{s.entities}</b> entities</span><span><b className="text-ink">{s.findings}</b> findings</span></> : <span>No schema captured yet — add one</span>}<ChevronRight size={14} className="ml-auto text-ink-muted/40 transition group-hover:translate-x-0.5 group-hover:text-indigo-500" /></div>
              <div className="mt-2 text-[10px] text-ink-muted/80">{engineLabel(s.engine)} · {s.versions} version{s.versions === 1 ? "" : "s"}</div>
            </motion.button>
          ))}
          {canWrite && <motion.button variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }} onClick={() => go("Connect")} className="flex min-h-[112px] flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-line p-4 text-ink-muted transition hover:border-indigo-400/60 hover:bg-indigo-500/5 hover:text-ink"><Plus size={18} /><span className="text-xs font-semibold">Add another datastore</span><span className="text-[10px]">second database, replica, Redis…</span></motion.button>}
        </motion.div>
      </section>}

      {/* numbers */}
      <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: .05 } } }} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {cards.map((c) => <motion.div variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }} key={c.label} className="surface card-hover p-4"><div className="flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{c.label}</span><span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-500/10 text-indigo-500"><c.icon size={14} /></span></div><div className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-ink">{Number(c.value ?? 0)}</div><div className="mt-1 text-[11px] text-ink-muted">{c.note}</div></motion.div>)}
      </motion.div>

      <Guide scans={scans} stores={stores.length} flows={stats.flows ?? 0} totalFindings={totalFindings} bySeverity={bySeverity} findings={findings} model={model} go={go} />

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <section className="surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4"><div><h3 className="text-sm font-bold text-ink">Priority findings</h3><p className="mt-1 text-xs text-ink-muted">Selected version, ordered by severity, with evidence and limitations.</p></div><button onClick={() => go("Analysis")} className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300">View all</button></div>
          <div className="divide-y divide-line/70">
            {findings.slice(0, 6).map((f) => <button key={f.id} onClick={() => go("Analysis")} className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition hover:bg-muted"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${sev(f.severity).dot}`} /><div className="min-w-0"><div className="text-sm font-semibold text-ink">{f.title}</div><div className="mt-1 truncate font-mono text-[11px] text-ink-muted">{f.object} · {f.ruleId}</div></div><span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] text-ink-muted">{f.evidenceLevel}</span></button>)}
            {findings.length === 0 && <div className="p-8 text-center text-sm text-ink-muted">{scans.length ? "No findings in this version." : "Findings appear after your first scan."}</div>}
          </div>
        </section>
        <section className="surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4"><h3 className="text-sm font-bold text-ink">Recent versions</h3><button onClick={() => go("History")} className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300">History</button></div>
          <div className="divide-y divide-line/70">
            {scans.slice(0, 6).map((s) => <button key={s.id} onClick={() => go("Explorer", s.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-muted"><EngineBadge engine={s.engine} size={30} /><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-ink">{s.label ?? `${engineLabel(s.engine)} · ${s.source}`}</div><div className="mt-0.5 truncate text-[10px] text-ink-muted">{s.storeName ?? "unattached"}{s.version ? ` · v${s.version}` : ""} · {s.stats?.entities ?? 0} entities · {s.stats?.findings ?? 0} findings</div></div><StatusChip status={s.status} /></button>)}
            {scans.length === 0 && <div className="space-y-2 p-5"><p className="text-xs text-ink-muted">Or explore one complete single-database sample:</p>{SAMPLES.map((s) => <button key={s.id} disabled={seeding !== null || !canWrite} onClick={() => seedSample(s.id)} className="flex w-full items-center gap-2.5 rounded-xl border border-line px-3 py-2 text-left text-xs font-semibold text-ink transition hover:border-indigo-400/60 hover:bg-muted disabled:opacity-50"><EngineBadge engine={s.engine} size={26} />{s.label}{seeding === s.id && <Loader2 size={13} className="ml-auto animate-spin" />}</button>)}</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function Guide({ scans, stores, flows, totalFindings, bySeverity, findings, model, go }: { scans: ScanRow[]; stores: number; flows: number; totalFindings: number; bySeverity: Record<string, number>; findings: Finding[]; model: ModelT | null; go: (v: DashTarget, sid?: string) => void }) {
  const triaged = findings.filter((f) => f.status !== "open").length;
  const steps: { done: boolean; label: string; hint: string; view: DashTarget }[] = [
    { done: scans.length > 0, label: "Add a schema", hint: "Upload a dump or connect read-only", view: "Connect" },
    { done: scans.length > 0 && !!model, label: "Explore the model", hint: "Schemas, entities and relationships", view: "Explorer" },
    { done: stores > 1, label: "Map the whole system", hint: stores > 1 ? `${stores} datastores · ${flows} flow${flows === 1 ? "" : "s"} declared` : "Add your other databases and caches", view: "Architecture" },
    { done: findings.length === 0 ? scans.length > 0 : triaged > 0, label: "Triage findings", hint: `${triaged}/${findings.length} reviewed`, view: "Analysis" },
    { done: scans.length > 1, label: "Compare or transform", hint: "Diff versions or plan an engine move", view: "Transform" },
  ];
  const done = steps.filter((s) => s.done).length;
  const journeys: { title: string; desc: string; views: [DashTarget, string][]; icon: LucideIcon; tone: string }[] = [
    { title: "Understand", desc: "The system map, every schema, the diagram and findings with evidence.", views: [["Architecture", "Architecture"], ["Explorer", "Explorer"], ["Diagram", "Diagram"], ["Analysis", "Analysis"]], icon: TableProperties, tone: "from-sky-500/12" },
    { title: "Decide", desc: "Convert engines, ask which database fits, and generate migrations.", views: [["Transform", "Transform"], ["Advisor", "Advisor"], ["Diff & Migrate", "Diff"]], icon: GitBranch, tone: "from-violet-500/12" },
    { title: "Share", desc: "Export reports, ask the assistant, and review version history.", views: [["Reports", "Reports"], ["AI Assistant", "Assistant"], ["History", "History"]], icon: FileText, tone: "from-emerald-500/12" },
  ];
  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <section className="surface p-5">
        <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-ink">Getting started</h3><span className="text-xs tabular-nums text-ink-muted">{done}/{steps.length}</span></div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><motion.div initial={{ width: 0 }} animate={{ width: `${(done / steps.length) * 100}%` }} transition={{ duration: .8 }} className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" /></div>
        <ol className="mt-4 space-y-1">{steps.map((s, i) => <li key={s.label}><button onClick={() => go(s.view)} className="group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-muted"><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${s.done ? "bg-emerald-500 text-white" : "bg-muted text-ink-muted ring-1 ring-line"}`}>{s.done ? <CheckCircle2 size={14} /> : i + 1}</span><span className="min-w-0 flex-1"><span className={`block text-[13px] font-semibold ${s.done ? "text-ink-muted line-through decoration-ink-muted/40" : "text-ink"}`}>{s.label}</span><span className="block text-[11px] text-ink-muted">{s.hint}</span></span><ChevronRight size={14} className="text-ink-muted/40 transition group-hover:translate-x-0.5 group-hover:text-ink-muted" /></button></li>)}</ol>
        {totalFindings > 0 && <div className="mt-4 border-t border-line pt-4"><div className="mb-2 flex items-center justify-between text-xs"><span className="font-semibold text-ink">Open findings by severity</span><span className="tabular-nums text-ink-muted">{totalFindings}</span></div><SeverityBar counts={bySeverity} /><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted">{SEVERITY_ORDER.filter((k) => bySeverity[k]).map((k) => <span key={k} className="flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${SEVERITY[k].dot}`} />{SEVERITY[k].label} {bySeverity[k]}</span>)}</div></div>}
      </section>
      <div className="grid gap-3 md:grid-cols-3">{journeys.map((j, i) => <motion.section key={j.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .1 + i * .07 }} className={`surface card-hover flex flex-col bg-gradient-to-br ${j.tone} to-transparent p-5`}><div className="grid h-10 w-10 place-items-center rounded-xl bg-elevated text-ink shadow-sm ring-1 ring-line"><j.icon size={18} /></div><h3 className="mt-4 text-sm font-bold text-ink">{j.title}</h3><p className="mt-1 flex-1 text-xs leading-5 text-ink-muted">{j.desc}</p><div className="mt-4 flex flex-wrap gap-1.5">{j.views.map(([v, l]) => <button key={v} onClick={() => go(v)} className="rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-[11px] font-semibold text-ink transition hover:border-indigo-400/60 hover:text-indigo-600 dark:hover:text-indigo-300">{l}</button>)}</div></motion.section>)}</div>
    </div>
  );
}

function ScoreRing({ value }: { value: number }) {
  const r = 26, c = 2 * Math.PI * r;
  const good = value >= 80;
  return (
    <div className="relative grid h-16 w-16 place-items-center">
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90"><circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="5" /><motion.circle cx="32" cy="32" r={r} fill="none" stroke={good ? "#34d399" : "#fbbf24"} strokeWidth="5" strokeLinecap="round" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c - (c * Math.max(0, Math.min(100, value))) / 100 }} transition={{ duration: 1.2, ease: [.2, .8, .2, 1], delay: .3 }} /></svg>
      <span className={`text-xl font-bold tabular-nums ${good ? "text-emerald-300" : "text-amber-300"}`}>{value || "—"}</span>
    </div>
  );
}
