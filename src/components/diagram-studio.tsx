"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Check, ChevronDown, ChevronRight, Download, Eye, EyeOff, Focus, Image as ImageIcon, Loader2, LockKeyhole, Maximize2, Move, Redo2, Save, Search, Table2, X } from "lucide-react";

export type DiagramModel = {
  database: string;
  engine: string;
  namespaces: string[];
  entities: DiagramEntity[];
  relationships: DiagramRelationship[];
};
export type DiagramEntity = {
  id: string;
  name: string;
  shortName: string;
  namespace: string;
  kind: string;
  fields: { name: string; type: string; nullable: boolean; isPrimaryKey?: boolean; presence?: number; bsonTypes?: string[] }[];
  indexes: { name: string; columns: string[]; unique: boolean }[];
  constraints: { name: string; kind: string; columns: string[]; referencedEntity?: string | null }[];
};
export type DiagramRelationship = { id: string; fromEntity: string; fromColumns: string[]; toEntity: string; toColumns: string[]; cardinality: string; provenance: string; confidence?: number };
export type StoredLayout = {
  nodes: { id: string; label: string; x: number; y: number; width: number; height: number; kind: string; fieldCount: number }[];
  edges: { id: string; from: string; to: string; label: string; provenance: string; cardinality: string }[];
  width: number;
  height: number;
  settings?: { hidden?: string[]; collapsed?: string[]; showInferred?: boolean };
};

type Node = StoredLayout["nodes"][number];
type Point = { x: number; y: number };
const NODE_W = 256;
const HEADER = 42;
const ROW = 22;
const MAX_FIELDS = 14;
const NS_PALETTE = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#ef4444"];

export default function DiagramStudio({ model, stored, scanId, onToast }: { model: DiagramModel | null; stored: StoredLayout | null; scanId: string; onToast: (message: string, kind?: "success" | "error") => void }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showInferred, setShowInferred] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [namespace, setNamespace] = useState("all");
  const [zoom, setZoom] = useState(0.75);
  const [pan, setPan] = useState<Point>({ x: 24, y: 24 });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showList, setShowList] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 900, h: 680 });
  useEffect(() => {
    const el = viewport.current; if (!el) return;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<{ kind: "pan" | "node"; id?: string; startX: number; startY: number; originX: number; originY: number; panX: number; panY: number } | null>(null);
  const initial = useRef<Node[]>([]);

  useEffect(() => {
    const incoming = stored?.nodes ?? [];
    setNodes(incoming.map((n) => ({ ...n })));
    initial.current = incoming.map((n) => ({ ...n }));
    setHidden(new Set(stored?.settings?.hidden ?? []));
    setCollapsed(new Set(stored?.settings?.collapsed ?? []));
    setShowInferred(stored?.settings?.showInferred ?? true);
    setDirty(false);
  }, [stored, scanId]);

  const visible = useMemo(() => nodes.filter((n) => !hidden.has(n.id) && (namespace === "all" || model?.entities.find((e) => e.name === n.id)?.namespace === namespace)), [nodes, hidden, namespace, model]);
  const visibleIds = useMemo(() => new Set(visible.map((n) => n.id)), [visible]);
  const edges = useMemo(() => (stored?.edges ?? []).filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to) && (showInferred || e.provenance === "explicit")), [stored, visibleIds, showInferred]);
  const selectedEntity = model?.entities.find((e) => e.name === selected) ?? null;
  const related = useMemo(() => new Set(edges.filter((e) => e.from === selected || e.to === selected).flatMap((e) => [e.from, e.to])), [edges, selected]);
  const searchMatches = useMemo(() => query.trim() ? visible.filter((n) => n.id.toLowerCase().includes(query.toLowerCase()) || model?.entities.find((e) => e.name === n.id)?.fields.some((f) => f.name.toLowerCase().includes(query.toLowerCase()))).slice(0, 8) : [], [query, visible, model]);

  function nodeHeight(node: Node) {
    if (collapsed.has(node.id)) return HEADER;
    const entity = model?.entities.find((e) => e.name === node.id);
    return HEADER + Math.min(entity?.fields.length ?? node.fieldCount, MAX_FIELDS) * ROW + ((entity?.fields.length ?? 0) > MAX_FIELDS ? 24 : 12);
  }
  function anchors(from: Node, to: Node) {
    const fh = nodeHeight(from), th = nodeHeight(to);
    const forward = from.x + NODE_W / 2 <= to.x + NODE_W / 2;
    const a = { x: forward ? from.x + NODE_W : from.x, y: from.y + Math.min(fh / 2, HEADER + 22) };
    const b = { x: forward ? to.x : to.x + NODE_W, y: to.y + Math.min(th / 2, HEADER + 22) };
    return { a, b, forward };
  }
  function edgePath(from: Node, to: Node) {
    const { a, b } = anchors(from, to);
    if (from.id === to.id) return `M ${a.x} ${a.y} C ${a.x + 90} ${a.y - 70}, ${b.x + 90} ${b.y + 70}, ${b.x} ${b.y}`;
    const bend = Math.max(48, Math.abs(b.x - a.x) * 0.42);
    const dir = b.x >= a.x ? 1 : -1;
    return `M ${a.x} ${a.y} C ${a.x + bend * dir} ${a.y}, ${b.x - bend * dir} ${b.y}, ${b.x} ${b.y}`;
  }

  function beginPan(e: React.PointerEvent) {
    if ((e.target as Element).closest("[data-node]")) return;
    gesture.current = { kind: "pan", startX: e.clientX, startY: e.clientY, originX: 0, originY: 0, panX: pan.x, panY: pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function beginNode(e: React.PointerEvent, node: Node) {
    e.stopPropagation();
    setSelected(node.id);
    gesture.current = { kind: "node", id: node.id, startX: e.clientX, startY: e.clientY, originX: node.x, originY: node.y, panX: pan.x, panY: pan.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pan") setPan({ x: g.panX + e.clientX - g.startX, y: g.panY + e.clientY - g.startY });
    else {
      const dx = (e.clientX - g.startX) / zoom, dy = (e.clientY - g.startY) / zoom;
      setNodes((all) => all.map((n) => n.id === g.id ? { ...n, x: Math.round(g.originX + dx), y: Math.round(g.originY + dy) } : n));
      setDirty(true);
    }
  }
  function endGesture() { gesture.current = null; }
  function fit() {
    if (!visible.length || !viewport.current) return;
    const minX = Math.min(...visible.map((n) => n.x)), minY = Math.min(...visible.map((n) => n.y));
    const maxX = Math.max(...visible.map((n) => n.x + NODE_W)), maxY = Math.max(...visible.map((n) => n.y + nodeHeight(n)));
    const rect = viewport.current.getBoundingClientRect();
    const z = Math.min(1.15, Math.max(0.2, Math.min((rect.width - 80) / (maxX - minX), (rect.height - 80) / (maxY - minY))));
    setZoom(z);
    setPan({ x: -minX * z + 40, y: -minY * z + 40 });
  }
  function focusNode(id: string) {
    const n = nodes.find((x) => x.id === id);
    if (!n || !viewport.current) return;
    setSelected(id);
    setQuery("");
    const rect = viewport.current.getBoundingClientRect();
    const z = Math.max(zoom, 0.9);
    setZoom(z);
    setPan({ x: rect.width / 2 - (n.x + NODE_W / 2) * z, y: rect.height / 2 - (n.y + 70) * z });
  }
  function toggleHidden(id: string) {
    setHidden((old) => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
    setDirty(true);
  }
  function toggleCollapsed(id: string) {
    setCollapsed((old) => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
    setDirty(true);
  }
  async function save() {
    setSaving(true);
    const payload = { ...stored, nodes, width: stored?.width ?? 2000, height: stored?.height ?? 1200, settings: { hidden: [...hidden], collapsed: [...collapsed], showInferred } };
    const r = await fetch("/api/v1/diagrams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scanId, layout: payload }) }).then((x) => x.json()).catch(() => ({ error: "Network error" }));
    setSaving(false);
    if (r.layout) { setDirty(false); onToast("Diagram layout saved", "success"); }
    else onToast(r.error ?? "Could not save layout", "error");
  }
  function exportedSvg() {
    if (!svgRef.current || !visible.length) return null;
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    const minX = Math.min(...visible.map((n) => n.x)) - 50, minY = Math.min(...visible.map((n) => n.y)) - 50;
    const maxX = Math.max(...visible.map((n) => n.x + NODE_W)) + 50, maxY = Math.max(...visible.map((n) => n.y + nodeHeight(n))) + 50;
    clone.setAttribute("viewBox", `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    clone.setAttribute("width", String(maxX - minX));
    clone.setAttribute("height", String(maxY - minY));
    clone.querySelectorAll("[data-viewport]").forEach((g) => g.setAttribute("transform", ""));
    clone.querySelectorAll("[data-ui-only]").forEach((el) => el.remove());
    clone.setAttribute("style", "background:#f8fafc");
    const paint = (sel: string, attr: string, val: string) => clone.querySelectorAll(sel).forEach((el) => el.setAttribute(attr, val));
    paint("rect.fill-white", "fill", "#ffffff"); paint("path.fill-slate-100", "fill", "#f1f5f9"); paint("path.fill-indigo-50", "fill", "#eef2ff"); paint("path.fill-violet-50", "fill", "#f5f3ff");
    paint("text.fill-slate-900", "fill", "#0f172a"); paint("text.fill-slate-700", "fill", "#334155"); paint("line.stroke-slate-100", "stroke", "#f1f5f9"); paint("pattern circle", "fill", "#dbe3ee");
    return { text: new XMLSerializer().serializeToString(clone), width: maxX - minX, height: maxY - minY };
  }
  function exportSvg() {
    const out = exportedSvg();
    if (!out) return;
    const url = URL.createObjectURL(new Blob([out.text], { type: "image/svg+xml" }));
    triggerDownload(url, `${model?.database ?? "schema"}-diagram.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportPng() {
    const out = exportedSvg();
    if (!out) return;
    const url = URL.createObjectURL(new Blob([out.text], { type: "image/svg+xml" }));
    const image = new window.Image();
    image.onload = () => {
      const scale = Math.min(2, 5000 / Math.max(out.width, out.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(out.width * scale); canvas.height = Math.round(out.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#f8fafc"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => { if (blob) { const png = URL.createObjectURL(blob); triggerDownload(png, `${model?.database ?? "schema"}-diagram.png`); setTimeout(() => URL.revokeObjectURL(png), 1000); } }, "image/png");
      URL.revokeObjectURL(url);
    };
    image.onerror = () => { URL.revokeObjectURL(url); onToast("PNG export failed; use SVG instead", "error"); };
    image.src = url;
  }

  if (!model || !stored) return <div className="surface p-12 text-center"><Box className="mx-auto text-ink-muted/60" /><h3 className="mt-3 font-semibold">No diagram for this scan</h3><p className="mt-1 text-sm text-ink-muted">Import a schema or run a live scan to generate an ELK layout.</p></div>;

  const worldW = Math.max(1600, ...visible.map((n) => n.x + NODE_W + 400));
  const worldH = Math.max(1000, ...visible.map((n) => n.y + nodeHeight(n) + 300));
  return (
    <div className="overflow-hidden surface shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <div className="relative min-w-[220px] flex-1 md:max-w-[340px]">
          <Search size={15} className="absolute left-3 top-2.5 text-ink-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find table or field…" className="w-full rounded-lg border border-line bg-muted py-2 pl-9 pr-8 text-sm outline-none focus:border-indigo-400 focus:bg-elevated" />
          {query && <button onClick={() => setQuery("")} className="absolute right-2 top-2 text-ink-muted"><X size={16} /></button>}
          {searchMatches.length > 0 && <div className="absolute left-0 right-0 top-11 z-30 overflow-hidden rounded-xl border border-line bg-elevated shadow-xl">{searchMatches.map((n) => <button key={n.id} onClick={() => focusNode(n.id)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-indigo-500/10"><Table2 size={14} className="text-indigo-500" /><span className="font-mono">{n.id}</span><Focus size={13} className="ml-auto text-ink-muted" /></button>)}</div>}
        </div>
        <select value={namespace} onChange={(e) => setNamespace(e.target.value)} className="rounded-lg border border-line bg-elevated px-2.5 py-2 text-sm"><option value="all">All schemas</option>{model.namespaces.map((n) => <option key={n}>{n}</option>)}</select>
        <button onClick={() => setShowList((v) => !v)} className={`rounded-lg border px-2.5 py-2 text-sm ${showList ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" : "border-line"}`}><Eye size={15} className="inline" /> <span className="hidden sm:inline">Entities</span></button>
        <label className="hidden items-center gap-1.5 rounded-lg px-2 text-xs text-ink-muted lg:flex"><input type="checkbox" checked={showInferred} onChange={(e) => { setShowInferred(e.target.checked); setDirty(true); }} /> Inferred</label>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => { setNodes(initial.current.map((n) => ({ ...n }))); setHidden(new Set()); setCollapsed(new Set()); setDirty(true); setTimeout(fit, 30); }} title="Restore ELK layout" className="rounded-lg p-2 text-ink-muted hover:bg-muted"><Redo2 size={16} /></button>
          <button onClick={fit} title="Fit to screen" className="rounded-lg p-2 text-ink-muted hover:bg-muted"><Maximize2 size={16} /></button>
          <button onClick={save} disabled={saving || !dirty} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{saving ? <Loader2 size={14} className="animate-spin" /> : dirty ? <Save size={14} /> : <Check size={14} />}{dirty ? "Save layout" : "Saved"}</button>
          <div className="flex overflow-hidden rounded-lg border border-line"><button onClick={exportSvg} title="Export SVG" className="p-2 hover:bg-muted"><Download size={15} /></button><button onClick={exportPng} title="Export PNG" className="border-l border-line p-2 hover:bg-muted"><ImageIcon
size={15} /></button>
</div>
        </div>
      </div>
      <div className="grid lg:grid-cols-[1fr_290px]">
        <div className="relative min-w-0 overflow-hidden">
          {showList && <div className="absolute left-3 top-3 z-20 max-h-[460px] w-64 overflow-auto rounded-xl border border-line bg-elevated/95 p-2 shadow-xl backdrop-blur"><div className="flex items-center justify-between px-2 py-1 text-xs font-semibold text-ink-muted"><span>{visible.length} visible / {nodes.length}</span><button onClick={() => setShowList(false)}><X size={14} /></button></div>{nodes.map((n) => <div key={n.id} className="flex items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-muted"><button onClick={() => toggleHidden(n.id)} className="p-1 text-ink-muted">{hidden.has(n.id) ? <EyeOff size={14} /> : <Eye size={14} />}</button><button onClick={() => focusNode(n.id)} className={`truncate font-mono text-xs ${hidden.has(n.id) ? "text-ink-muted/60 line-through" : "text-ink"}`}>{n.id}</button></div>)}</div>}
          <div ref={viewport} className="diagram-canvas relative h-[680px] overflow-hidden bg-[#f8fafc] dark:bg-[#0a1120]" onPointerDown={beginPan} onPointerMove={move} onPointerUp={endGesture} onPointerCancel={endGesture} onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom((z) => Math.max(0.18, Math.min(2.4, z - Math.sign(e.deltaY) * 0.08))); } }}>
            <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={worldW} height={worldH} viewBox={`0 0 ${worldW} ${worldH}`} className="max-w-none select-none" role="img" aria-label={`${model.database} ${model.engine === "mongodb" ? "document model" : "entity relationship"} diagram`}>
              <defs>
                <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" className="fill-slate-300 dark:fill-slate-700" /></pattern>
                <marker id="edge-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="#64748b" strokeWidth="1.4" /></marker>
                <marker id="edge-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="#4f46e5" strokeWidth="1.6" /></marker>
                <filter id="node-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#0f172a" floodOpacity="0.09" /></filter>
              </defs>
              <g data-viewport transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
                <rect x={-pan.x / zoom} y={-pan.y / zoom} width={worldW / zoom} height={worldH / zoom} fill="url(#grid)" data-ui-only />
                {edges.map((edge) => {
                  const from = visible.find((n) => n.id === edge.from), to = visible.find((n) => n.id === edge.to);
                  if (!from || !to) return null;
                  const active = selected && (edge.from === selected || edge.to === selected);
                  const dim = selected && !active;
                  const inferred = edge.provenance !== "explicit";
                  const { a, b } = anchors(from, to);
                  return <g key={edge.id} opacity={dim ? 0.12 : 1}>
                    <path d={edgePath(from, to)} fill="none" stroke={active ? "#4f46e5" : inferred ? "#a855f7" : "#94a3b8"} strokeWidth={active ? 2.4 : 1.5} strokeDasharray={inferred ? "7 5" : undefined} className={active ? "edge-flow" : undefined} markerEnd={active ? "url(#edge-arrow-active)" : "url(#edge-arrow)"} />
                    <circle cx={a.x} cy={a.y} r="3" fill={active ? "#4f46e5" : inferred ? "#a855f7" : "#94a3b8"} />
                    {active && <g transform={`translate(${(a.x + b.x) / 2 - 34} ${(a.y + b.y) / 2 - 10})`}><rect width="68" height="20" rx="10" fill={inferred ? "#faf5ff" : "#eef2ff"} stroke={inferred ? "#d8b4fe" : "#c7d2fe"} /><text x="34" y="14" textAnchor="middle" fontSize="10" fontWeight="600" fill={inferred ? "#7e22ce" : "#4338ca"}>{edge.cardinality}</text></g>}
                  </g>;
                })}
                {visible.map((node) => {
                  const entity = model.entities.find((e) => e.name === node.id);
                  if (!entity) return null;
                  const isCollapsed = collapsed.has(node.id);
                  const height = nodeHeight(node);
                  const active = selected === node.id;
                  const dim = selected && !related.has(node.id) && !active;
                  const isMatch = query && searchMatches.some((m) => m.id === node.id);
                  const fks = new Set(entity.constraints.filter((c) => c.kind === "foreign_key").flatMap((c) => c.columns));
                  return <g key={node.id} data-node transform={`translate(${node.x} ${node.y})`} opacity={dim ? 0.3 : 1} onPointerDown={(e) => beginNode(e, node)} onDoubleClick={() => toggleCollapsed(node.id)} className="cursor-move">
                    <rect width={NODE_W} height={height} rx="12" className="fill-white dark:fill-slate-900" stroke={active || isMatch ? "#4f46e5" : "#d5dde8"} strokeWidth={active || isMatch ? 2 : 1} filter="url(#node-shadow)" />
                    <path d={`M 12 0 H ${NODE_W - 12} Q ${NODE_W} 0 ${NODE_W} 12 V ${HEADER} H 0 V 12 Q 0 0 12 0`} className={active ? "fill-indigo-50 dark:fill-indigo-500/15" : entity.kind === "collection" ? "fill-violet-50 dark:fill-violet-500/10" : "fill-slate-100 dark:fill-slate-800"} />
                    <rect x="12" y="0" width={NODE_W - 24} height="3" rx="1.5" fill={NS_PALETTE[Math.max(0, model.namespaces.indexOf(entity.namespace)) % NS_PALETTE.length]} />
                    <rect x="12" y="10" width="22" height="22" rx="6" fill={entity.kind === "collection" ? "#ede9fe" : "#e0e7ff"} />
                    <text x="23" y="25" textAnchor="middle" fontSize="11" fontWeight="800" fill={entity.kind === "collection" ? "#7c3aed" : "#4f46e5"}>{entity.kind === "collection" ? "D" : "T"}</text>
                    <text x="43" y="25" fontSize="13" fontWeight="700" className="fill-slate-900 dark:fill-slate-100">{truncate(node.label, 23)}</text>
                    <text x={NODE_W - 26} y="25" textAnchor="middle" fontSize="15" fill="#64748b">{isCollapsed ? "+" : "−"}</text>
                    {!isCollapsed && entity.fields.slice(0, MAX_FIELDS).map((field, i) => <g key={field.name} transform={`translate(0 ${HEADER + i * ROW})`}>
                      {i > 0 && <line x1="12" x2={NODE_W - 12} y1="0" y2="0" className="stroke-slate-100 dark:stroke-slate-800" />}
                      {field.isPrimaryKey ? <><rect x="11" y="6" width="20" height="11" rx="3" fill="#fef3c7" /><text x="21" y="14.5" textAnchor="middle" fontSize="7.5" fontWeight="800" fill="#b45309">PK</text></> : fks.has(field.name) ? <><rect x="11" y="6" width="20" height="11" rx="3" fill="#e0e7ff" /><text x="21" y="14.5" textAnchor="middle" fontSize="7.5" fontWeight="800" fill="#4f46e5">FK</text></> : <circle cx="18" cy="11" r="2" fill={field.nullable ? "#cbd5e1" : "#64748b"} />}
                      <text x="38" y="15" fontSize="10.5" fontFamily="ui-monospace, SFMono-Regular, monospace" className={field.isPrimaryKey ? "fill-slate-900 dark:fill-slate-100" : "fill-slate-700 dark:fill-slate-300"} fontWeight={field.isPrimaryKey ? "700" : "400"}>{truncate(field.name, 18)}</text>
                      <text x={NODE_W - 12} y="15" textAnchor="end" fontSize="9.5" fontFamily="ui-monospace, SFMono-Regular, monospace" fill="#94a3b8">{truncate(field.type, 14)}</text>
                    </g>)}
                    {!isCollapsed && entity.fields.length > MAX_FIELDS && <text x="14" y={height - 8} fontSize="9.5" fill="#64748b">+ {entity.fields.length - MAX_FIELDS} more fields</text>}
                  </g>;
                })}
              </g>
            </svg>
            <div data-ui-only className="glass absolute bottom-3 left-3 flex items-center gap-1 rounded-xl border border-line bg-elevated/95 p-1 shadow-sm backdrop-blur"><button onClick={() => setZoom((z) => Math.max(0.18, z - 0.1))} className="h-8 w-8 rounded-lg text-lg hover:bg-muted">−</button><button onClick={() => setZoom(0.75)} className="w-12 text-xs font-semibold text-ink-muted">{Math.round(zoom * 100)}%</button><button onClick={() => setZoom((z) => Math.min(2.4, z + 0.1))} className="h-8 w-8 rounded-lg text-lg hover:bg-muted">+</button></div>
            {visible.length > 0 && (() => {
              const minX = Math.min(...visible.map((n) => n.x)) - 40, minY = Math.min(...visible.map((n) => n.y)) - 40;
              const maxX = Math.max(...visible.map((n) => n.x + NODE_W)) + 40, maxY = Math.max(...visible.map((n) => n.y + nodeHeight(n))) + 40;
              const W = 180, H = 120, s = Math.min(W / (maxX - minX), H / (maxY - minY));
              const vx = (-pan.x / zoom - minX) * s, vy = (-pan.y / zoom - minY) * s, vw = (vp.w / zoom) * s, vh = (vp.h / zoom) * s;
              return <div data-ui-only className="glass absolute right-4 top-4 hidden overflow-hidden rounded-xl border border-line shadow-sm md:block" aria-label="Minimap">
                <svg width={W} height={H} className="cursor-pointer" onPointerDown={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); const wx = (e.clientX - r.left) / s + minX, wy = (e.clientY - r.top) / s + minY; setPan({ x: vp.w / 2 - wx * zoom, y: vp.h / 2 - wy * zoom }); }}>
                  {visible.map((n) => { const en = model.entities.find((x) => x.name === n.id); return <rect key={n.id} x={(n.x - minX) * s} y={(n.y - minY) * s} width={NODE_W * s} height={nodeHeight(n) * s} rx="2" fill={NS_PALETTE[Math.max(0, model.namespaces.indexOf(en?.namespace ?? "")) % NS_PALETTE.length]} opacity={selected && selected !== n.id ? .35 : .8} />; })}
                  <rect x={vx} y={vy} width={vw} height={vh} fill="rgba(99,102,241,.08)" stroke="#6366f1" strokeWidth="1.5" rx="3" />
                </svg>
                {model.namespaces.length > 1 && <div className="flex max-w-[180px] flex-wrap gap-x-2 gap-y-0.5 border-t border-line px-2 py-1.5">{model.namespaces.slice(0, 6).map((ns, i) => <span key={ns} className="flex items-center gap-1 text-[9px] text-ink-muted"><span className="h-1.5 w-1.5 rounded-full" style={{ background: NS_PALETTE[i % NS_PALETTE.length] }} />{ns}</span>)}</div>}
              </div>;
            })()}
            <div data-ui-only className="absolute bottom-4 right-4 flex items-center gap-3 rounded-lg bg-elevated/80 px-3 py-1.5 text-[10px] text-ink-muted backdrop-blur"><span className="flex items-center gap-1"><Move size={11} />Drag canvas</span><span>Double-click node to collapse</span><span>⌘/Ctrl + wheel to zoom</span></div>
          </div>
        </div>
        <aside className="border-t border-line bg-elevated p-4 lg:border-l lg:border-t-0">
          {selectedEntity ? <div>
            <div className="flex items-start justify-between"><div><div className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">{selectedEntity.kind}</div><h3 className="mt-1 break-all font-mono text-sm font-bold">{selectedEntity.name}</h3></div><button onClick={() => setSelected(null)} className="text-ink-muted"><X size={16} /></button></div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">{[[selectedEntity.fields.length, "Fields"], [selectedEntity.indexes.length, "Indexes"], [selectedEntity.constraints.length, "Rules"]].map(([v, l]) => <div key={String(l)} className="rounded-lg bg-muted p-2"><div className="font-bold">{v}</div><div className="text-[10px] text-ink-muted">{l}</div></div>)}</div>
            <div className="mt-4 flex gap-2"><button onClick={() => toggleCollapsed(selectedEntity.name)} className="flex-1 rounded-lg border border-line px-2 py-1.5 text-xs font-semibold">{collapsed.has(selectedEntity.name) ? <ChevronRight size={13} className="inline" /> : <ChevronDown size={13} className="inline" />} {collapsed.has(selectedEntity.name) ? "Expand" : "Collapse"}</button><button onClick={() => { toggleHidden(selectedEntity.name); setSelected(null); }} className="rounded-lg border border-line px-2 py-1.5 text-xs text-ink-muted"><EyeOff size={13} /></button></div>
            <h4 className="mt-5 text-xs font-bold uppercase tracking-wider text-ink-muted">Connected relationships</h4>
            <div className="mt-2 space-y-2">{edges.filter((e) => e.from === selected || e.to === selected).map((e) => <button key={e.id} onClick={() => focusNode(e.from === selected ? e.to : e.from)} className="w-full rounded-lg bg-muted p-2 text-left text-xs hover:bg-indigo-500/10"><div className="font-mono text-[11px]">{e.from === selected ? `→ ${e.to}` : `← ${e.from}`}</div><div className={`mt-1 ${e.provenance === "explicit" ? "text-indigo-600" : "text-purple-600"}`}>{e.cardinality} · {e.provenance.replace("_", " ")}</div></button>)}{!edges.some((e) => e.from === selected || e.to === selected) && <p className="text-xs text-ink-muted">No visible relationships.</p>}</div>
          </div> : <div className="py-10 text-center"><LockKeyhole className="mx-auto text-ink-muted/60" size={26} /><h3 className="mt-3 text-sm font-semibold">Select an entity</h3><p className="mt-1 text-xs leading-5 text-ink-muted">Inspect fields, jump through relationships, collapse or hide nodes. Solid edges are enforced; dashed purple edges are inferred.</p></div>}
          <div className="mt-6 border-t border-line/60 pt-4 text-[11px] leading-5 text-ink-muted"><b className="text-ink">{model.engine === "mongodb" ? "Document model map" : "Entity relationship diagram"}</b><br />ELK layered layout · {visible.length} visible nodes · {edges.length} visible links{dirty && <span className="mt-1 block text-amber-600">Unsaved layout changes</span>}</div>
        </aside>
      </div>
    </div>
  );
}

function truncate(value: string, max: number) { return value.length > max ? `${value.slice(0, max - 1)}…` : value; }
function triggerDownload(url: string, name: string) { const a = document.createElement("a"); a.href = url; a.download = name; a.click(); }
