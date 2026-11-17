"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, BookmarkPlus, Check, CheckCircle2, Code2, Copy, Download, FileCode2, GitBranch, Layers, Loader2, Play, RotateCcw, ShieldCheck, Sparkles, Trash2, Wand2, Workflow } from "lucide-react";
import { EngineBadge } from "@/components/engine-icon";
import { Card, Chip, EmptyState, Segmented, SeverityChip, sev } from "@/components/ui";
import { engineLabel } from "@/lib/engines";
import {
  DEFAULT_REQUIREMENTS,
  REDESIGN_PRESETS,
  type CapabilityTag,
  type ComplianceTag,
  type RedesignBlueprint,
  type RedesignGoal,
  type RedesignRequirements,
} from "@/lib/redesign";

type Tab = "overview" | "architecture" | "ddl" | "cutover" | "saved";
type SavedRow = { id: string; name: string; kind: string; goal: string; createdAt: string; requirements: RedesignRequirements; blueprint: RedesignBlueprint };

const GOALS: [RedesignGoal, string][] = [
  ["optimize_current", "Harden & optimize in place"],
  ["migrate_engine", "Migrate to another engine"],
  ["scale_out", "Scale to 100M+ rows"],
  ["multi_tenant", "B2B multi-tenancy (RLS)"],
  ["decompose", "Decompose into services"],
  ["consolidate", "Consolidate databases"],
];
const SCALES: [RedesignRequirements["scale"], string][] = [["startup", "< 10 GB"], ["growth", "10 GB – 1 TB"], ["scale", "1 – 50 TB"], ["hyperscale", "50 TB+ global"]];
const LATENCIES: [RedesignRequirements["latency"], string][] = [["standard", "< 100 ms"], ["snappy", "< 25 ms"], ["realtime", "< 5 ms"]];
const TENANCIES: [RedesignRequirements["tenancy"], string][] = [["single", "Single tenant"], ["b2b_shared", "B2B shared (RLS)"], ["b2b_isolated", "B2B isolated"], ["consumer_global", "Global consumer"]];
const CONSISTENCIES: [RedesignRequirements["consistency"], string][] = [["strict_acid", "Strict ACID"], ["balanced", "Balanced"], ["eventual_ok", "Eventual OK"]];
const ENGINES_OPT: [RedesignRequirements["targetEngine"], string][] = [["keep", "Keep current"], ["auto", "Auto-recommend"], ["postgres", "PostgreSQL"], ["mysql", "MySQL"], ["mongodb", "MongoDB"], ["sqlite", "SQLite"]];
const COMPLIANCES: [ComplianceTag, string][] = [["soc2", "SOC 2"], ["gdpr", "GDPR / EU"], ["pci", "PCI / Finance"], ["hipaa", "HIPAA"]];
const CAPABILITIES: [CapabilityTag, string][] = [["oltp", "OLTP core"], ["cache", "Cache / sessions"], ["search", "Full-text search"], ["analytics", "Analytics / BI"], ["queues", "Async queues"], ["time_series", "Time-series"], ["geo", "Geospatial"], ["vectors", "AI / vectors"]];

const STATUS_BADGE: Record<string, string> = {
  keep: "bg-slate-500/12 text-ink-muted ring-line",
  upgrade: "bg-indigo-500/12 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300",
  new: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
  migrate_to: "bg-violet-500/12 text-violet-700 ring-violet-500/25 dark:text-violet-300",
  retire: "bg-red-500/12 text-red-700 ring-red-500/25 dark:text-red-300",
};

function downloadText(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  a.download = name;
  a.click();
}

export default function RedesignView({
  projectId,
  canWrite,
  onOpenScan,
  onOpenHandoff,
  onTransform,
  onChanged,
  notify,
}: {
  projectId: string;
  canWrite: boolean;
  onOpenScan: (scanId: string, view: "Explorer" | "Diagram" | "Analysis") => void;
  onOpenHandoff: (brief: string, targetEngine?: string) => void;
  onTransform: (targetEngine: string) => void;
  onChanged: () => void;
  notify: (text: string, kind?: "success" | "error") => void;
}) {
  const [req, setReq] = useState<RedesignRequirements>(DEFAULT_REQUIREMENTS);
  const [blueprint, setBlueprint] = useState<RedesignBlueprint | null>(null);
  const [saved, setSaved] = useState<SavedRow[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const post = useCallback(
    (payload: Record<string, unknown>) =>
      fetch("/api/v1/redesign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, ...payload }) })
        .then((r) => r.json())
        .catch(() => ({ error: "Could not reach the server" })),
    [projectId]
  );

  const loadSaved = useCallback(async () => {
    if (!projectId) return;
    const r = await fetch(`/api/v1/redesign?projectId=${projectId}`).then((x) => x.json()).catch(() => ({ blueprints: [] }));
    setSaved(r.blueprints ?? []);
  }, [projectId]);

  const generate = useCallback(
    async (nextReq: RedesignRequirements) => {
      if (!projectId) return;
      setBusy("generate");
      const r = await post({ action: "generate", requirements: nextReq });
      setBusy(null);
      if (r.blueprint) setBlueprint(r.blueprint);
      else notify(r.error ?? "Could not generate blueprint", "error");
    },
    [projectId, post, notify]
  );

  useEffect(() => {
    loadSaved();
    generate(DEFAULT_REQUIREMENTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const toggleItem = <T extends string>(arr: T[], item: T): T[] => (arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item]);
  const copy = (id: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied((cur) => (cur === id ? null : cur)), 1500);
  };

  async function saveBlueprint() {
    if (!blueprint) return;
    setBusy("save");
    const r = await post({ action: "save_blueprint", requirements: req, name: blueprint.verdict.headline });
    setBusy(null);
    if (r.saved) { notify("Redesign blueprint saved"); loadSaved(); } else notify(r.error ?? "Save failed", "error");
  }

  async function materializeSchema() {
    setBusy("materialize");
    const r = await post({ action: "materialize_schema", requirements: req });
    setBusy(null);
    if (r.scanId) {
      notify("Proposed target schema saved as a reviewable version");
      onChanged();
      onOpenScan(r.scanId, "Diagram");
    } else notify(r.error ?? "Could not save target schema", "error");
  }

  async function applyArch() {
    setBusy("apply_arch");
    const r = await post({ action: "apply_architecture", requirements: req });
    setBusy(null);
    if (r.ok) {
      notify(`Applied to Architecture: +${r.storesAdded} store(s), +${r.flowsAdded} flow(s)`);
      onChanged();
      generate(req);
    } else notify(r.error ?? "Could not apply architecture", "error");
  }

  async function removeBlueprint(id: string) {
    const r = await post({ action: "delete_blueprint", blueprintId: id });
    if (r.ok) { setSaved((list) => list.filter((x) => x.id !== id)); notify("Blueprint deleted"); }
  }

  const chipBtn = (active: boolean) =>
    `rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${active ? "border-indigo-500 bg-indigo-500/12 text-indigo-700 dark:text-indigo-300" : "border-line text-ink-muted hover:border-indigo-400/50 hover:text-ink"}`;

  return (
    <div className="grid gap-5 xl:grid-cols-[400px_1fr]">
      {/* Left column: Product Requirements */}
      <aside className="surface h-fit space-y-5 p-5 xl:sticky xl:top-20">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-indigo-500/12 text-indigo-500"><Wand2 size={16} /></div>
          <div><h2 className="text-sm font-bold text-ink">Product requirements</h2><p className="text-[11px] text-ink-muted">Describe what you need — we audit your real databases against it.</p></div>
          <button onClick={() => { setReq(DEFAULT_REQUIREMENTS); generate(DEFAULT_REQUIREMENTS); }} title="Reset" className="ml-auto rounded-lg p-1.5 text-ink-muted hover:bg-muted"><RotateCcw size={14} /></button>
        </div>

        {/* Presets */}
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-muted">Quick scenarios</div>
          <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-1">
            {REDESIGN_PRESETS.map((p) => (
              <button key={p.id} onClick={() => { const next = { ...DEFAULT_REQUIREMENTS, ...p.patch, productBrief: req.productBrief }; setReq(next); generate(next); }} className="rounded-xl border border-line bg-muted/40 px-3 py-2 text-left transition hover:border-indigo-400/60 hover:bg-indigo-500/[.06]">
                <div className="text-xs font-semibold text-ink">{p.label}</div>
                <div className="mt-0.5 text-[11px] leading-4 text-ink-muted">{p.summary}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Free-text brief */}
        <label className="block">
          <span className="text-xs font-semibold text-ink-muted">Describe your product needs or migration goal</span>
          <textarea
            value={req.productBrief}
            onChange={(e) => setReq({ ...req, productBrief: e.target.value })}
            rows={4}
            placeholder="e.g. Growing B2B SaaS with EU GDPR residency, PCI billing accuracy, <5ms product reads, 100M order events/year, and we want to eliminate drift between Postgres and MongoDB…"
            className="mt-1.5 w-full rounded-xl border border-line bg-elevated p-3 text-xs leading-5 text-ink outline-none placeholder:text-ink-muted/60 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10"
          />
        </label>

        <div>
          <div className="mb-1.5 text-xs font-semibold text-ink-muted">Redesign goal</div>
          <div className="flex flex-wrap gap-1.5">{GOALS.map(([v, l]) => <button key={v} onClick={() => setReq({ ...req, goal: v })} className={chipBtn(req.goal === v)}>{l}</button>)}</div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold text-ink-muted">Target primary engine</div>
          <div className="flex flex-wrap gap-1.5">{ENGINES_OPT.map(([v, l]) => <button key={v} onClick={() => setReq({ ...req, targetEngine: v })} className={chipBtn(req.targetEngine === v)}>{l}</button>)}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><div className="mb-1.5 text-xs font-semibold text-ink-muted">Scale</div><div className="flex flex-wrap gap-1">{SCALES.map(([v, l]) => <button key={v} onClick={() => setReq({ ...req, scale: v })} className={chipBtn(req.scale === v)}>{l}</button>)}</div></div>
          <div><div className="mb-1.5 text-xs font-semibold text-ink-muted">Latency SLO</div><div className="flex flex-wrap gap-1">{LATENCIES.map(([v, l]) => <button key={v} onClick={() => setReq({ ...req, latency: v })} className={chipBtn(req.latency === v)}>{l}</button>)}</div></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><div className="mb-1.5 text-xs font-semibold text-ink-muted">Tenancy</div><div className="flex flex-wrap gap-1">{TENANCIES.map(([v, l]) => <button key={v} onClick={() => setReq({ ...req, tenancy: v })} className={chipBtn(req.tenancy === v)}>{l}</button>)}</div></div>
          <div><div className="mb-1.5 text-xs font-semibold text-ink-muted">Consistency</div><div className="flex flex-wrap gap-1">{CONSISTENCIES.map(([v, l]) => <button key={v} onClick={() => setReq({ ...req, consistency: v })} className={chipBtn(req.consistency === v)}>{l}</button>)}</div></div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold text-ink-muted">Capabilities needed</div>
          <div className="flex flex-wrap gap-1.5">{CAPABILITIES.map(([v, l]) => <button key={v} onClick={() => setReq({ ...req, capabilities: toggleItem(req.capabilities, v) })} className={chipBtn(req.capabilities.includes(v))}>{l}</button>)}</div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold text-ink-muted">Compliance &amp; governance</div>
          <div className="flex flex-wrap gap-1.5">{COMPLIANCES.map(([v, l]) => <button key={v} onClick={() => setReq({ ...req, compliance: toggleItem(req.compliance, v) })} className={chipBtn(req.compliance.includes(v))}>{l}</button>)}</div>
        </div>

        <button disabled={busy !== null} onClick={() => generate(req)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50">
          {busy === "generate" ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          Generate Redesign Blueprint
        </button>
      </aside>

      {/* Right column: Blueprint */}
      <div className="min-w-0 space-y-4">
        {!blueprint ? (
          <Card className="flex items-center justify-center gap-2 py-24 text-sm text-ink-muted"><Loader2 size={16} className="animate-spin" />Evaluating your databases against requirements…</Card>
        ) : (
          <>
            {/* Verdict banner */}
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-2xl bg-[#0d1424] p-6 text-white ring-1 ring-white/10">
              <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-indigo-600/25 blur-3xl" />
              <div className="relative flex flex-wrap items-start gap-5">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold uppercase tracking-[.16em] text-indigo-300">Redesign Blueprint · Deterministic</div>
                  <h2 className="mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl">{blueprint.verdict.headline}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{blueprint.verdict.summary}</p>
                  {blueprint.detectedSignals.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {blueprint.detectedSignals.map((sig, i) => <span key={i} className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-[11px] text-indigo-200"><Sparkles size={10} />{sig}</span>)}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-3">
                  {blueprint.verdict.currentDesignScore !== null && (
                    <div className="rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-center">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Schema score</div>
                      <div className="mt-1 flex items-center justify-center gap-1.5 text-lg font-bold tabular-nums">
                        <span className="text-slate-400">{blueprint.verdict.currentDesignScore}</span>
                        <ArrowRight size={14} className="text-indigo-400" />
                        <span className="text-emerald-300">{blueprint.verdict.projectedDesignScore}</span>
                      </div>
                      <div className="text-[10px] text-emerald-300/90">{blueprint.verdict.findingsResolvedCount} findings fixed</div>
                    </div>
                  )}
                  <div className="rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-center">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">System score</div>
                    <div className="mt-1 flex items-center justify-center gap-1.5 text-lg font-bold tabular-nums">
                      <span className="text-slate-400">{blueprint.verdict.currentArchitectureScore}</span>
                      <ArrowRight size={14} className="text-indigo-400" />
                      <span className="text-emerald-300">{blueprint.verdict.projectedArchitectureScore}</span>
                    </div>
                    <div className="text-[10px] text-slate-400">{blueprint.targetStores.length} target stores</div>
                  </div>
                </div>
              </div>

              <div className="relative mt-5 flex flex-wrap gap-2 border-t border-white/10 pt-4">
                {canWrite && blueprint.targetModel && (
                  <button disabled={busy !== null} onClick={materializeSchema} className="flex items-center gap-1.5 rounded-xl bg-indigo-500 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-indigo-400 disabled:opacity-50">
                    {busy === "materialize" ? <Loader2 size={13} className="animate-spin" /> : <Layers size={13} />}
                    Save target schema as version
                  </button>
                )}
                {canWrite && (
                  <button disabled={busy !== null} onClick={saveBlueprint} className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-white/10 disabled:opacity-50">
                    <BookmarkPlus size={13} />Save blueprint
                  </button>
                )}
                {canWrite && (blueprint.targetStores.some((s) => s.status === "new") || blueprint.targetFlows.some((f) => f.isNew)) && (
                  <button disabled={busy !== null} onClick={applyArch} className="flex items-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3.5 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-50">
                    <Workflow size={13} />Apply new stores &amp; flows
                  </button>
                )}
                <button onClick={() => onOpenHandoff(req.productBrief || blueprint.verdict.headline, blueprint.verdict.recommendedPrimaryEngine)} className="ml-auto flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-indigo-200 transition hover:bg-white/10">
                  <Sparkles size={13} />Export to ChatGPT / Claude
                </button>
              </div>
            </motion.section>

            {/* Tabs */}
            <Card padded={false}>
              <div className="overflow-x-auto border-b border-line px-4 py-3">
                <Segmented<Tab>
                  layoutId="redesign-tab"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: "overview", label: "Gap analysis & actions", count: blueprint.gaps.length },
                    { value: "architecture", label: "Target architecture", count: blueprint.targetStores.length },
                    { value: "ddl", label: "DDL, RLS & migrations", count: blueprint.schemaActions.length },
                    { value: "cutover", label: "Cutover roadmap", count: blueprint.cutoverPhases.length },
                    { value: "saved", label: "Saved", count: saved.length },
                  ]}
                />
              </div>

              <div className="p-5">
                {tab === "overview" && (
                  <div className="space-y-5">
                    <div>
                      <h3 className="text-sm font-bold text-ink">Requirement gap analysis ({blueprint.gaps.length})</h3>
                      <p className="mt-0.5 text-xs text-ink-muted">Concrete ways your current schemas and datastores conflict with the requirements above.</p>
                      <div className="mt-3 space-y-2.5">
                        {blueprint.gaps.map((g) => (
                          <div key={g.id} className={`rounded-xl border border-l-4 border-line bg-muted/30 p-4 ${sev(g.severity).edge}`}>
                            <div className="flex flex-wrap items-center gap-2">
                              <SeverityChip severity={g.severity} />
                              <span className="text-sm font-semibold text-ink">{g.title}</span>
                              <Chip className="bg-muted text-ink-muted ring-line">{g.area.replace("_", " ")}</Chip>
                              <code className="ml-auto text-[10px] text-ink-muted">{g.id}</code>
                            </div>
                            <div className="mt-2 grid gap-2 text-xs leading-5 md:grid-cols-2">
                              <div><span className="font-semibold text-ink">Requirement:</span> <span className="text-ink-muted">{g.requirement}</span><br /><span className="font-semibold text-ink">Observed:</span> <span className="text-ink-muted">{g.currentEvidence}</span></div>
                              <div className="rounded-lg bg-emerald-500/8 p-2.5"><span className="font-semibold text-emerald-700 dark:text-emerald-300">Redesign action:</span> <span className="text-ink">{g.remediation}</span></div>
                            </div>
                          </div>
                        ))}
                        {!blueprint.gaps.length && <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">No gaps detected between your current system and these requirements.</p>}
                      </div>
                    </div>

                    {blueprint.schemaActions.length > 0 && (
                      <div>
                        <h3 className="text-sm font-bold text-ink">Synthesized schema improvements ({blueprint.schemaActions.length})</h3>
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {blueprint.schemaActions.map((a, i) => (
                            <div key={i} className="rounded-xl border border-line bg-muted/30 p-3.5">
                              <div className="flex items-center gap-2"><CheckCircle2 size={14} className="shrink-0 text-emerald-500" /><span className="text-xs font-semibold text-ink">{a.title}</span></div>
                              <div className="mt-1 font-mono text-[11px] text-indigo-600 dark:text-indigo-300">{a.target}</div>
                              <p className="mt-1 text-xs leading-5 text-ink-muted">{a.detail}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="rounded-xl border border-line bg-muted/40 p-4">
                      <div className="flex items-center gap-2 text-xs font-bold text-ink"><AlertTriangle size={14} className="text-amber-500" />Trade-offs &amp; limitations</div>
                      <ul className="mt-2 space-y-1 text-xs leading-5 text-ink-muted">
                        {[...blueprint.tradeoffs, ...blueprint.limitations].map((t, i) => <li key={i}>• {t}</li>)}
                      </ul>
                    </div>
                  </div>
                )}

                {tab === "architecture" && (
                  <div className="space-y-5">
                    <div>
                      <h3 className="text-sm font-bold text-ink">Target datastores ({blueprint.targetStores.length})</h3>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {blueprint.targetStores.map((s) => (
                          <div key={s.name} className="rounded-2xl border border-line bg-muted/30 p-4">
                            <div className="flex items-center gap-3">
                              <EngineBadge engine={s.engine} size={36} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-sm font-bold text-ink">{s.name}</span>
                                  <Chip className={STATUS_BADGE[s.status] ?? STATUS_BADGE.keep}>{s.status.replace("_", " ")}</Chip>
                                </div>
                                <div className="text-[11px] text-ink-muted">{engineLabel(s.engine)} · role: <b className="text-ink">{s.role}</b></div>
                              </div>
                            </div>
                            <p className="mt-2.5 text-xs leading-5 text-ink-muted">{s.rationale}</p>
                            {s.schemas.length > 0 && (
                              <div className="mt-2.5 flex flex-wrap gap-1">{s.schemas.slice(0, 8).map((ns) => <code key={ns} className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-ink ring-1 ring-line">{ns}</code>)}</div>
                            )}
                            <ul className="mt-2.5 space-y-1 border-t border-line/60 pt-2 text-[11px] text-ink-muted">
                              {s.keyPolicies.map((p) => <li key={p} className="flex items-center gap-1.5"><ShieldCheck size={11} className="shrink-0 text-emerald-500" />{p}</li>)}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="flex items-center gap-2 text-sm font-bold text-ink"><GitBranch size={15} className="text-indigo-500" />Target data flows ({blueprint.targetFlows.length})</h3>
                      <div className="mt-3 space-y-2">
                        {blueprint.targetFlows.map((f, i) => (
                          <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-muted/30 p-3.5 text-xs">
                            <span className="font-bold text-ink">{f.from}</span>
                            <ArrowRight size={13} className="text-indigo-500" />
                            <span className="font-bold text-ink">{f.to}</span>
                            <Chip className="bg-indigo-500/12 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300">{f.kind}</Chip>
                            {f.isNew && <Chip className="bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300">proposed</Chip>}
                            <span className="w-full text-ink-muted sm:w-auto sm:flex-1">{f.rationale}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {blueprint.verdict.engineChangeRecommended && blueprint.artifacts.transformSummary && (
                      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-indigo-400/30 bg-indigo-500/10 p-4 text-xs">
                        <FileCode2 size={16} className="text-indigo-500" />
                        <div className="flex-1 text-ink">
                          <b>Cross-engine conversion ready:</b> {blueprint.artifacts.transformSummary.fieldsMapped} fields mapped ({blueprint.artifacts.transformSummary.lossy} lossy, {blueprint.artifacts.transformSummary.embedded} embedded).
                        </div>
                        <button onClick={() => onTransform(blueprint.verdict.recommendedPrimaryEngine)} className="rounded-lg bg-indigo-600 px-3 py-1.5 font-bold text-white hover:bg-indigo-500">Open in Transform Studio</button>
                      </div>
                    )}
                  </div>
                )}

                {tab === "ddl" && (
                  <div className="space-y-4">
                    {blueprint.artifacts.migrationValidation && (
                      <div className="rounded-xl border border-line bg-muted/40 p-3.5">
                        <div className="flex items-center gap-2 text-xs font-bold text-ink">
                          <CheckCircle2 size={14} className={blueprint.artifacts.migrationValidation.ok ? "text-emerald-500" : "text-amber-500"} />
                          Static migration checks ({blueprint.artifacts.migrationValidation.ok ? "passed" : "review required"})
                        </div>
                        <div className="mt-2 grid gap-1 sm:grid-cols-2">
                          {blueprint.artifacts.migrationValidation.checks.map((c) => <div key={c} className="text-[11px] text-ink-muted">• {c}</div>)}
                        </div>
                      </div>
                    )}
                    {blueprint.artifacts.migrationUp && <CodeBox id="mig" title="Migration UP script (from current schema → redesigned)" code={blueprint.artifacts.migrationUp} filename="redesign-migration-up.sql" copied={copied} onCopy={copy} />}
                    {blueprint.artifacts.supplementarySql && <CodeBox id="supp" title="RLS policies & declarative partitioning SQL" code={blueprint.artifacts.supplementarySql} filename="redesign-policies-partitioning.sql" copied={copied} onCopy={copy} />}
                    {blueprint.artifacts.redisPolicyScript && <CodeBox id="redis" title="Redis TTL & eviction policy recommendations" code={blueprint.artifacts.redisPolicyScript} filename="redis-policy-fixes.txt" copied={copied} onCopy={copy} />}
                    {blueprint.artifacts.targetDdl && <CodeBox id="ddl" title="Complete target schema DDL" code={blueprint.artifacts.targetDdl} filename="redesign-target-schema.sql" copied={copied} onCopy={copy} />}
                    {blueprint.artifacts.etlScript && <CodeBox id="etl" title="Generated cross-engine ETL script (Node.js)" code={blueprint.artifacts.etlScript} filename="redesign-etl.mjs" copied={copied} onCopy={copy} />}
                    {!blueprint.artifacts.targetDdl && !blueprint.artifacts.redisPolicyScript && <EmptyState icon={Code2} title="No schema artifacts yet" hint="Import or connect a database in Connect so DB Architect can synthesize concrete DDL and migrations." />}
                  </div>
                )}

                {tab === "cutover" && (
                  <ol className="space-y-3">
                    {blueprint.cutoverPhases.map((p) => (
                      <li key={p.phase} className="rounded-2xl border border-line bg-muted/30 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-xs font-bold text-white">{p.phase}</span>
                          <h4 className="text-sm font-bold text-ink">{p.title}</h4>
                          <Chip className="bg-muted text-ink-muted ring-line">{p.durationHint}</Chip>
                          <Chip className={p.downtimeRisk === "none" ? "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300" : "bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300"}>
                            {p.downtimeRisk === "none" ? "zero downtime" : p.downtimeRisk.replace("_", " ")}
                          </Chip>
                        </div>
                        <ul className="mt-3 space-y-1.5 text-xs leading-5 text-ink">
                          {p.steps.map((st, i) => <li key={i} className="flex gap-2"><Check size={13} className="mt-0.5 shrink-0 text-indigo-500" />{st}</li>)}
                        </ul>
                        <div className="mt-3 grid gap-2 border-t border-line/60 pt-3 text-[11px] md:grid-cols-2">
                          <div><b className="text-emerald-600 dark:text-emerald-400">Verification gate:</b> <span className="text-ink-muted">{p.gate}</span></div>
                          <div><b className="text-amber-600 dark:text-amber-400">Rollback path:</b> <span className="text-ink-muted">{p.rollback}</span></div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}

                {tab === "saved" && (
                  <div className="space-y-2">
                    {saved.map((b) => (
                      <div key={b.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-muted/30 p-3.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-ink">{b.name}</span>
                            <Chip className="bg-muted text-ink-muted ring-line">{b.kind === "ai_proposal" ? "AI proposal" : b.goal.replace("_", " ")}</Chip>
                          </div>
                          <div className="mt-0.5 text-[11px] text-ink-muted">{new Date(b.createdAt).toLocaleString()}</div>
                        </div>
                        {b.kind === "redesign" && b.blueprint?.verdict && (
                          <button onClick={() => { setBlueprint(b.blueprint); if (b.requirements?.goal) setReq({ ...DEFAULT_REQUIREMENTS, ...b.requirements }); setTab("overview"); }} className="rounded-lg border border-line bg-elevated px-3 py-1.5 text-xs font-semibold text-ink hover:bg-muted">Load</button>
                        )}
                        {canWrite && <button onClick={() => removeBlueprint(b.id)} aria-label="Delete blueprint" className="rounded-lg p-1.5 text-ink-muted hover:bg-red-500/10 hover:text-red-500"><Trash2 size={14} /></button>}
                      </div>
                    ))}
                    {!saved.length && <p className="py-6 text-center text-sm text-ink-muted">No saved blueprints yet. Click &ldquo;Save blueprint&rdquo; above to keep a snapshot for your team.</p>}
                  </div>
                )}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function CodeBox({ id, title, code, filename, copied, onCopy }: { id: string; title: string; code: string; filename: string; copied: string | null; onCopy: (id: string, text: string) => void }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs font-bold text-ink">{title}</span>
        <button onClick={() => onCopy(id, code)} className="ml-auto flex items-center gap-1 rounded-lg border border-line bg-elevated px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-muted">
          {copied === id ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}{copied === id ? "Copied" : "Copy"}
        </button>
        <button onClick={() => downloadText(filename, code)} className="flex items-center gap-1 rounded-lg border border-line bg-elevated px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-muted">
          <Download size={12} />Download
        </button>
      </div>
      <pre className="scroll-thin max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 font-mono text-[11px] leading-5 text-emerald-200">{code}</pre>
    </div>
  );
}
