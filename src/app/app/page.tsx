"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowRightLeft, Compass, ListChecks, Bot, Cable, CheckCircle2, ChevronDown, Database, FileDiff, FileText, FolderKanban, GitCompareArrows, History, LayoutDashboard, Loader2, LogOut, Menu, Network, Plus, ScanSearch, Settings2, ShieldCheck, TableProperties, X, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import AuthScreen from "@/components/auth-screen";
import ExplorerView from "@/components/views/explorer-view";
import AnalysisView from "@/components/views/analysis-view";
import AssistantView from "@/components/views/assistant-view";
import { HistoryView, ReportsView } from "@/components/views/share-views";
import ThemeToggle from "@/components/theme-toggle";
import Sidebar, { type NavItem, type NavSection } from "@/components/app-shell/sidebar";
import TopBar from "@/components/app-shell/topbar";
import CommandPalette, { type PaletteItem } from "@/components/app-shell/command-palette";
import { clearToken, getToken, setToken, UNAUTHORIZED_EVENT } from "@/lib/client-session";
import { ViewFade } from "@/components/motion";
import { SEVERITY, SEVERITY_ORDER, SeverityBar } from "@/components/ui";
import DiagramStudio, { type StoredLayout } from "@/components/diagram-studio";
import WorkspaceSettings from "@/components/workspace-settings";
import ConnectPanel from "@/components/connect-panel";
import TransformStudio from "@/components/transform-studio";
import AdvisorPanel from "@/components/advisor-panel";
import RoadmapPanel from "@/components/roadmap-panel";
import { engineLabel } from "@/lib/engines";
import { FIXTURE_ECOMMERCE_SQL, FIXTURE_SAAS_YAML, FIXTURE_MONGO_JSON, FIXTURE_MYSQL_SQL } from "@/lib/fixtures";

import { normFinding, type FindingRow, type ModelT, type ScanRow } from "@/components/views/types";

const NAV = ["Dashboard", "Connect", "Explorer", "Diagram", "Analysis", "Transform", "Advisor", "Diff & Migrate", "Reports", "AI Assistant", "History", "Roadmap", "Settings"] as const;
type View = (typeof NAV)[number];
const NAV_ICONS: Record<View, typeof LayoutDashboard> = { Dashboard: LayoutDashboard, Connect: Cable, Explorer: TableProperties, Diagram: Network, Analysis: ScanSearch, Transform: ArrowRightLeft, Advisor: Compass, "Diff & Migrate": FileDiff, Reports: FileText, "AI Assistant": Bot, History, Roadmap: ListChecks, Settings: Settings2 };
const SEV_COLOR: Record<string, string> = { critical: "bg-red-600", high: "bg-orange-500", medium: "bg-amber-500", low: "bg-sky-600", info: "bg-muted0" };

/* ── authenticated application shell ───────────────────── */
type ProjectItem = { id: string; name: string; description?: string; role?: string; organizationName?: string };
type Identity = { id: string; email: string; name: string };

export default function DBArchitect() {
  const [auth, setAuth] = useState<"loading" | "anonymous" | "ready" | "error">("loading");
  const [user, setUser] = useState<Identity | null>(null);
  const [view, setView] = useState<View>("Dashboard");
  const [mobileNav, setMobileNav] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [projectDialog, setProjectDialog] = useState(false);
  const [transformTarget, setTransformTarget] = useState<string | undefined>(undefined);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [projectId, setProjectId] = useState("");
  const [dash, setDash] = useState<{ stats?: Record<string, unknown>; recentScans?: ScanRow[]; latestScanId?: string | null } | null>(null);
  const [scans, setScans] = useState<ScanRow[]>([]);
  const [scanId, setScanId] = useState("");
  const [detail, setDetail] = useState<{ scan: ScanRow; version: { model: ModelT; label?: string; version?: number } | null; findings: FindingRow[]; layout: { svg?: string; layout?: StoredLayout } | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ text: string; kind: "success" | "error" } | null>(null);

  const notify = useCallback((text: string, kind: "success" | "error" = "success") => {
    setToast({ text, kind });
    window.setTimeout(() => setToast((current) => current?.text === text ? null : current), 5000);
  }, []);
  const setMsg = useCallback((text: string) => notify(text, /fail|error|✗|required|select|pick|first|blocked|incorrect/i.test(text) ? "error" : "success"), [notify]);

  // Identity resolution. Only a definitive answer from the identity endpoint
  // decides signed-in vs signed-out; network errors get one retry and then a
  // recovery screen (never a silent sign-out, never a fake user).
  const loadIdentity = useCallback(async () => {
    const probe = async (): Promise<"error" | Identity | null> => {
      try {
        const r = await fetch("/api/v1/auth", { cache: "no-store" });
        if (!r.ok) return r.status === 401 ? null : "error";
        const j = await r.json();
        return j?.user ?? null;
      } catch { return "error"; }
    };
    let result = await probe();
    if (result === "error") { await new Promise((r) => setTimeout(r, 1200)); result = await probe(); }
    if (result === "error") { setAuth("error"); return; }
    if (result) { setUser(result); setAuth("ready"); } else { clearToken(); setAuth("anonymous"); }
  }, []);
  useEffect(() => { if (auth === "loading") loadIdentity(); }, [auth, loadIdentity]);
  useEffect(() => {
    const onUnauthorized = () => { clearToken(); setUser(null); setAuth("anonymous"); setProjects([]); setDetail(null); };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => { window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((v) => !v); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") { e.preventDefault(); setProjectDialog(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const loadProjects = useCallback(async () => {
    const r = await fetch("/api/v1/projects").then((x) => x.json()).catch(() => ({ projects: [] }));
    if (r.error) { notify(r.error, "error"); return; }
    setProjects(r.projects ?? []);
    setProjectId((current) => current && r.projects?.some((p: ProjectItem) => p.id === current) ? current : r.projects?.[0]?.id ?? "");
  }, [notify]);
  const loadDash = useCallback(async (pid: string) => {
    if (!pid) return;
    const r = await fetch(`/api/v1/dashboard?projectId=${pid}`).then((x) => x.json()).catch(() => null);
    if (r && !r.error) {
      setDash(r); setScans(r.recentScans ?? []);
      setScanId((current) => current && r.recentScans?.some((s: ScanRow) => s.id === current) ? current : r.latestScanId ?? "");
    } else if (r?.error) notify(r.error, "error");
  }, [notify]);
  const loadDetail = useCallback(async (sid: string) => {
    if (!sid) { setDetail(null); return; }
    setLoading(true);
    const r = await fetch(`/api/v1/scans/${sid}`).then((x) => x.json()).catch(() => null);
    setLoading(false);
    if (r?.version) setDetail(r); else if (r?.error) notify(r.error, "error");
  }, [notify]);

  useEffect(() => { if (auth === "ready") loadProjects(); }, [auth, loadProjects]);
  useEffect(() => { if (projectId) { setDetail(null); setScanId(""); loadDash(projectId); } }, [projectId, loadDash]);
  useEffect(() => { loadDetail(scanId); }, [scanId, loadDetail]);

  async function logout() {
    await fetch("/api/v1/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) }).catch(() => undefined);
    clearToken();
    setUser(null); setProjects([]); setProjectId(""); setScanId(""); setDetail(null); setDash(null); setScans([]); setAuth("anonymous");
  }
  function go(next: View, sid?: string) { setView(next); if (sid !== undefined) setScanId(sid); setMobileNav(false); }

  if (auth === "loading") return <div className="grid min-h-screen place-items-center bg-[#0b1120] text-white"><motion.div initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500"><Database size={20} /></span><div><div className="text-sm font-semibold">DB Architect</div><div className="flex items-center gap-2 text-xs text-ink-muted"><Loader2 size={12} className="animate-spin" />Opening workspace…</div></div></motion.div></div>;
  if (auth === "error") return <div className="grid min-h-screen place-items-center bg-[#0b1120] px-6 text-center text-white"><div className="max-w-sm"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white/10"><Database size={22} /></span><h1 className="mt-4 text-lg font-semibold">Can&apos;t reach the workspace</h1><p className="mt-2 text-sm leading-6 text-slate-400">The server isn&apos;t answering right now (a cold start or a dropped connection). You are still signed in.</p><div className="mt-5 flex justify-center gap-2"><button onClick={() => setAuth("loading")} className="rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-bold hover:bg-indigo-400">Try again</button><button onClick={logout} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-slate-300">Sign out</button></div></div></div>;
  if (auth === "anonymous") return <AuthScreen onAuthenticated={(signedIn) => { if (signedIn) { if (signedIn.token) setToken(signedIn.token); setUser({ id: signedIn.id, email: signedIn.email, name: signedIn.name }); setAuth("ready"); } else { loadIdentity(); } }} />;

  const model = (detail?.version?.model as ModelT) ?? null;
  const findings = (detail?.findings ?? []).map(normFinding);
  const project = projects.find((p) => p.id === projectId);
  const stats = (dash?.stats ?? {}) as Record<string, number>;
  const NAV_SECTIONS: NavSection[] = [
    { title: "Overview", ids: ["Dashboard", "Connect"] },
    { title: "Understand", ids: ["Explorer", "Diagram", "Analysis"] },
    { title: "Decide", ids: ["Transform", "Advisor", "Diff & Migrate"] },
    { title: "Share", ids: ["Reports", "AI Assistant", "History"] },
    { title: "Workspace", ids: ["Roadmap", "Settings"] },
  ];
  const navItems: NavItem[] = NAV.map((n) => ({
    id: n, label: n, icon: NAV_ICONS[n],
    badge: n === "Analysis" ? (stats.findings ?? 0) || undefined : undefined,
    isNew: n === "Transform" || n === "Advisor",
  }));
  const paletteItems: PaletteItem[] = [
    ...NAV.map((n) => ({ id: `nav-${n}`, label: n, group: "Go to", icon: NAV_ICONS[n], run: () => go(n) })),
    { id: "new-project", label: "Create a new project", group: "Actions", hint: "⌘N", icon: Plus, run: () => setProjectDialog(true) },
    ...(project?.role !== "viewer" ? [{ id: "add-schema", label: "Add a schema or database", group: "Actions", icon: Cable, run: () => go("Connect") }] : []),
    ...projects.filter((p) => p.id !== projectId).map((p) => ({ id: `project-${p.id}`, label: p.name, hint: "project", group: "Projects", icon: FolderKanban, run: () => setProjectId(p.id) })),
    ...scans.map((s) => ({ id: `scan-${s.id}`, label: `${s.engine} · ${s.id.slice(0, 8)}`, hint: s.status, group: "Schema versions", icon: Database, run: () => { setScanId(s.id); go("Explorer", s.id); } })),
  ];

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <Sidebar
        items={navItems}
        sections={NAV_SECTIONS}
        active={view}
        onNavigate={(id) => go(id as View)}
        collapsed={navCollapsed}
        onCollapse={() => setNavCollapsed((v) => !v)}
        mobileOpen={mobileNav}
        onCloseMobile={() => setMobileNav(false)}
        projectName={project?.name}
        orgName={project?.organizationName}
        user={user}
        onSignOut={logout}
        onNewProject={() => setProjectDialog(true)}
      />
      <AnimatePresence>{mobileNav && <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-label="Close navigation" onClick={() => setMobileNav(false)} className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm lg:hidden" />}</AnimatePresence>
      <div className={`transition-[padding] duration-300 ${navCollapsed ? "lg:pl-[76px]" : "lg:pl-[252px]"}`}>
        <TopBar
          project={project}
          projects={projects}
          onProjectChange={(id) => setProjectId(id)}
          scans={scans}
          scanId={scanId}
          onScanChange={setScanId}
          onMenu={() => setMobileNav(true)}
          onAddSchema={() => go("Connect")}
          onOpenPalette={() => setPaletteOpen(true)}
          onNewProject={() => setProjectDialog(true)}
          view={view}
          canWrite={project?.role !== "viewer"}
        />
        <main className="mx-auto max-w-[1500px] p-4 sm:p-6">
          <div className="mb-5 flex items-end justify-between gap-4"><div><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-500">{project?.name ?? "Workspace"}</div><motion.h1 key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .3 }} className="mt-1 text-2xl font-bold tracking-tight text-ink">{view}</motion.h1><p className="mt-1 text-xs text-ink-muted">{viewSubtitle(view, model, detail?.version?.label)}</p></div>{loading && <div className="flex items-center gap-2 text-xs text-ink-muted"><Loader2 size={14} className="animate-spin" />Loading schema…</div>}</div>
          <AnimatePresence mode="wait"><ViewFade k={view}>
          {view === "Dashboard" && <Dashboard dash={dash} scans={scans} findings={findings} model={model} go={go} projectId={projectId} reload={() => loadDash(projectId)} setMsg={setMsg} />}
          {view === "Connect" && (project?.role === "viewer" ? <EmptyState title="Read-only workspace role" hint="Viewers can explore schemas, diagrams and reports. Ask an admin for developer access to import or scan." /> : <ConnectPanel projectId={projectId} onImported={(sid) => { setScanId(sid); loadDash(projectId); go("Explorer", sid); }} setMsg={setMsg} />)}
          {view === "Explorer" && <ExplorerView model={model} findings={findings} onOpenDiagram={() => go("Diagram")} onOpenAnalysis={() => go("Analysis")} />}
          {view === "Transform" && <TransformStudio scanId={scanId} projectId={projectId} canWrite={project?.role !== "viewer"} model={model} initialTarget={transformTarget} onOpenScan={(sid) => { loadDash(projectId); go("Diagram", sid); }} notify={notify} />}
          {view === "Advisor" && <AdvisorPanel model={model} onTransform={(target) => { setTransformTarget(target); go("Transform"); }} />}
          {view === "Roadmap" && <RoadmapPanel />}
          {view === "Diagram" && <DiagramStudio model={model} stored={detail?.layout?.layout ?? null} scanId={scanId} onToast={notify} />}
          {view === "Analysis" && <AnalysisView findings={findings} scanId={scanId} canReview={project?.role === "architect" || project?.role === "admin" || project?.role === "owner"} onStatusChanged={() => loadDash(projectId)} />}
          {view === "Diff & Migrate" && <DiffMigrate projectId={projectId} scans={scans} currentScanId={scanId} setMsg={setMsg} />}
          {view === "Reports" && <ReportsView scanId={scanId} model={model} findingsCount={findings.length} onOpenDiagram={() => go("Diagram")} />}
          {view === "AI Assistant" && <AssistantView scanId={scanId} model={model} />}
          {view === "History" && <HistoryView projectId={projectId} scans={scans} currentScanId={scanId} onOpen={(id) => go("Explorer", id)} reload={() => loadDash(projectId)} />}
          {view === "Settings" && <WorkspaceSettings projectId={projectId} user={user} onToast={notify} />}
          </ViewFade></AnimatePresence>
        </main>
        <footer className="mx-auto flex max-w-[1500px] flex-wrap gap-2 px-6 pb-8 text-[11px] text-ink-muted"><span>Deterministic rules first. Evidence over guesswork.</span><span className="ml-auto">DB Architect · schema model v1 · PostgreSQL · MySQL · SQLite · MongoDB</span></footer>
      </div>
      <AnimatePresence>{toast && <motion.div key={toast.text} role="status" initial={{ opacity: 0, y: 24, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .98 }} transition={{ type: "spring", stiffness: 380, damping: 30 }} className={`glass fixed bottom-5 right-5 z-[80] flex max-w-md items-start gap-3 rounded-2xl border p-4 text-sm shadow-2xl ${toast.kind === "error" ? "border-red-300/60 text-red-700 dark:text-red-300" : "border-emerald-300/60 text-emerald-700 dark:text-emerald-300"}`}>{toast.kind === "error" ? <XCircle size={19} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={19} className="mt-0.5 shrink-0" />}<span className="text-ink">{toast.text}</span><button onClick={() => setToast(null)} className="ml-2 text-ink-muted"><X size={15} /></button></motion.div>}</AnimatePresence>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />
      <AnimatePresence>{projectDialog && <ProjectDialog onClose={() => setProjectDialog(false)} onCreated={(p) => { setProjectDialog(false); setProjects((all) => [...all, p]); setProjectId(p.id); notify(`Project “${p.name}” created`); }} onError={(e) => notify(e, "error")} />}</AnimatePresence>
    </div>
  );
}

function viewSubtitle(view: View, model: ModelT | null, label?: string) {
  if (view === "Dashboard") return "Workspace health, recent scans and the next useful action.";
  if (view === "Connect") return "Import a schema dump or introspect a read-only PostgreSQL, MySQL or MongoDB database.";
  if (view === "Transform") return "Convert a schema to another engine — decisions, field mapping, live data preview and an ETL runbook.";
  if (view === "Advisor") return "Which database fits the workload? Explainable scoring across ten widely used engines.";
  if (view === "Roadmap") return "Specification status, the top-10 priorities and engine support.";
  if (model) return `${engineLabel(model.engine)} · ${model.database} · ${model.entities.length} entities${label ? ` · ${label}` : ""}`;
  return "Select a schema version to begin.";
}

function ProjectDialog({ onClose, onCreated, onError }: { onClose: () => void; onCreated: (p: ProjectItem) => void; onError: (e: string) => void }) {
  const [form, setForm] = useState({ name: "", description: "", engine: "postgres" });
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) { e.preventDefault(); setBusy(true); const r = await fetch("/api/v1/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }).then((x) => x.json()); setBusy(false); if (r.project) onCreated(r.project); else onError(r.error ?? "Could not create project"); }
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><motion.form initial={{ opacity: 0, y: 24, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .98 }} transition={{ type: "spring", stiffness: 360, damping: 30 }} onSubmit={submit} className="surface w-full max-w-md p-6 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Create project</h2><p className="mt-1 text-xs text-ink-muted">Group connections, scans, findings and migrations.</p></div><button type="button" onClick={onClose}><X size={18} /></button></div><label className="mt-5 block text-xs font-semibold text-ink-muted">Project name<input autoFocus required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5 w-full rounded-xl border border-line px-3 py-2.5 text-sm outline-none focus:border-indigo-500" placeholder="Billing platform" /></label><label className="mt-4 block text-xs font-semibold text-ink-muted">Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1.5 w-full rounded-xl border border-line px-3 py-2.5 text-sm outline-none focus:border-indigo-500" rows={3} placeholder="What does this database support?" /></label><label className="mt-4 block text-xs font-semibold text-ink-muted">Primary engine<select value={form.engine} onChange={(e) => setForm({ ...form, engine: e.target.value })} className="mt-1.5 w-full rounded-xl border border-line bg-elevated px-3 py-2.5 text-sm"><option value="postgres">PostgreSQL</option><option value="mongodb">MongoDB</option></select></label><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-muted">Cancel</button><button disabled={busy} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? "Creating…" : "Create project"}</button></div></motion.form></motion.div>;
}

/* ── Dashboard ─────────────────────────────────────────── */
function Dashboard({ dash, scans, findings, model, go, projectId, reload, setMsg }: { dash: { stats?: Record<string, unknown>; recentScans?: ScanRow[] } | null; scans: ScanRow[]; findings: ReturnType<typeof normFinding>[]; model: ModelT | null; go: (v: View, sid?: string) => void; projectId: string; reload: () => void; setMsg: (s: string) => void }) {
  const stats = (dash?.stats ?? {}) as Record<string, number>;
  const sev = (((dash?.stats ?? {}) as Record<string, unknown>).bySeverity ?? {}) as Record<string, number>;
  const [seeding, setSeeding] = useState<string | null>(null);
  async function seedDemo(kind: "pg" | "saas" | "mongo" | "mysql") {
    if (!projectId) { setMsg("Create or select a project first"); return; }
    setSeeding(kind);
    const payload = kind === "mysql" ? { projectId, filename: "shop.sql", content: FIXTURE_MYSQL_SQL, label: "MySQL shop" } : kind === "pg" ? { projectId, filename: "ecommerce.sql", content: FIXTURE_ECOMMERCE_SQL, label: "E-commerce v1" } : kind === "saas" ? { projectId, filename: "saas.yaml", content: FIXTURE_SAAS_YAML, label: "Multi-tenant SaaS" } : { projectId, filename: "social.json", content: FIXTURE_MONGO_JSON, database: "social_demo", label: "MongoDB social" };
    const r = await fetch("/api/v1/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then((x) => x.json());
    setSeeding(null);
    if (r.scanId) { setMsg(`${kind === "mongo" ? "MongoDB social" : kind === "pg" ? "PostgreSQL e-commerce" : kind === "mysql" ? "MySQL shop" : "SaaS"} schema analyzed`); reload(); go("Explorer", r.scanId); }
    else setMsg(`Seed failed: ${r.error ?? "unknown"}`);
  }
  const cards = [
    { label: "Entities", value: stats.entities ?? model?.entities.length ?? 0, note: `${stats.fields ?? 0} fields`, icon: TableProperties },
    { label: "Indexes", value: stats.indexes ?? 0, note: "across latest schema", icon: ScanSearch },
    { label: "Relationships", value: stats.relationships ?? model?.relationships.length ?? 0, note: "explicit + inferred", icon: GitCompareArrows },
    { label: "Connections", value: stats.connections ?? 0, note: `${stats.healthyConnections ?? 0} healthy`, icon: Cable },
  ];
  const totalFindings = (stats.findings as number) ?? findings.length;
  return <div className="space-y-5">
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5 }} className="relative overflow-hidden rounded-2xl bg-[#101828] text-white shadow-sm"><div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-indigo-600/25 blur-3xl" /><div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-violet-600/15 blur-3xl" /><div className="flex flex-col gap-6 p-6 md:flex-row md:items-center md:p-7"><div className="flex-1"><div className="text-xs font-semibold text-indigo-300">{scans.length ? "LATEST SCHEMA HEALTH" : "START YOUR FIRST ANALYSIS"}</div><h2 className="mt-2 text-2xl font-semibold tracking-tight">{scans.length ? `${model?.database ?? "Database"} is mapped and analyzed.` : "Turn a database into engineering knowledge."}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">{scans.length ? `${totalFindings} open findings across ${stats.entities ?? 0} entities. Review evidence before changing indexes, constraints or document design.` : "Upload SQL, YAML or MongoDB JSON, or connect a read-only database. You can also start with a complete sample schema."}</p><div className="mt-5 flex flex-wrap gap-2">{scans.length > 0 ? <><button onClick={() => go("Diagram")} className="rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-bold hover:bg-indigo-400">Open diagram</button><button onClick={() => go("Analysis")} className="rounded-xl border border-white/10 bg-elevated/5 px-4 py-2.5 text-sm font-semibold text-slate-200">Review {totalFindings} findings</button><button onClick={() => go("Connect")} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-muted">New scan</button></> : <><button onClick={() => go("Connect")} className="rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-bold">Add a database</button><button disabled={seeding !== null} onClick={() => seedDemo("pg")} className="rounded-xl border border-white/10 bg-elevated/5 px-4 py-2.5 text-sm font-semibold">{seeding === "pg" ? "Analyzing…" : "Try PostgreSQL demo"}</button><button disabled={seeding !== null} onClick={() => seedDemo("mongo")} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-muted">{seeding === "mongo" ? "Analyzing…" : "Try MongoDB demo"}</button><button disabled={seeding !== null} onClick={() => seedDemo("mysql")} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-ink-muted">{seeding === "mysql" ? "Analyzing…" : "Try MySQL demo"}</button></>}</div></div>{scans.length > 0 && <div className="grid w-full max-w-[260px] grid-cols-[1fr_auto] items-center gap-4 rounded-2xl border border-white/10 bg-elevated/5 p-5"><div><div className="text-xs text-ink-muted">Design score</div><div className="mt-1 text-[11px] leading-4 text-ink-muted">Heuristic, not a runtime performance score</div></div><ScoreRing value={Number(stats.designScore ?? 0)} /></div>}</div></motion.section>
    <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: .07 } } }} className="grid grid-cols-2 gap-3 xl:grid-cols-4">{cards.map((c) => <motion.div variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }} key={c.label} className="surface card-hover p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-ink-muted">{c.label}</span><c.icon size={16} className="text-slate-300" /></div><div className="mt-2 text-2xl font-bold tracking-tight">{Number(c.value ?? 0)}</div><div className="mt-1 text-[11px] text-ink-muted">{c.note}</div></motion.div>)}</motion.div>
    <DashboardGuide scans={scans} stats={stats} sevCounts={sev} findings={findings} model={model} go={go} />
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <section className="surface"><div className="flex items-center justify-between border-b border-line/60 px-5 py-4"><div><h3 className="text-sm font-bold">Priority findings</h3><p className="mt-1 text-xs text-ink-muted">Ordered by severity, with evidence and limitations.</p></div><button onClick={() => go("Analysis")} className="text-xs font-semibold text-indigo-600">View all</button></div><div className="divide-y divide-line/60">{findings.slice(0, 5).map((f) => <button key={f.id} onClick={() => go("Analysis")} className="flex w-full items-start gap-3 px-5 py-3.5 text-left hover:bg-muted"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEV_COLOR[f.severity]}`} /><div className="min-w-0"><div className="text-sm font-semibold">{f.title}</div><div className="mt-1 truncate font-mono text-[11px] text-ink-muted">{f.object} · {f.ruleId}</div></div><span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] text-ink-muted">{f.evidenceLevel}</span></button>)}{findings.length === 0 && <div className="p-8 text-center text-sm text-ink-muted">{scans.length ? "No findings in this schema." : "Findings appear after your first scan."}</div>}</div></section>
      <section className="surface"><div className="flex items-center justify-between border-b border-line/60 px-5 py-4"><h3 className="text-sm font-bold">Recent scans</h3><button onClick={() => go("History")} className="text-xs font-semibold text-indigo-600">History</button></div><div className="divide-y divide-line/60">{scans.slice(0, 6).map((s) => <button key={s.id} onClick={() => go("Explorer", s.id)} className="w-full px-5 py-3.5 text-left hover:bg-muted"><div className="flex items-center gap-2"><Database size={14} className={s.engine === "mongodb" ? "text-purple-500" : "text-sky-500"} /><span className="text-xs font-semibold capitalize">{s.engine} · {s.source}</span><span className="ml-auto"><StatusPill status={s.status} /></span></div><div className="mt-1.5 font-mono text-[10px] text-ink-muted">{s.id.slice(0, 8)} · {s.stats?.entities ?? 0} entities · {s.stats?.findings ?? 0} findings</div></button>)}{scans.length === 0 && <div className="p-6"><p className="text-xs text-ink-muted">Load a complete fixture to explore every workflow:</p><button onClick={() => seedDemo("saas")} className="mt-3 w-full rounded-xl border border-line py-2 text-xs font-semibold">Analyze SaaS YAML</button></div>}</div></section>
    </div>
  </div>;
}
function DashboardGuide({ scans, stats, sevCounts, findings, model, go }: { scans: ScanRow[]; stats: Record<string, number>; sevCounts: Record<string, number>; findings: ReturnType<typeof normFinding>[]; model: ModelT | null; go: (v: View, sid?: string) => void }) {
  const triaged = findings.filter((f) => f.status !== "open").length;
  const steps = [
    { done: scans.length > 0, label: "Add a schema", hint: "Upload a dump or connect read-only", view: "Connect" as View },
    { done: scans.length > 0 && !!model, label: "Explore the model", hint: "Entities, fields and relationships", view: "Explorer" as View },
    { done: findings.length === 0 ? scans.length > 0 : triaged > 0, label: "Triage findings", hint: `${triaged}/${findings.length} reviewed`, view: "Analysis" as View },
    { done: scans.length > 1, label: "Compare or transform", hint: "Diff versions or plan an engine move", view: "Transform" as View },
  ];
  const done = steps.filter((s) => s.done).length;
  const journeys = [
    { title: "Understand", desc: "Browse entities, open the diagram, read findings with evidence.", views: [["Explorer", "Explorer"], ["Diagram", "Diagram"], ["Analysis", "Analysis"]] as [View, string][], icon: TableProperties, tone: "from-sky-500/12" },
    { title: "Decide", desc: "Convert engines, ask which database fits, and generate migrations.", views: [["Transform", "Transform"], ["Advisor", "Advisor"], ["Diff & Migrate", "Diff"]] as [View, string][], icon: GitCompareArrows, tone: "from-violet-500/12" },
    { title: "Share", desc: "Export reports, ask the assistant, and review version history.", views: [["Reports", "Reports"], ["AI Assistant", "Assistant"], ["History", "History"]] as [View, string][], icon: FileText, tone: "from-emerald-500/12" },
  ];
  return <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
    <section className="surface p-5">
      <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-ink">Getting started</h3><span className="text-xs tabular-nums text-ink-muted">{done}/{steps.length}</span></div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><motion.div initial={{ width: 0 }} animate={{ width: `${(done / steps.length) * 100}%` }} transition={{ duration: .8 }} className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" /></div>
      <ol className="mt-4 space-y-1">{steps.map((s, i) => <li key={s.label}><button onClick={() => go(s.view)} className="group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-muted"><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${s.done ? "bg-emerald-500 text-white" : "bg-muted text-ink-muted ring-1 ring-line"}`}>{s.done ? <CheckCircle2 size={14} /> : i + 1}</span><span className="min-w-0 flex-1"><span className={`block text-[13px] font-semibold ${s.done ? "text-ink-muted line-through decoration-ink-muted/40" : "text-ink"}`}>{s.label}</span><span className="block text-[11px] text-ink-muted">{s.hint}</span></span><ChevronDown size={14} className="-rotate-90 text-ink-muted/40 group-hover:text-ink-muted" /></button></li>)}</ol>
      {(stats.findings ?? 0) > 0 && <div className="mt-4 border-t border-line pt-4"><div className="mb-2 flex items-center justify-between text-xs"><span className="font-semibold text-ink">Open findings by severity</span><span className="tabular-nums text-ink-muted">{stats.findings}</span></div><SeverityBar counts={sevCounts} /><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted">{SEVERITY_ORDER.filter((k) => sevCounts[k]).map((k) => <span key={k} className="flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${SEVERITY[k].dot}`} />{SEVERITY[k].label} {sevCounts[k]}</span>)}</div></div>}
    </section>
    <div className="grid gap-3 md:grid-cols-3">{journeys.map((j, i) => <motion.section key={j.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .1 + i * .07 }} className={`surface card-hover flex flex-col bg-gradient-to-br ${j.tone} to-transparent p-5`}><div className="grid h-10 w-10 place-items-center rounded-xl bg-elevated text-ink shadow-sm ring-1 ring-line"><j.icon size={18} /></div><h3 className="mt-4 text-sm font-bold text-ink">{j.title}</h3><p className="mt-1 flex-1 text-xs leading-5 text-ink-muted">{j.desc}</p><div className="mt-4 flex flex-wrap gap-1.5">{j.views.map(([v, l]) => <button key={v} onClick={() => go(v)} className="rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-[11px] font-semibold text-ink transition hover:border-indigo-400/60 hover:text-indigo-600 dark:hover:text-indigo-300">{l}</button>)}</div></motion.section>)}</div>
  </div>;
}
function ScoreRing({ value }: { value: number }) {
  const r = 26, c = 2 * Math.PI * r;
  const good = value >= 80;
  return <div className="relative grid h-16 w-16 place-items-center"><svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90"><circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="5" /><motion.circle cx="32" cy="32" r={r} fill="none" stroke={good ? "#34d399" : "#fbbf24"} strokeWidth="5" strokeLinecap="round" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c - (c * Math.max(0, Math.min(100, value))) / 100 }} transition={{ duration: 1.2, ease: [.2, .8, .2, 1], delay: .3 }} /></svg><span className={`text-xl font-bold ${good ? "text-emerald-300" : "text-amber-300"}`}>{value || "—"}</span></div>;
}
function StatusPill({ status }: { status: string }) {
  const c = status === "completed" ? "bg-emerald-100 text-emerald-700" : status === "partial" ? "bg-amber-100 text-amber-700" : status === "failed" ? "bg-red-100 text-red-700" : "bg-sky-100 text-sky-700";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c}`}>{status}</span>;
}

/* ── shared downloads ──────────────────────────────────── */
function download(name: string, content: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
}
/* ── Diff & Migrate ────────────────────────────────────── */
type MigrationItem = { id: string; engine: string; upScript: string; downScript: string; risks: string[]; validation: { ok?: boolean; checks: string[] }; scriptHash?: string; createdAt?: string; sourceScanId?: string; targetScanId?: string };
type DiffItem = { changes: { kind: string; entity: string; detail: string; destructive: boolean; risk: string; riskReason: string }[]; added: number; removed: number; modified: number; renames: { detail: string }[] };

function DiffMigrate({ projectId, scans, currentScanId, setMsg }: { projectId: string; scans: ScanRow[]; currentScanId: string; setMsg: (s: string) => void }) {
  const [src, setSrc] = useState(currentScanId);
  const [dst, setDst] = useState("");
  const [diff, setDiff] = useState<DiffItem | null>(null);
  const [mig, setMig] = useState<MigrationItem | null>(null);
  const [history, setHistory] = useState<MigrationItem[]>([]);
  const [busy, setBusy] = useState(false);
  const loadHistory = useCallback(async () => { if (!projectId) return; const r = await fetch(`/api/v1/migrations?projectId=${projectId}`).then((x) => x.json()).catch(() => ({ migrations: [] })); setHistory(r.migrations ?? []); }, [projectId]);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { if (currentScanId && !src) setSrc(currentScanId); }, [currentScanId, src]);
  async function runDiff() {
    if (!src || !dst || src === dst) { setMsg("Pick two different schema versions"); return; }
    setBusy(true);
    const r = await fetch("/api/v1/diffs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceScanId: src, targetScanId: dst }) }).then((x) => x.json());
    setBusy(false);
    if (r.diff) setDiff(r.diff); else setMsg(r.error ?? "Diff failed");
  }
  async function gen() {
    if (!src || !dst || src === dst) { setMsg("Pick two different schema versions first"); return; }
    setBusy(true);
    const r = await fetch("/api/v1/migrations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, sourceScanId: src, targetScanId: dst }) }).then((x) => x.json());
    setBusy(false);
    if (r.migration) { setMig(r.migration); setDiff(r.diff ?? diff); setHistory((h) => [r.migration, ...h]); setMsg(`Migration ${r.migration.id.slice(0, 8)} generated · hash ${r.migration.scriptHash}`); }
    else setMsg(r.error ?? "Migration failed");
  }
  async function saveEdited() {
    if (!mig) return;
    setBusy(true);
    const r = await fetch("/api/v1/migrations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ migrationId: mig.id, upScript: mig.upScript, downScript: mig.downScript }) }).then((x) => x.json());
    setBusy(false);
    if (r.migration) { setMig(r.migration); setHistory((h) => h.map((m) => m.id === r.migration.id ? r.migration : m)); setMsg(`Scripts saved and statically validated · ${r.migration.scriptHash}`); } else setMsg(r.error ?? "Could not save migration");
  }
  const sel = "mt-1.5 w-full rounded-xl border border-line bg-elevated px-3 py-2.5 text-sm outline-none focus:border-indigo-500";
  return <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
    <div className="space-y-4">
      <section className="surface p-5"><h3 className="text-sm font-bold">Compare schema versions</h3><p className="mt-1 text-xs text-ink-muted">Source is your current model; target is the proposed design.</p><label className="mt-4 block text-xs font-semibold text-ink-muted">Source<select value={src} onChange={(e) => setSrc(e.target.value)} className={sel}><option value="">Select source…</option>{scans.map((s) => <option key={s.id} value={s.id}>{s.engine} · {s.id.slice(0, 8)} · {s.status}</option>)}</select></label><label className="mt-3 block text-xs font-semibold text-ink-muted">Target<select value={dst} onChange={(e) => setDst(e.target.value)} className={sel}><option value="">Select target…</option>{scans.map((s) => <option key={s.id} value={s.id}>{s.engine} · {s.id.slice(0, 8)} · {s.status}</option>)}</select></label><div className="mt-4 grid grid-cols-2 gap-2"><button disabled={busy} onClick={runDiff} className="rounded-xl border border-line px-3 py-2.5 text-sm font-bold disabled:opacity-40">Compare</button><button disabled={busy} onClick={gen} className="rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-40">Generate</button></div>{diff && <div className="mt-4 flex gap-2 text-xs font-bold"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">+{diff.added} added</span><span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">−{diff.removed}</span><span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">~{diff.modified}</span></div>}</section>
      <section className="surface p-5"><h3 className="text-sm font-bold">Migration history</h3><div className="mt-3 space-y-2">{history.map((m) => <button key={m.id} onClick={() => setMig(m)} className={`w-full rounded-xl border p-3 text-left ${mig?.id === m.id ? "border-indigo-300 bg-indigo-50" : "border-line/60 bg-muted"}`}><div className="flex items-center gap-2"><code className="text-xs font-bold">{m.id.slice(0, 8)}</code><span className="text-[10px] uppercase text-ink-muted">{m.engine}</span><span className={`ml-auto h-2 w-2 rounded-full ${m.validation?.ok ? "bg-emerald-500" : "bg-amber-500"}`} /></div><div className="mt-1 font-mono text-[10px] text-ink-muted">{m.scriptHash} · {m.risks.length} risks</div></button>)}{history.length === 0 && <p className="text-xs text-ink-muted">Generated migrations will appear here.</p>}</div></section>
    </div>
    <section className="min-w-0 surface p-5">
      {!diff && !mig ? <EmptyState title="Nothing to compare yet" hint="Import two schema versions, select them on the left, then compare or generate a reviewed migration." /> : <>
        {diff && <div className="max-h-[360px] space-y-2 overflow-auto pr-1">{diff.renames.map((r, i) => <div key={i} className="rounded-xl border border-purple-200 bg-purple-50 p-3 text-xs text-purple-800"><b>Rename candidate:</b> {r.detail}</div>)}{diff.changes.map((c, i) => <div key={i} className={`rounded-xl border p-3 text-xs ${c.destructive ? "border-red-200 bg-red-50" : "border-line/60 bg-muted"}`}><span className={`mr-2 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${c.destructive ? "bg-red-600 text-white" : "bg-slate-700 text-white"}`}>{c.kind.replaceAll("_", " ")}</span><code>{c.detail}</code><div className="mt-1.5 text-[11px] text-ink-muted"><b className="capitalize">{c.risk} risk</b> · {c.riskReason}</div></div>)}{diff.changes.length === 0 && diff.renames.length === 0 && <p className="text-sm text-emerald-700">Schemas are identical.</p>}</div>}
        {mig && <div className="mt-5 border-t border-line/60 pt-5"><div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-bold">Migration <code className="text-xs text-ink-muted">{mig.id.slice(0, 8)}</code></h4><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${mig.validation?.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{mig.validation?.ok ? "Static checks passed" : "Review validation"}</span><button disabled={busy} onClick={saveEdited} className="ml-auto rounded-lg bg-ink px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">Save & revalidate</button></div>{mig.risks.length > 0 && <details className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"><summary className="cursor-pointer font-bold">{mig.risks.length} risk warnings</summary><ul className="mt-2 list-disc space-y-1 pl-4">{mig.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></details>}<div className="mt-3 grid gap-1.5">{(mig.validation?.checks ?? []).map((c) => <div key={c} className="flex items-center gap-2 text-[11px] text-ink-muted"><span className={`h-1.5 w-1.5 rounded-full ${c.startsWith("ERROR") ? "bg-red-500" : "bg-emerald-500"}`} />{c}</div>)}</div><ScriptBlock title="UP migration" code={mig.upScript} name={`${mig.engine}-migration-up.${mig.engine === "mongodb" ? "js" : "sql"}`} onChange={(code) => setMig({ ...mig, upScript: code })} /><ScriptBlock title="DOWN / rollback" code={mig.downScript} name={`${mig.engine}-migration-down.${mig.engine === "mongodb" ? "js" : "sql"}`} onChange={(code) => setMig({ ...mig, downScript: code })} /><p className="mt-3 rounded-xl bg-amber-50 p-3 text-[11px] leading-5 text-amber-800"><b>Human approval required.</b> Scripts are editable proposals. Static validation does not execute SQL; run against a disposable staging copy and verify data preservation before production.</p></div>}
      </>}
    </section>
  </div>;
}
function ScriptBlock({ title, code, name, onChange }: { title: string; code: string; name: string; onChange: (code: string) => void }) {
  return <div className="mt-4"><div className="flex items-center gap-2"><b className="text-xs">{title}</b><button onClick={() => download(name, code, "text/plain")} className="rounded-md bg-muted px-2 py-1 text-[10px] font-bold">Download</button><button onClick={() => navigator.clipboard?.writeText(code)} className="rounded-md bg-muted px-2 py-1 text-[10px] font-bold">Copy</button><span className="ml-auto text-[10px] text-ink-muted">Editable</span></div><textarea value={code} onChange={(e) => onChange(e.target.value)} spellCheck={false} className="scroll-thin mt-2 h-[300px] w-full resize-y rounded-xl bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-emerald-200 outline-none" /></div>;
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return <div className="surface p-10 text-center ring-1 ring-line"><h3 className="text-lg font-bold">{title}</h3><p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{hint}</p></div>;
}