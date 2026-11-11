"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ArrowRight, CheckCircle2, Sparkles, Workflow } from "lucide-react";
import { engineGlyph, engineTint } from "@/components/engine-icon";

// The hero is a miniature of the product: it introspects a multi-schema
// database, analyzes it, transforms it, then zooms out to the whole system.
const SCHEMA_COLOR: Record<string, string> = { auth: "#6366f1", sales: "#0ea5e9", catalog: "#10b981" };
const TABLES = [
  { id: "users", schema: "auth", x: 16, y: 36, rows: [["PK", "id", "uuid"], ["", "email", "text"], ["", "display_name", "text"]] },
  { id: "orders", schema: "sales", x: 226, y: 16, rows: [["PK", "id", "uuid"], ["FK", "user_id", "uuid"], ["", "status", "text"], ["", "total_cents", "int"]] },
  { id: "order_items", schema: "sales", x: 226, y: 192, rows: [["PK", "id", "uuid"], ["FK", "order_id", "uuid"], ["FK", "product_id", "uuid"]] },
  { id: "products", schema: "catalog", x: 16, y: 212, rows: [["PK", "id", "uuid"], ["", "sku", "text"], ["", "price_cents", "int"]] },
];
const EDGES = [
  { d: "M 160 80 C 195 80, 192 62, 226 62", cross: true },
  { d: "M 326 136 C 326 156, 316 172, 316 192", cross: false },
  { d: "M 226 240 C 196 240, 190 262, 160 262", cross: true },
];
const FINDINGS = [
  { tone: "bg-red-400", title: "audit.change_log has no primary key", meta: "PG-CONST-001 · schema evidence" },
  { tone: "bg-amber-400", title: "Schema cycle: auth ⇄ billing", meta: "PG-SCHEMA-001 · 2 foreign keys" },
  { tone: "bg-amber-400", title: "Duplicate index on sales.orders", meta: "PG-INDEX-001 · 85% confidence" },
];
const DOC_LINES: [string, string][] = [
  ["{", ""], ["  \"_id\": ", "\"8f3c…\","], ["  \"userId\": ", "\"1a2b…\","], ["  \"status\": ", "\"shipped\","], ["  \"totalCents\": ", "12900,"],
  ["  \"orderItems\": [", ""], ["    { \"productId\": \"p1\", \"quantity\": 2 },", ""], ["    { \"productId\": \"p2\", \"quantity\": 1 }", ""], ["  ]", ""], ["}", ""],
];
const STORES = [
  { id: "cache", engine: "redis", name: "commerce-cache", sub: "12 key patterns", x: 14, y: 34, w: 170, h: 62 },
  { id: "content", engine: "mongodb", name: "commerce-content", sub: "4 collections", x: 216, y: 34, w: 170, h: 62 },
  { id: "core", engine: "postgres", name: "commerce-core", sub: "8 schemas · 20 tables", x: 96, y: 214, w: 208, h: 84 },
];
const FLOWS = [
  { d: "M 160 214 C 160 160, 100 150, 100 96", label: "cache-aside", lx: 104, ly: 158, solid: true },
  { d: "M 300 96 C 300 150, 244 160, 244 214", label: "4 links", lx: 292, ly: 158, solid: false },
];
const SYSTEM = [
  { tone: "bg-red-400", title: "products lives in two systems", meta: "ARCH-001 · no declared sync" },
  { tone: "bg-red-400", title: "6 keyspaces never expire", meta: "ARCH-006 · cache store" },
  { tone: "bg-amber-400", title: "carts.userId int ≠ users.id uuid", meta: "ARCH-003 · key types" },
];
const TABS = ["Diagram", "Analysis", "Transform", "Architecture"] as const;
const STEP_MS = 3400;

export default function HeroScene() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState(0);
  const timer = useRef<number | null>(null);
  const start = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => setPhase((p) => (p + 1) % TABS.length), STEP_MS);
  }, []);
  useEffect(() => {
    if (reduce) return;
    start();
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [reduce, start]);
  const jump = (i: number) => { setPhase(i); if (!reduce) start(); };
  const system = phase === 3;

  return (
    <div className="relative mx-auto w-full min-w-0 max-w-[660px]">
      <motion.div initial={{ opacity: 0, y: 30, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .8, ease: [.2, .8, .2, 1], delay: .2 }} className="glow-ring gradient-border relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70 p-3 shadow-2xl shadow-black/50 backdrop-blur">
        {/* window chrome */}
        <div className="mb-2 flex items-center gap-1.5 px-1">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
          <div className="ml-3 flex gap-0.5 rounded-lg bg-white/5 p-0.5 text-[10px] font-semibold text-slate-400" role="tablist" aria-label="Product tour">
            {TABS.map((l, i) => <button key={l} role="tab" aria-selected={phase === i} onClick={() => jump(i)} className={`relative rounded-md px-2 py-0.5 transition hover:text-white ${phase === i ? "text-white" : ""}`}>{phase === i && <motion.span layoutId="hero-tab" className="absolute inset-0 rounded-md bg-indigo-500/80" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}<span className="relative">{l}</span></button>)}
          </div>
          <span className="ml-auto hidden items-center gap-1.5 text-[10px] text-slate-500 sm:flex"><span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />{system ? "3 datastores" : "commerce_core · PostgreSQL 16"}</span>
        </div>
        <div className="mx-1 mb-2 h-0.5 overflow-hidden rounded-full bg-white/5">{!reduce && <motion.div key={phase} initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: STEP_MS / 1000, ease: "linear" }} className="h-full bg-gradient-to-r from-indigo-400 to-cyan-300" />}</div>

        <div className="relative grid gap-3 lg:grid-cols-[1fr_204px]">
          <div className="relative overflow-hidden rounded-xl bg-[#f8fafc] dark:bg-[#0c1426]">
            <AnimatePresence mode="wait" initial={false}>
              {!system ? (
                <motion.svg key="er" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: .96 }} transition={{ duration: .35 }} viewBox="0 0 400 330" className="block w-full" role="img" aria-label="Animated entity-relationship diagram">
                  <defs>
                    <pattern id="hg" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" className="fill-slate-300 dark:fill-slate-700" /></pattern>
                    <marker id="ha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 1 L9 5 L0 9" fill="none" stroke="#6366f1" strokeWidth="1.5" /></marker>
                    <filter id="hs" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#0f172a" floodOpacity=".12" /></filter>
                  </defs>
                  <rect width="400" height="330" fill="url(#hg)" />
                  {EDGES.map((e, i) => (
                    <g key={i}>
                      <motion.path d={e.d} fill="none" stroke={e.cross ? "#8b5cf6" : "#6366f1"} strokeWidth="2" markerEnd="url(#ha)" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: .9, delay: .8 + i * .22, ease: "easeInOut" }} />
                      {phase >= 1 && <circle r="3" fill="#818cf8"><animateMotion dur="1.8s" repeatCount="indefinite" path={e.d} begin={`${i * 0.4}s`} /></circle>}
                    </g>
                  ))}
                  {TABLES.map((t, i) => {
                    const color = SCHEMA_COLOR[t.schema];
                    const flagged = phase === 1 && t.id === "orders";
                    return (
                      <motion.g key={t.id} initial={{ opacity: 0, scale: .85, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: .55, delay: .3 + i * .13, ease: [.2, .8, .2, 1] }} style={{ transformOrigin: `${t.x + 72}px ${t.y + 40}px` }}>
                        <g transform={`translate(${t.x} ${t.y})`}>
                          <rect width="144" height={34 + t.rows.length * 20 + 6} rx="11" className="fill-white dark:fill-slate-900" stroke={flagged ? "#f59e0b" : "#d5dde8"} strokeWidth={flagged ? 2.2 : 1} filter="url(#hs)" />
                          <path d="M11 0 H133 Q144 0 144 11 V32 H0 V11 Q0 0 11 0" fill={color} fillOpacity=".13" />
                          <text x="11" y="14" fontSize="7.5" fontWeight="800" fill={color} letterSpacing=".4">{t.schema.toUpperCase()}</text>
                          <text x="11" y="27" fontSize="11.5" fontWeight="700" className="fill-slate-900 dark:fill-slate-100">{t.id}</text>
                          {t.rows.map(([k, n, ty], r) => (
                            <g key={n} transform={`translate(0 ${34 + r * 20})`}>
                              {k ? <><rect x="9" y="5" width="19" height="11" rx="3" fill={k === "PK" ? "#fef3c7" : "#e0e7ff"} /><text x="18.5" y="13.5" textAnchor="middle" fontSize="7" fontWeight="800" fill={k === "PK" ? "#b45309" : "#4f46e5"}>{k}</text></> : <circle cx="18" cy="10" r="2" fill="#cbd5e1" />}
                              <text x="34" y="14" fontSize="10" fontFamily="ui-monospace,monospace" className="fill-slate-700 dark:fill-slate-300">{n}</text>
                              <text x="136" y="14" textAnchor="end" fontSize="9" fontFamily="ui-monospace,monospace" fill="#94a3b8">{ty}</text>
                            </g>
                          ))}
                        </g>
                      </motion.g>
                    );
                  })}
                  {phase === 2 && <motion.rect x="0" y="0" width="400" height="330" fill="#6366f1" initial={{ opacity: 0 }} animate={{ opacity: .06 }} />}
                </motion.svg>
              ) : (
                <motion.svg key="topology" initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: .4 }} viewBox="0 0 400 330" className="block w-full" role="img" aria-label="Animated datastore topology">
                  <defs><pattern id="hg2" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" className="fill-slate-300 dark:fill-slate-700" /></pattern></defs>
                  <rect width="400" height="330" fill="url(#hg2)" />
                  {FLOWS.map((f, i) => (
                    <g key={f.label}>
                      <motion.path d={f.d} fill="none" stroke={f.solid ? "#6366f1" : "#a78bfa"} strokeWidth="2" strokeDasharray={f.solid ? undefined : "6 5"} strokeLinecap="round" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: .8, delay: .35 + i * .2 }} />
                      <circle r="3.2" fill={f.solid ? "#818cf8" : "#c4b5fd"}><animateMotion dur="2.2s" repeatCount="indefinite" path={f.d} /></circle>
                      <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .9 + i * .2 }}><rect x={f.lx - 31} y={f.ly - 9} width="62" height="18" rx="9" fill={f.solid ? "#6366f1" : "#ede9fe"} /><text x={f.lx} y={f.ly + 3.5} textAnchor="middle" fontSize="9" fontWeight="700" fill={f.solid ? "#fff" : "#6d28d9"}>{f.label}</text></motion.g>
                    </g>
                  ))}
                  {STORES.map((s, i) => {
                    const Icon = engineGlyph(s.engine);
                    const color = engineTint(s.engine);
                    return (
                      <motion.g key={s.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .08 + i * .12, type: "spring", stiffness: 240, damping: 22 }}>
                        <rect x={s.x} y={s.y} width={s.w} height={s.h} rx="13" className="fill-white dark:fill-slate-900" stroke="#d5dde8" />
                        <rect x={s.x + 10} y={s.y + 12} width="30" height="30" rx="9" fill={color} fillOpacity=".16" />
                        <Icon x={s.x + 17} y={s.y + 19} width={16} height={16} color={color} />
                        <text x={s.x + 48} y={s.y + 25} fontSize="10.5" fontWeight="700" className="fill-slate-900 dark:fill-slate-100">{s.name}</text>
                        <text x={s.x + 48} y={s.y + 39} fontSize="9" fill="#94a3b8">{s.sub}</text>
                        {s.id === "core" && ["auth", "sales", "catalog", "billing", "+4"].map((n, j) => <g key={n}><rect x={s.x + 10 + j * 38} y={s.y + 54} width="34" height="16" rx="5" fill="#6366f1" fillOpacity=".12" /><text x={s.x + 27 + j * 38} y={s.y + 65} textAnchor="middle" fontSize="8" fontWeight="700" fontFamily="ui-monospace,monospace" fill="#6366f1">{n}</text></g>)}
                      </motion.g>
                    );
                  })}
                </motion.svg>
              )}
            </AnimatePresence>
            <div className="absolute bottom-2 left-3 flex items-center gap-3 text-[9px] text-slate-500">{system ? <><span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-indigo-500" />declared flow</span><span className="flex items-center gap-1"><span className="h-0 w-4 border-t-2 border-dashed border-violet-400" />inferred links</span></> : <><span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-indigo-500" />same schema</span><span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-violet-500" />cross-schema FK</span></>}</div>
          </div>

          {/* side panel */}
          <div className="relative min-h-[204px] rounded-xl border border-white/5 bg-white/[.03] p-2.5">
            <AnimatePresence mode="wait">
              {phase === 0 && <motion.div key="p0" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-2">
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Introspecting</div>
                {["Schemas · 8", "Tables · 20", "Foreign keys · 20", "Cross-schema · 9"].map((l, i) => <motion.div key={l} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .4 + i * .35 }} className="flex items-center gap-2 text-[11px] text-slate-300"><CheckCircle2 size={12} className="text-emerald-400" />{l}</motion.div>)}
                <div className="mt-3 flex flex-wrap gap-1">{["public", "auth", "sales", "catalog", "billing", "support", "analytics", "audit"].map((s, i) => <motion.span key={s} initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.4 + i * .08 }} className="rounded bg-indigo-400/10 px-1.5 py-0.5 font-mono text-[8.5px] text-indigo-200">{s}</motion.span>)}</div>
              </motion.div>}
              {phase === 1 && <Panel k="p1" icon={<AlertTriangle size={10} className="text-amber-400" />} title="3 of 14 findings" items={FINDINGS} />}
              {phase === 2 && <motion.div key="p2" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
                <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-500"><Sparkles size={10} className="text-indigo-300" />orders → MongoDB</div>
                <pre className="mt-2 font-mono text-[9.5px] leading-[15px] text-slate-300">{DOC_LINES.map(([k, v], i) => <motion.div key={i} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .1 + i * .12 }} className={i >= 5 && i <= 8 ? "text-indigo-300" : ""}><span className="text-emerald-300">{k}</span>{v}</motion.div>)}</pre>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} className="mt-2 flex items-center gap-1 rounded-md bg-indigo-500/15 px-2 py-1 text-[9px] text-indigo-200"><ArrowRight size={10} /> order_items embedded · owned</motion.div>
              </motion.div>}
              {phase === 3 && <Panel k="p3" icon={<Workflow size={10} className="text-indigo-300" />} title="Across the system" items={SYSTEM} />}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      {/* floating chips */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1, duration: .6 }} className="animate-float absolute -left-6 -top-14 hidden rounded-xl border border-white/10 bg-slate-900/90 px-3 py-2 shadow-xl backdrop-blur sm:block">
        <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-300">Design score</div><div className="text-lg font-bold text-white">84<span className="text-xs text-slate-400">/100</span></div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.4, duration: .6 }} className="animate-float-slow absolute -bottom-6 -right-3 hidden rounded-xl border border-white/10 bg-slate-900/90 px-3 py-2 shadow-xl backdrop-blur sm:block">
        <div className="text-[9px] font-bold uppercase tracking-wider text-indigo-300">One system</div><div className="text-xs font-semibold text-white">3 stores · 8 schemas · 13 links</div>
      </motion.div>
    </div>
  );
}

function Panel({ k, icon, title, items }: { k: string; icon: React.ReactNode; title: string; items: { tone: string; title: string; meta: string }[] }) {
  return (
    <motion.div key={k} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-2">
      <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-500">{icon}{title}</div>
      {items.map((f, i) => <motion.div key={f.title} initial={{ opacity: 0, y: 10, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: .15 + i * .28, type: "spring", stiffness: 260, damping: 22 }} className="rounded-lg border border-white/5 bg-slate-900/80 p-2"><div className="flex items-start gap-1.5"><span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${f.tone}`} /><span className="text-[10px] font-semibold leading-4 text-white">{f.title}</span></div><div className="mt-0.5 pl-3 text-[9px] text-slate-500">{f.meta}</div></motion.div>)}
    </motion.div>
  );
}
