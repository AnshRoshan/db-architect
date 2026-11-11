"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Boxes, Cable, CircleDashed, FolderTree, GitBranch, Link2, Loader2, Network, Plus, RefreshCw, ScanSearch, Sparkles, TableProperties, Trash2, Waypoints, Workflow, X } from "lucide-react";
import { Card, Chip, EmptyState, Segmented, SeverityChip, sev } from "@/components/ui";
import { EngineBadge } from "@/components/engine-icon";
import { FLOW_KINDS, STORE_ROLES, type ArchFinding, type ArchitectureReport, type CrossLink, type StoreSummary } from "@/lib/architecture";
import { ENGINE_LIST, engineLabel, namespaceLabel } from "@/lib/engines";

type ScanLite = { id: string; engine: string; source: string; status: string; dataStoreId: string | null; createdAt: string; label: string | null; version: number | null; entities: number };
type Flow = { id: string; fromStoreId: string; toStoreId: string; kind: string; description: string | null };
type Data = ArchitectureReport & { flows: Flow[]; scans: ScanLite[]; role?: string; seededScanId?: string | null; error?: string };
type Tab = "findings" | "links" | "flows" | "versions";
type Box = { x: number; y: number; w: number; h: number; row: number };

const NODE_H = 112;
const roleLabel = (role: string) => STORE_ROLES.find((r) => r.id === role)?.label ?? role;
const flowLabel = (kind: string) => FLOW_KINDS.find((k) => k.id === kind)?.label ?? kind;
const input = "w-full rounded-xl border border-line bg-elevated px-3 py-2 text-sm text-ink outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10";

function layoutStores(stores: StoreSummary[], width: number) {
  const tierOf = (role: string) => STORE_ROLES.find((r) => r.id === role)?.tier ?? 1;
  const rows = [0, 1, 2].map((t) => stores.filter((s) => tierOf(s.role) === t)).filter((r) => r.length);
  const maxPer = Math.max(1, ...rows.map((r) => r.length));
  const gap = maxPer <= 2 ? 120 : 76; // room for the edge label between two stores in a row
  const margin = 20;
  const canvasW = Math.max(width, maxPer * 190 + (maxPer - 1) * gap + margin * 2);
  const nodeW = Math.max(190, Math.min(250, (canvasW - gap * (maxPer - 1) - margin * 2) / maxPer));
  const rowGap = 92;
  const pos = new Map<string, Box>();
  rows.forEach((row, ri) => {
    const total = row.length * nodeW + (row.length - 1) * gap;
    const x0 = (canvasW - total) / 2;
    row.forEach((s, i) => pos.set(s.id, { x: x0 + i * (nodeW + gap), y: 28 + ri * (NODE_H + rowGap), w: nodeW, h: NODE_H, row: ri }));
  });
  return { pos, canvasW, height: 56 + rows.length * NODE_H + Math.max(0, rows.length - 1) * rowGap };
}

function edgePath(a: Box, b: Box, bend: number) {
  if (a.row === b.row) {
    const forward = a.x < b.x;
    const x1 = forward ? a.x + a.w : a.x, x2 = forward ? b.x : b.x + b.w;
    const y = a.y + a.h / 2 + bend;
    const lift = 26 + Math.abs(bend);
    return { d: `M ${x1} ${y} C ${x1 + (forward ? 30 : -30)} ${y - lift}, ${x2 - (forward ? 30 : -30)} ${y - lift}, ${x2} ${y}`, mx: (x1 + x2) / 2, my: y - lift * 0.75 };
  }
  const down = a.y < b.y;
  const x1 = a.x + a.w / 2 + bend, y1 = down ? a.y + a.h : a.y;
  const x2 = b.x + b.w / 2 + bend, y2 = down ? b.y : b.y + b.h;
  const my = (y1 + y2) / 2;
  return { d: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`, mx: (x1 + x2) / 2, my };
}

export default function ArchitectureView({ projectId, canWrite, canAdmin, onOpenScan, onConnect, onChanged, notify }: {
  projectId: string; canWrite: boolean; canAdmin: boolean;
  onOpenScan: (scanId: string, view: "Explorer" | "Diagram" | "Analysis") => void;
  onConnect: () => void; onChanged: () => void; notify: (text: string, kind?: "success" | "error") => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("findings");
  const [adding, setAdding] = useState(false);
  const [storeForm, setStoreForm] = useState({ name: "", engine: "postgres", role: "service" });
  const [flowForm, setFlowForm] = useState({ fromStoreId: "", toStoreId: "", kind: "cdc" });
  const canvasRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(880);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    const r = (await fetch(`/api/v1/architecture?projectId=${projectId}`).then((x) => x.json()).catch(() => ({ error: "Could not reach the server" }))) as Data;
    setLoading(false);
    if (r.error) notify(r.error, "error"); else setData(r);
  }, [projectId, notify]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(320, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data?.stores.length]);

  const act = useCallback(async (action: string, payload: Record<string, unknown>, done?: string) => {
    setBusy(action);
    const r = (await fetch("/api/v1/architecture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, action, ...payload }) }).then((x) => x.json()).catch(() => ({ error: "Could not reach the server" }))) as Data;
    setBusy(null);
    if (r.error) { notify(r.error, "error"); return null; }
    setData(r);
    onChanged();
    if (done) notify(done);
    return r;
  }, [projectId, notify, onChanged]);

  const stores = useMemo(() => data?.stores ?? [], [data]);
  // Start at the system of record: it is the store everything else is judged against.
  useEffect(() => { if (stores.length && !stores.some((s) => s.id === selected)) setSelected((stores.find((s) => s.role === "primary") ?? stores[0]).id); }, [stores, selected]);
  const current = stores.find((s) => s.id === selected) ?? null;
  const nameOf = useCallback((id: string) => stores.find((s) => s.id === id)?.name ?? "?", [stores]);
  const { pos, canvasW, height } = useMemo(() => layoutStores(stores, width), [stores, width]);

  const linkGroups = useMemo(() => {
    const g = new Map<string, { a: string; b: string; count: number; mismatch: boolean }>();
    for (const l of data?.links ?? []) {
      const [a, b] = [l.fromStoreId, l.toStoreId].sort();
      const cur = g.get(`${a}|${b}`) ?? { a: l.fromStoreId, b: l.toStoreId, count: 0, mismatch: false };
      cur.count++;
      cur.mismatch = cur.mismatch || l.typeMismatch;
      g.set(`${a}|${b}`, cur);
    }
    return [...g.values()];
  }, [data]);

  if (loading && !data) return <Card className="flex items-center justify-center gap-2 py-24 text-sm text-ink-muted"><Loader2 size={16} className="animate-spin" />Mapping the system…</Card>;
  if (!data) return <EmptyState icon={Workflow} title="Architecture unavailable" hint="The architecture could not be loaded. Try again in a moment." action={<button onClick={load} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Retry</button>} />;

  if (!stores.length) {
    return (
      <EmptyState icon={Workflow} title="Map every database your system runs on"
        hint="Real systems are rarely one database with one schema. Add each datastore — a PostgreSQL with ten schemas, a second service database, a Redis — and DB Architect maps the schemas inside each one, infers references that cross between them, and checks the architecture as a whole."
        action={<div className="flex flex-wrap justify-center gap-2">
          {canWrite && <button disabled={busy !== null} onClick={async () => { const r = await act("seed_demo", {}, "Sample system loaded: PostgreSQL (8 schemas) + MongoDB + Redis"); if (r?.seededScanId) setSelected(null); }} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">{busy === "seed_demo" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}Load a sample polyglot system</button>}
          {canWrite && <button onClick={onConnect} className="flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-muted"><Cable size={15} />Connect a database</button>}
        </div>} />
    );
  }

  const good = data.score >= 80;
  const selectedTouches = (a: string, b: string) => !selected || a === selected || b === selected;
  const unattached = data.scans.filter((s) => !s.dataStoreId);
  const totals: [string, number, typeof Boxes][] = [["Datastores", data.totals.stores, Boxes], ["Engines", data.totals.engines, Network], ["Schemas", data.totals.namespaces, FolderTree], ["Entities", data.totals.entities, TableProperties], ["Cross-store links", data.totals.links, Link2], ["Declared flows", data.totals.flows, GitBranch]];

  return (
    <div className="space-y-4">
      {/* summary */}
      <Card className="flex flex-wrap items-center gap-x-8 gap-y-4 !py-4">
        <div className="flex items-center gap-3">
          <div className="relative grid h-14 w-14 place-items-center">
            <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90"><circle cx="28" cy="28" r="23" fill="none" className="stroke-muted" strokeWidth="5" /><motion.circle cx="28" cy="28" r="23" fill="none" stroke={good ? "#10b981" : data.score >= 55 ? "#f59e0b" : "#ef4444"} strokeWidth="5" strokeLinecap="round" strokeDasharray={144.5} initial={{ strokeDashoffset: 144.5 }} animate={{ strokeDashoffset: 144.5 - (144.5 * data.score) / 100 }} transition={{ duration: 1, ease: [.2, .8, .2, 1] }} /></svg>
            <span className="text-base font-bold tabular-nums text-ink">{data.score}</span>
          </div>
          <div><div className="text-sm font-bold text-ink">Architecture score</div><div className="text-[11px] text-ink-muted">{data.findings.filter((f) => f.severity !== "info").length} issue{data.findings.filter((f) => f.severity !== "info").length === 1 ? "" : "s"} across stores · heuristic</div></div>
        </div>
        <div className="flex flex-1 flex-wrap gap-x-7 gap-y-3">{totals.map(([label, value, Icon]) => <div key={label} className="flex items-center gap-2.5"><Icon size={15} className="text-ink-muted/70" /><div><div className="text-lg font-bold leading-none tabular-nums text-ink">{value}</div><div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{label}</div></div></div>)}</div>
        <div className="flex gap-2">
          <button onClick={load} title="Refresh" aria-label="Refresh architecture" className="rounded-xl border border-line p-2 text-ink-muted hover:bg-muted hover:text-ink"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button>
          {canWrite && <button onClick={() => setAdding((v) => !v)} className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-muted"><Plus size={14} />Add datastore</button>}
          {canWrite && <button onClick={onConnect} className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-500"><Cable size={14} />Connect or import</button>}
        </div>
      </Card>

      <AnimatePresence>{adding && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
        <Card className="!py-4"><form className="flex flex-wrap items-end gap-3" onSubmit={async (e) => { e.preventDefault(); const r = await act("create_store", storeForm, `Datastore “${storeForm.name}” added`); if (r) { setAdding(false); setStoreForm({ name: "", engine: "postgres", role: "service" }); } }}>
          <label className="min-w-[180px] flex-1 text-xs font-semibold text-ink-muted">Name<input required minLength={2} value={storeForm.name} onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })} placeholder="orders-db, session-cache…" className={`mt-1.5 ${input}`} /></label>
          <label className="text-xs font-semibold text-ink-muted">Engine<select value={storeForm.engine} onChange={(e) => setStoreForm({ ...storeForm, engine: e.target.value })} className={`mt-1.5 ${input}`}>{ENGINE_LIST.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select></label>
          <label className="text-xs font-semibold text-ink-muted">Role<select value={storeForm.role} onChange={(e) => setStoreForm({ ...storeForm, role: e.target.value })} className={`mt-1.5 ${input}`}>{STORE_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
          <button disabled={busy !== null} className="rounded-xl bg-ink px-4 py-2 text-sm font-bold text-canvas disabled:opacity-50">Add</button>
          <p className="w-full text-[11px] text-ink-muted">Adds a placeholder to the map. Attach a schema to it from Connect (choose this datastore when importing or scanning).</p>
        </form></Card>
      </motion.div>}</AnimatePresence>

      <div className="grid items-start gap-4 xl:grid-cols-[1fr_380px]">
        {/* topology */}
        <Card padded={false} className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
            <Waypoints size={16} className="text-indigo-500" /><h3 className="text-sm font-bold text-ink">System topology</h3>
            <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ink-muted"><span className="flex items-center gap-1.5"><span className="h-0.5 w-5 rounded bg-indigo-500" />declared flow</span><span className="flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-violet-400" />inferred links</span><span className="flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-orange-400" />type mismatch</span></div>
          </div>
          <div ref={canvasRef} className="dot-grid scroll-thin overflow-x-auto">
            <div className="relative" style={{ width: canvasW, height }}>
              <svg width={canvasW} height={height} className="absolute inset-0" role="img" aria-label="Datastore topology">
                <defs><marker id="arch-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9" fill="none" stroke="#6366f1" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></marker></defs>
                {linkGroups.map((g) => {
                  const a = pos.get(g.a), b = pos.get(g.b);
                  if (!a || !b) return null;
                  const hasFlow = data.flows.some((f) => (f.fromStoreId === g.a && f.toStoreId === g.b) || (f.fromStoreId === g.b && f.toStoreId === g.a));
                  const p = edgePath(a, b, hasFlow ? 48 : 0);
                  const on = selectedTouches(g.a, g.b);
                  return <g key={`${g.a}|${g.b}`} opacity={on ? 1 : 0.25}>
                    <path d={p.d} fill="none" stroke={g.mismatch ? "#fb923c" : "#a78bfa"} strokeWidth={Math.min(1.4 + g.count * 0.25, 3.5)} strokeDasharray="6 5" strokeLinecap="round" />
                    <g transform={`translate(${p.mx} ${p.my})`}><rect x="-34" y="-10" width="68" height="20" rx="10" className="fill-[var(--bg-elevated)]" stroke={g.mismatch ? "#fb923c" : "#a78bfa"} strokeWidth="1" /><text textAnchor="middle" y="3.5" fontSize="10" fontWeight="700" className="fill-[var(--fg)]">{g.count} link{g.count === 1 ? "" : "s"}</text></g>
                  </g>;
                })}
                {data.flows.map((f) => {
                  const a = pos.get(f.fromStoreId), b = pos.get(f.toStoreId);
                  if (!a || !b) return null;
                  const hasLinks = linkGroups.some((g) => (g.a === f.fromStoreId && g.b === f.toStoreId) || (g.a === f.toStoreId && g.b === f.fromStoreId));
                  const p = edgePath(a, b, hasLinks ? -48 : 0);
                  const on = selectedTouches(f.fromStoreId, f.toStoreId);
                  const label = flowLabel(f.kind);
                  const w = label.length * 6 + 18;
                  return <g key={f.id} opacity={on ? 1 : 0.25}>
                    <path d={p.d} fill="none" stroke="#6366f1" strokeWidth="2" markerEnd="url(#arch-arrow)" className="edge-flow" strokeLinecap="round" />
                    <circle r="3.5" fill="#818cf8"><animateMotion dur="2.6s" repeatCount="indefinite" path={p.d} /></circle>
                    <g transform={`translate(${p.mx} ${p.my})`}><rect x={-w / 2} y="-10" width={w} height="20" rx="10" fill="#6366f1" /><text textAnchor="middle" y="3.5" fontSize="10" fontWeight="700" fill="#fff">{label}</text></g>
                  </g>;
                })}
              </svg>
              {stores.map((s, i) => {
                const b = pos.get(s.id);
                if (!b) return null;
                const active = s.id === selected;
                const schemas = s.namespaces.filter((n) => !n.external).length;
                return (
                  <motion.button key={s.id} onClick={() => setSelected(s.id)} aria-pressed={active} initial={{ opacity: 0, scale: .92, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ delay: i * .06, type: "spring", stiffness: 260, damping: 24 }}
                    style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
                    className={`absolute overflow-hidden rounded-2xl border bg-elevated p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg ${active ? "border-indigo-400 ring-4 ring-indigo-500/15" : "border-line hover:border-indigo-400/50"}`}>
                    <div className="flex items-center gap-2.5">
                      <EngineBadge engine={s.engine} size={34} />
                      <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-bold text-ink">{s.name}</div><div className="truncate text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{roleLabel(s.role)}</div></div>
                      {s.designScore !== null && <span className={`rounded-lg px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${s.designScore >= 80 ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" : "bg-amber-500/12 text-amber-600 dark:text-amber-300"}`}>{s.designScore}</span>}
                    </div>
                    <div className="mt-2.5 text-[11px] text-ink-muted">{s.hasModel ? <>{engineLabel(s.engine)} · <b className="text-ink">{schemas}</b> {namespaceLabel(s.engine, schemas !== 1)} · <b className="text-ink">{s.entities}</b> {s.engine === "redis" ? "key patterns" : s.engine === "mongodb" ? "collections" : "tables"}</> : <span className="flex items-center gap-1.5"><CircleDashed size={12} />No schema captured yet</span>}</div>
                    {schemas > 1 && <div className="mt-1.5 flex gap-1 overflow-hidden">{s.namespaces.filter((n) => !n.external).slice(0, 3).map((n) => <span key={n.name} className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[9px] text-ink-muted">{n.name}</span>)}{schemas > 3 && <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[9px] text-ink-muted">+{schemas - 3}</span>}</div>}
                  </motion.button>
                );
              })}
            </div>
          </div>
          <div className="border-t border-line px-5 py-2.5 text-[11px] leading-5 text-ink-muted">{data.limitations[0]}</div>
        </Card>

        {/* inspector */}
        {current && <StoreInspector key={current.id} store={current} scans={data.scans.filter((s) => s.dataStoreId === current.id)} canWrite={canWrite} canAdmin={canAdmin} busy={busy !== null}
          onRole={(role) => act("update_store", { storeId: current.id, role }, `${current.name} is now “${roleLabel(role)}”`)}
          onDelete={() => { if (window.confirm(`Remove “${current.name}” from the architecture? Its schema versions stay in History.`)) act("delete_store", { storeId: current.id }, "Datastore removed"); }}
          onOpen={(view) => current.scanId && onOpenScan(current.scanId, view)} onOpenScan={(id) => onOpenScan(id, "Explorer")} />}
      </div>

      {/* details */}
      <Card padded={false}>
        <div className="overflow-x-auto border-b border-line px-4 py-3">
          <Segmented<Tab> layoutId="arch-tab" value={tab} onChange={setTab} options={[
            { value: "findings", label: <><ScanSearch size={13} />Architecture findings</>, count: data.findings.length },
            { value: "links", label: <><Link2 size={13} />Cross-store links</>, count: data.links.length },
            { value: "flows", label: <><GitBranch size={13} />Data flows</>, count: data.flows.length },
            { value: "versions", label: <><CircleDashed size={13} />Unattached versions</>, count: unattached.length },
          ]} />
        </div>
        <div className="p-4">
          {tab === "findings" && <FindingsList findings={data.findings} onSelectStore={setSelected} />}
          {tab === "links" && <LinksTable links={data.links} nameOf={nameOf} />}
          {tab === "flows" && (
            <div className="space-y-3">
              {data.flows.map((f) => <div key={f.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-muted/40 p-3.5 text-sm"><span className="font-semibold text-ink">{nameOf(f.fromStoreId)}</span><ArrowRight size={14} className="text-indigo-500" /><span className="font-semibold text-ink">{nameOf(f.toStoreId)}</span><Chip className="bg-indigo-500/12 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300">{flowLabel(f.kind)}</Chip>{f.description && <span className="text-xs text-ink-muted">{f.description}</span>}{canWrite && <button onClick={() => act("delete_flow", { flowId: f.id }, "Flow removed")} aria-label="Remove flow" className="ml-auto rounded-lg p-1.5 text-ink-muted hover:bg-red-500/10 hover:text-red-500"><Trash2 size={14} /></button>}</div>)}
              {!data.flows.length && <p className="py-4 text-center text-sm text-ink-muted">No flows declared yet. Tell DB Architect how data moves between stores so copies and caches are judged correctly.</p>}
              {canWrite && stores.length >= 2 && <form className="flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-line p-3.5" onSubmit={async (e) => { e.preventDefault(); const r = await act("create_flow", flowForm, "Data flow declared"); if (r) setFlowForm({ fromStoreId: "", toStoreId: "", kind: "cdc" }); }}>
                <label className="min-w-[150px] flex-1 text-xs font-semibold text-ink-muted">From<select required value={flowForm.fromStoreId} onChange={(e) => setFlowForm({ ...flowForm, fromStoreId: e.target.value })} className={`mt-1.5 ${input}`}><option value="">Source store…</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                <label className="min-w-[150px] flex-1 text-xs font-semibold text-ink-muted">How<select value={flowForm.kind} onChange={(e) => setFlowForm({ ...flowForm, kind: e.target.value })} className={`mt-1.5 ${input}`}>{FLOW_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label} — {k.hint}</option>)}</select></label>
                <label className="min-w-[150px] flex-1 text-xs font-semibold text-ink-muted">To<select required value={flowForm.toStoreId} onChange={(e) => setFlowForm({ ...flowForm, toStoreId: e.target.value })} className={`mt-1.5 ${input}`}><option value="">Target store…</option>{stores.filter((s) => s.id !== flowForm.fromStoreId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                <button disabled={busy !== null} className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50"><Plus size={14} />Declare flow</button>
              </form>}
            </div>
          )}
          {tab === "versions" && (
            <div className="space-y-2">
              {unattached.map((s) => <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-muted/40 p-3.5"><EngineBadge engine={s.engine} size={30} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-ink">{s.label ?? `${engineLabel(s.engine)} schema`}</div><div className="text-[11px] text-ink-muted">{s.source === "transform" ? "Proposed target design" : s.source} · {s.entities} entities{s.version ? ` · v${s.version}` : ""}</div></div><button onClick={() => onOpenScan(s.id, "Explorer")} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-muted">Open</button>{canWrite && <select aria-label="Attach to datastore" value="" onChange={(e) => e.target.value && act("assign_scan", { scanId: s.id, storeId: e.target.value }, "Version attached")} className="rounded-lg border border-line bg-elevated px-2 py-1.5 text-xs text-ink"><option value="">Attach to…</option>{stores.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}</select>}</div>)}
              {!unattached.length && <p className="py-4 text-center text-sm text-ink-muted">Every schema version belongs to a datastore. Designs saved from the Transformation Studio appear here until you attach them.</p>}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function FindingsList({ findings, onSelectStore }: { findings: ArchFinding[]; onSelectStore: (id: string) => void }) {
  const [open, setOpen] = useState<number | null>(0);
  if (!findings.length) return <p className="py-6 text-center text-sm text-ink-muted">No architecture findings. Add more datastores or declare data flows to deepen the analysis.</p>;
  return (
    <div className="space-y-2">
      {findings.map((f, i) => (
        <div key={`${f.ruleId}-${i}`} className={`overflow-hidden rounded-xl border border-l-4 border-line bg-muted/30 ${sev(f.severity).edge}`}>
          <button onClick={() => { setOpen(open === i ? null : i); if (f.storeIds[0]) onSelectStore(f.storeIds[0]); }} aria-expanded={open === i} className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left">
            <SeverityChip severity={f.severity} /><span className="text-[13px] font-semibold text-ink">{f.title}</span>
            <span className="truncate font-mono text-[11px] text-ink-muted">{f.object}</span><code className="ml-auto text-[10px] text-ink-muted">{f.ruleId}</code>
          </button>
          <AnimatePresence initial={false}>{open === i && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden"><div className="space-y-2.5 border-t border-line px-4 py-3 text-[13px] leading-6">
            <p className="text-ink-muted">{f.explanation}</p>
            <p className="rounded-lg bg-emerald-500/8 px-3 py-2 text-ink"><b className="text-emerald-600 dark:text-emerald-400">Recommendation · </b>{f.recommendation}</p>
            {Object.keys(f.evidence).length > 0 && <pre className="scroll-thin overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-300">{JSON.stringify(f.evidence, null, 2)}</pre>}
          </div></motion.div>}</AnimatePresence>
        </div>
      ))}
    </div>
  );
}

const LINK_KIND: Record<CrossLink["kind"], { label: string; cls: string }> = {
  reference: { label: "reference", cls: "bg-violet-500/12 text-violet-700 ring-violet-500/25 dark:text-violet-300" },
  duplicate: { label: "same entity", cls: "bg-orange-500/12 text-orange-700 ring-orange-500/25 dark:text-orange-300" },
  cache: { label: "cached copy", cls: "bg-sky-500/12 text-sky-700 ring-sky-500/25 dark:text-sky-300" },
};

function LinksTable({ links, nameOf }: { links: CrossLink[]; nameOf: (id: string) => string }) {
  if (!links.length) return <p className="py-6 text-center text-sm text-ink-muted">No links between stores were inferred. They appear when a field in one store is named after an entity that only exists in another.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-[13px]">
        <thead><tr className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted"><th className="pb-2 pr-3">Kind</th><th className="pb-2 pr-3">From</th><th className="pb-2 pr-3">To</th><th className="pb-2 pr-3">Confidence</th><th className="pb-2">Why</th></tr></thead>
        <tbody>{links.map((l) => (
          <tr key={l.id} className="border-t border-line/60 align-top">
            <td className="py-2.5 pr-3"><Chip className={LINK_KIND[l.kind].cls}>{LINK_KIND[l.kind].label}</Chip>{l.typeMismatch && <Chip className="ml-1 bg-red-500/12 text-red-700 ring-red-500/25 dark:text-red-300"><AlertTriangle size={10} />types</Chip>}</td>
            <td className="py-2.5 pr-3"><div className="text-[11px] font-semibold text-ink-muted">{nameOf(l.fromStoreId)}</div><code className="break-all font-mono text-[12px] text-ink">{l.fromEntity}{l.fromField ? `.${l.fromField}` : ""}</code>{l.typeFrom && <span className="ml-1.5 font-mono text-[10px] text-ink-muted">{l.typeFrom}</span>}</td>
            <td className="py-2.5 pr-3"><div className="text-[11px] font-semibold text-ink-muted">{nameOf(l.toStoreId)}</div><code className="break-all font-mono text-[12px] text-ink">{l.toEntity}{l.toField ? `.${l.toField}` : ""}</code>{l.typeTo && <span className="ml-1.5 font-mono text-[10px] text-ink-muted">{l.typeTo}</span>}</td>
            <td className="py-2.5 pr-3"><div className="flex items-center gap-2"><div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.round(l.confidence * 100)}%` }} /></div><span className="text-[11px] tabular-nums text-ink-muted">{Math.round(l.confidence * 100)}%</span></div></td>
            <td className="py-2.5 text-xs leading-5 text-ink-muted">{l.reason}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function StoreInspector({ store, scans, canWrite, canAdmin, busy, onRole, onDelete, onOpen, onOpenScan }: {
  store: StoreSummary; scans: ScanLite[]; canWrite: boolean; canAdmin: boolean; busy: boolean;
  onRole: (role: string) => void; onDelete: () => void; onOpen: (view: "Explorer" | "Diagram" | "Analysis") => void; onOpenScan: (id: string) => void;
}) {
  const own = store.namespaces.filter((n) => !n.external);
  const max = Math.max(1, ...own.map((n) => n.entities));
  const word = namespaceLabel(store.engine);
  return (
    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .25 }}>
      <Card padded={false} className="overflow-hidden">
        <div className="border-b border-line bg-gradient-to-br from-indigo-500/[.07] to-transparent p-5">
          <div className="flex items-start gap-3">
            <EngineBadge engine={store.engine} size={44} />
            <div className="min-w-0 flex-1"><h3 className="truncate text-base font-bold text-ink">{store.name}</h3><div className="mt-0.5 text-xs text-ink-muted">{engineLabel(store.engine)}{store.version ? ` ${store.version.split(" ")[0]}` : ""}{store.database ? ` · ${store.database}` : ""}</div></div>
            {canAdmin && <button onClick={onDelete} title="Remove datastore" aria-label="Remove datastore" className="rounded-lg p-1.5 text-ink-muted hover:bg-red-500/10 hover:text-red-500"><X size={15} /></button>}
          </div>
          <label className="mt-4 block text-[10px] font-bold uppercase tracking-wider text-ink-muted">Role in the system
            <select disabled={!canWrite || busy} value={store.role} onChange={(e) => onRole(e.target.value)} className={`mt-1.5 ${input} !py-1.5 text-[13px] font-semibold normal-case tracking-normal`}>{STORE_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label} — {r.hint}</option>)}</select>
          </label>
          <div className="mt-4 grid grid-cols-4 gap-2 text-center">{[[own.length, store.engine === "redis" ? "dbs" : `${word}s`], [store.entities, "entities"], [store.linkCount, "x-store"], [store.versions, "versions"]].map(([v, l]) => <div key={String(l)} className="rounded-xl bg-elevated px-1 py-2 ring-1 ring-line"><div className="text-base font-bold tabular-nums text-ink">{v}</div><div className="truncate text-[9px] font-semibold uppercase tracking-wider text-ink-muted">{l}</div></div>)}</div>
          {store.scanId && <div className="mt-3 grid grid-cols-3 gap-2">{(["Explorer", "Diagram", "Analysis"] as const).map((v) => <button key={v} onClick={() => onOpen(v)} className="rounded-lg border border-line bg-elevated py-1.5 text-[11px] font-semibold text-ink transition hover:border-indigo-400/60 hover:text-indigo-600 dark:hover:text-indigo-300">{v}{v === "Analysis" && store.findingCount ? ` · ${store.findingCount}` : ""}</button>)}</div>}
        </div>

        {store.hasModel ? <div className="space-y-4 p-5">
          {own.length > 1 && <SchemaMap store={store} />}
          <div>
            <div className="mb-2 flex items-center justify-between text-xs"><span className="flex items-center gap-1.5 font-bold text-ink"><FolderTree size={13} />{own.length} {word}{own.length === 1 ? "" : "s"}</span><span className="text-[10px] text-ink-muted">in · out = cross-{word} FKs</span></div>
            <div className="scroll-thin max-h-56 space-y-1.5 overflow-y-auto pr-1">{own.map((n) => <div key={n.name} className="flex items-center gap-2.5 text-xs"><code className="w-24 shrink-0 truncate font-mono font-semibold text-ink" title={n.name}>{n.name}</code><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><motion.div initial={{ width: 0 }} animate={{ width: `${(n.entities / max) * 100}%` }} transition={{ duration: .6 }} className="h-full rounded-full bg-indigo-500" /></div><span className="w-6 text-right tabular-nums text-ink">{n.entities}</span><span className="w-14 text-right font-mono text-[10px] tabular-nums text-ink-muted">{n.inbound} · {n.outbound}</span></div>)}</div>
          </div>
          {store.cycles.length > 0 && <div className="rounded-xl border border-red-500/30 bg-red-500/[.07] p-3 text-xs leading-5 text-ink"><div className="flex items-center gap-1.5 font-bold text-red-600 dark:text-red-400"><AlertTriangle size={13} />Circular {word} dependency</div>{store.cycles.map(([a, b]) => <div key={a + b} className="mt-1 font-mono">{a} ⇄ {b}</div>)}</div>}
          {store.edges.length > 0 && <div><div className="mb-2 text-xs font-bold text-ink">Cross-{word} dependencies</div><div className="scroll-thin max-h-48 space-y-1.5 overflow-y-auto pr-1">{store.edges.map((e) => <div key={`${e.from}>${e.to}`} className="rounded-lg bg-muted/60 px-2.5 py-2 text-[11px]" title={e.examples.join("\n")}><div className="flex items-center gap-1.5 font-mono font-semibold text-ink">{e.from}<ArrowRight size={11} className="text-indigo-500" />{e.to}<span className="ml-auto rounded bg-elevated px-1.5 text-[10px] tabular-nums text-ink-muted ring-1 ring-line">{e.count} FK{e.count === 1 ? "" : "s"}</span></div><div className="mt-0.5 truncate font-mono text-[10px] text-ink-muted">{e.examples[0]}</div></div>)}</div></div>}
          {scans.length > 1 && <div><div className="mb-2 text-xs font-bold text-ink">Versions</div><div className="space-y-1">{scans.slice(0, 5).map((s) => <button key={s.id} onClick={() => onOpenScan(s.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] hover:bg-muted"><span className="font-mono font-semibold text-ink">v{s.version ?? "?"}</span><span className="min-w-0 flex-1 truncate text-ink-muted">{s.label ?? s.source}</span><span className="text-ink-muted">{s.entities}</span></button>)}</div></div>}
        </div> : <div className="p-6 text-center text-sm text-ink-muted"><CircleDashed size={22} className="mx-auto mb-2 text-ink-muted/60" />No schema captured for this store yet. Import or scan from Connect and choose <b className="text-ink">{store.name}</b> as the datastore.</div>}
      </Card>
    </motion.div>
  );
}

/** Radial map of the namespaces inside one store; line weight = number of cross-schema foreign keys. */
function SchemaMap({ store }: { store: StoreSummary }) {
  const nodes = store.namespaces.slice(0, 14);
  const max = Math.max(1, ...nodes.map((n) => n.entities));
  const cx = 150, cy = 118, R = nodes.length <= 2 ? 56 : 78;
  const at = new Map(nodes.map((n, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / nodes.length; return [n.name, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), a, r: 7 + 9 * Math.sqrt(n.entities / max) }]; }));
  const cyc = new Set(store.cycles.flatMap(([a, b]) => [`${a}>${b}`, `${b}>${a}`]));
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="rounded-xl border border-line bg-muted/30">
      <svg viewBox="0 0 300 236" className="w-full" role="img" aria-label={`Schema dependency map for ${store.name}`}>
        <defs><marker id="ns-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1 L9 5 L1 9" fill="none" stroke="context-stroke" strokeWidth="1.8" /></marker></defs>
        {store.edges.map((e) => {
          const a = at.get(e.from), b = at.get(e.to);
          if (!a || !b) return null;
          const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
          const x1 = a.x + (dx / len) * a.r, y1 = a.y + (dy / len) * a.r, x2 = b.x - (dx / len) * (b.r + 3), y2 = b.y - (dy / len) * (b.r + 3);
          const qx = (x1 + x2) / 2 + (cx - (x1 + x2) / 2) * 0.35 - (dy / len) * 7, qy = (y1 + y2) / 2 + (cy - (y1 + y2) / 2) * 0.35 + (dx / len) * 7;
          const red = cyc.has(`${e.from}>${e.to}`);
          const lit = !hover || hover === e.from || hover === e.to;
          return <path key={`${e.from}>${e.to}`} d={`M ${x1} ${y1} Q ${qx} ${qy} ${x2} ${y2}`} fill="none" stroke={red ? "#ef4444" : "#818cf8"} strokeWidth={Math.min(1 + e.count * 0.55, 4)} strokeOpacity={lit ? 0.85 : 0.12} markerEnd="url(#ns-arrow)" strokeLinecap="round"><title>{`${e.from} → ${e.to}: ${e.count} FK\n${e.examples.join("\n")}`}</title></path>;
        })}
        {nodes.map((n, i) => {
          const p = at.get(n.name)!;
          const right = Math.cos(p.a) > 0.25, left = Math.cos(p.a) < -0.25;
          const lit = !hover || hover === n.name || store.edges.some((e) => (e.from === hover && e.to === n.name) || (e.to === hover && e.from === n.name));
          return <g key={n.name} onMouseEnter={() => setHover(n.name)} onMouseLeave={() => setHover(null)} opacity={lit ? 1 : 0.3} className="cursor-default">
            <motion.circle cx={p.x} cy={p.y} r={p.r} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * .04, type: "spring", stiffness: 300, damping: 20 }} style={{ transformOrigin: `${p.x}px ${p.y}px` }} fill={n.external ? "transparent" : `hsl(${(i * 47 + 232) % 360} 78% 62%)`} fillOpacity=".9" stroke={n.external ? "#94a3b8" : "var(--bg-elevated)"} strokeWidth="2" strokeDasharray={n.external ? "3 2" : undefined} />
            <text x={p.x + (right ? p.r + 5 : left ? -p.r - 5 : 0)} y={p.y + (right || left ? 3.5 : Math.sin(p.a) > 0 ? p.r + 12 : -p.r - 6)} textAnchor={right ? "start" : left ? "end" : "middle"} fontSize="10" fontWeight="700" fontFamily="ui-monospace,monospace" className="fill-[var(--fg)]">{n.name}</text>
            <title>{`${n.name}: ${n.entities} entities · ${n.inbound} inbound · ${n.outbound} outbound${n.external ? " · outside this scan" : ""}`}</title>
          </g>;
        })}
      </svg>
    </div>
  );
}
