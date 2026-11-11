"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ArrowRight, CheckCircle2, Sparkles } from "lucide-react";

const TABLES = [
  { id: "users", x: 16, y: 36, color: "#6366f1", rows: [["PK", "id", "uuid"], ["", "email", "text"], ["", "name", "text"]] },
  { id: "orders", x: 226, y: 16, color: "#0ea5e9", rows: [["PK", "id", "uuid"], ["FK", "user_id", "uuid"], ["", "status", "text"], ["", "total", "int"]] },
  { id: "order_items", x: 226, y: 192, color: "#8b5cf6", rows: [["PK", "id", "uuid"], ["FK", "order_id", "uuid"], ["FK", "product_id", "uuid"]] },
  { id: "products", x: 16, y: 212, color: "#10b981", rows: [["PK", "id", "uuid"], ["", "sku", "text"], ["", "price", "int"]] },
];
const EDGES = [
  { d: "M 160 80 C 195 80, 192 62, 226 62", explicit: true },
  { d: "M 326 128 C 326 150, 316 172, 316 192", explicit: true },
  { d: "M 226 240 C 196 240, 190 262, 160 262", explicit: true },
  { d: "M 160 100 C 200 150, 196 200, 226 222", explicit: false },
];
const FINDINGS = [
  { sev: "medium", tone: "bg-amber-400", title: "Duplicate indexes on orders", meta: "PG-INDEX-001 · schema evidence · 85%" },
  { sev: "low", tone: "bg-sky-400", title: "FK order_items.product_id without index", meta: "review candidate · needs workload" },
  { sev: "info", tone: "bg-slate-400", title: "order_items is a junction table", meta: "many-to-many detected" },
];

const DOC_LINES = [
  ["{", ""], ["  \"_id\": ", "\"8f3c…\","], ["  \"userId\": ", "\"1a2b…\","], ["  \"status\": ", "\"shipped\","], ["  \"total\": ", "12900,"],
  ["  \"orderItems\": [", ""], ["    { \"productId\": \"p1\", \"qty\": 2 },", ""], ["    { \"productId\": \"p2\", \"qty\": 1 }", ""], ["  ]", ""], ["}", ""],
];

export default function HeroScene() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<0 | 1 | 2>(reduce ? 2 : 0); // 0 draw schema, 1 findings, 2 transform
  useEffect(() => {
    if (reduce) return;
    const t: number[] = [];
    const cycle = () => { setPhase(0); t.push(window.setTimeout(() => setPhase(1), 2600)); t.push(window.setTimeout(() => setPhase(2), 5200)); };
    cycle();
    const iv = window.setInterval(cycle, 9400);
    return () => { t.forEach(clearTimeout); window.clearInterval(iv); };
  }, [reduce]);

  return (
    <div className="relative mx-auto w-full max-w-[640px]">
      {/* window chrome */}
      <motion.div initial={{ opacity: 0, y: 30, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .8, ease: [.2, .8, .2, 1], delay: .2 }} className="glow-ring relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70 p-3 shadow-2xl shadow-black/50 backdrop-blur">
        <div className="mb-2 flex items-center gap-1.5 px-1">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
          <div className="ml-3 flex gap-1 rounded-lg bg-white/5 p-0.5 text-[10px] font-semibold text-slate-400">
            {["Diagram", "Analysis", "Transform"].map((l, i) => <span key={l} className={`relative rounded-md px-2 py-0.5 ${phase === i ? "text-white" : ""}`}>{phase === i && <motion.span layoutId="hero-tab" className="absolute inset-0 rounded-md bg-indigo-500/80" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}<span className="relative">{l}</span></span>)}
          </div>
          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-slate-500"><span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />commerce · PostgreSQL 15</span>
        </div>

        <div className="relative grid gap-3 lg:grid-cols-[1fr_200px]">
          {/* diagram */}
          <div className="relative overflow-hidden rounded-xl bg-[#f8fafc] dark:bg-[#0c1426]">
            <svg viewBox="0 0 400 330" className="w-full" role="img" aria-label="Animated entity-relationship diagram">
              <defs>
                <pattern id="hg" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" className="fill-slate-300 dark:fill-slate-700" /></pattern>
                <marker id="ha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 1 L9 5 L0 9" fill="none" stroke="#6366f1" strokeWidth="1.5" /></marker>
                <filter id="hs" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#0f172a" floodOpacity=".12" /></filter>
              </defs>
              <rect width="400" height="330" fill="url(#hg)" />
              {EDGES.map((e, i) => (
                <g key={i}>
                  <motion.path d={e.d} fill="none" stroke={e.explicit ? "#6366f1" : "#a855f7"} strokeWidth={e.explicit ? 2 : 1.6} strokeDasharray={e.explicit ? undefined : "6 4"} markerEnd="url(#ha)" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: .9, delay: .9 + i * .22, ease: "easeInOut" }} />
                  {e.explicit && phase >= 1 && <motion.circle r="3" fill="#818cf8" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: 1.8, repeat: Infinity, delay: i * .4 }}><animateMotion dur="1.8s" repeatCount="indefinite" path={e.d} /></motion.circle>}
                </g>
              ))}
              {TABLES.map((t, i) => (
                <motion.g key={t.id} initial={{ opacity: 0, scale: .85, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: .55, delay: .35 + i * .14, ease: [.2, .8, .2, 1] }} style={{ transformOrigin: `${t.x + 72}px ${t.y + 40}px` }}>
                  <g transform={`translate(${t.x} ${t.y})`}>
                    <rect width="144" height={34 + t.rows.length * 20 + 6} rx="11" className="fill-white dark:fill-slate-900" stroke={phase === 1 && t.id === "orders" ? "#f59e0b" : "#d5dde8"} strokeWidth={phase === 1 && t.id === "orders" ? 2.2 : 1} filter="url(#hs)" />
                    <path d="M11 0 H133 Q144 0 144 11 V32 H0 V11 Q0 0 11 0" fill={t.color} fillOpacity=".12" />
                    <rect x="10" y="9" width="16" height="16" rx="5" fill={t.color} fillOpacity=".2" /><text x="18" y="21" textAnchor="middle" fontSize="9" fontWeight="800" fill={t.color}>T</text>
                    <text x="33" y="21" fontSize="12" fontWeight="700" className="fill-slate-900 dark:fill-slate-100">{t.id}</text>
                    {t.rows.map(([k, n, ty], r) => (
                      <g key={n} transform={`translate(0 ${34 + r * 20})`}>
                        {k ? <><rect x="9" y="5" width="19" height="11" rx="3" fill={k === "PK" ? "#fef3c7" : "#e0e7ff"} /><text x="18.5" y="13.5" textAnchor="middle" fontSize="7" fontWeight="800" fill={k === "PK" ? "#b45309" : "#4f46e5"}>{k}</text></> : <circle cx="18" cy="10" r="2" fill="#cbd5e1" />}
                        <text x="34" y="14" fontSize="10" fontFamily="ui-monospace,monospace" className="fill-slate-700 dark:fill-slate-300">{n}</text>
                        <text x="136" y="14" textAnchor="end" fontSize="9" fontFamily="ui-monospace,monospace" fill="#94a3b8">{ty}</text>
                      </g>
                    ))}
                  </g>
                </motion.g>
              ))}
              <AnimatePresence>{phase === 2 && <motion.rect key="wash" x="0" y="0" width="400" height="330" fill="#6366f1" initial={{ opacity: 0 }} animate={{ opacity: .06 }} exit={{ opacity: 0 }} />}</AnimatePresence>
            </svg>
            <div className="absolute bottom-2 left-3 flex items-center gap-3 text-[9px] text-slate-500"><span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-indigo-500" />enforced FK</span><span className="flex items-center gap-1"><span className="h-0.5 w-4 border-t-2 border-dashed border-purple-400" />inferred</span></div>
          </div>

          {/* side panel */}
          <div className="relative min-h-[200px] rounded-xl border border-white/5 bg-white/[.03] p-2.5">
            <AnimatePresence mode="wait">
              {phase === 0 && <motion.div key="p0" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-2">
                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Introspecting</div>
                {["Catalog · 4 tables", "Columns · 13", "Indexes · 6", "Foreign keys · 3"].map((l, i) => <motion.div key={l} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .4 + i * .35 }} className="flex items-center gap-2 text-[11px] text-slate-300"><CheckCircle2 size={12} className="text-emerald-400" />{l}</motion.div>)}
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10"><motion.div initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 2.2, ease: "easeInOut" }} className="h-full bg-gradient-to-r from-indigo-400 to-violet-400" /></div>
              </motion.div>}
              {phase === 1 && <motion.div key="p1" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-2">
                <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-500"><AlertTriangle size={10} className="text-amber-400" />3 findings</div>
                {FINDINGS.map((f, i) => <motion.div key={f.title} initial={{ opacity: 0, y: 10, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: .15 + i * .3, type: "spring", stiffness: 260, damping: 22 }} className="rounded-lg border border-white/5 bg-slate-900/80 p-2"><div className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${f.tone}`} /><span className="text-[10px] font-semibold text-white">{f.title}</span></div><div className="mt-0.5 text-[9px] text-slate-500">{f.meta}</div></motion.div>)}
              </motion.div>}
              {phase === 2 && <motion.div key="p2" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
                <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-500"><Sparkles size={10} className="text-indigo-300" />orders → MongoDB</div>
                <pre className="mt-2 font-mono text-[9.5px] leading-[15px] text-slate-300">{DOC_LINES.map(([k, v], i) => <motion.div key={i} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .1 + i * .13 }} className={i >= 5 && i <= 8 ? "text-indigo-300" : ""}><span className="text-emerald-300">{k}</span>{v}</motion.div>)}</pre>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6 }} className="mt-2 flex items-center gap-1 rounded-md bg-indigo-500/15 px-2 py-1 text-[9px] text-indigo-200"><ArrowRight size={10} /> order_items embedded · owned</motion.div>
              </motion.div>}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      {/* floating chips */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1, duration: .6 }} className="animate-float absolute -left-5 top-6 hidden rounded-xl border border-white/10 bg-slate-900/90 px-3 py-2 shadow-xl backdrop-blur sm:block">
        <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-300">Design score</div><div className="text-lg font-bold text-white">84<span className="text-xs text-slate-400">/100</span></div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.4, duration: .6 }} className="animate-float-slow absolute -bottom-6 -right-3 hidden rounded-xl border border-white/10 bg-slate-900/90 px-3 py-2 shadow-xl backdrop-blur sm:block">
        <div className="text-[9px] font-bold uppercase tracking-wider text-indigo-300">Advisor</div><div className="text-xs font-semibold text-white">PostgreSQL 86 · MongoDB 71</div>
      </motion.div>
    </div>
  );
}
