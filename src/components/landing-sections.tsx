"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion, useScroll, useSpring } from "framer-motion";
import { ArrowRight, BadgeCheck, Database, Menu, X } from "lucide-react";
import DemoButton from "@/components/demo-button";
import ThemeToggle from "@/components/theme-toggle";
import HeroScene from "@/components/hero-scene";
import { Magnetic, Typewriter } from "@/components/motion";
import { ENGINE_LIST } from "@/lib/engines";

const NAV = [["Features", "#features"], ["Transform", "#transform"], ["Advisor", "#advisor"], ["Security", "#security"], ["Roadmap", "#roadmap"]];

export function LandingNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 24 });
  useEffect(() => { const f = () => setScrolled(window.scrollY > 24); f(); window.addEventListener("scroll", f, { passive: true }); return () => window.removeEventListener("scroll", f); }, []);
  return (
    <header className={`sticky top-0 z-40 border-b transition-all duration-300 ${scrolled ? "border-white/10 bg-[#0b1120]/85 shadow-lg shadow-black/20 backdrop-blur-xl" : "border-transparent bg-transparent"}`}>
      <motion.div style={{ scaleX: progress }} className="absolute inset-x-0 top-0 h-[2px] origin-left bg-gradient-to-r from-indigo-400 via-violet-400 to-cyan-300" />
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-5">
        <Link href="/" className="flex items-center gap-2.5 text-white"><motion.span whileHover={{ rotate: 12, scale: 1.08 }} className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-500 shadow-lg shadow-indigo-500/30"><Database size={17} /></motion.span><span className="font-bold tracking-tight">DB Architect</span></Link>
        <nav className="ml-4 hidden gap-1 text-sm text-slate-400 md:flex">{NAV.map(([l, h]) => <a key={l} href={h} className="relative rounded-lg px-3 py-1.5 transition hover:text-white"><span className="relative z-10">{l}</span></a>)}</nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <ThemeToggle compact className="!border-white/15 !bg-white/5 !text-slate-300 hover:!text-white" />
          <Link href="/app" className="hidden text-sm font-medium text-slate-300 hover:text-white sm:block">Sign in</Link>
          <Magnetic><DemoButton className="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400 disabled:opacity-60">Try the demo</DemoButton></Magnetic>
          <button onClick={() => setOpen((v) => !v)} className="rounded-lg p-2 text-slate-300 md:hidden" aria-label="Menu">{open ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </div>
      <AnimatePresence>{open && <motion.nav initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-white/10 bg-[#0b1120] md:hidden"><div className="flex flex-col p-3">{NAV.map(([l, h]) => <a key={l} href={h} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-sm text-slate-300 hover:bg-white/5">{l}</a>)}<Link href="/app" className="rounded-lg px-3 py-2.5 text-sm text-slate-300">Sign in</Link></div></motion.nav>}</AnimatePresence>
    </header>
  );
}

export function Hero() {
  const reduce = useReducedMotion();
  return (
    <section className="relative -mt-16 overflow-hidden bg-[#0b1120] pt-16 text-white">
      {/* aurora */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="aurora absolute -top-40 left-[10%] h-[620px] w-[620px] rounded-full bg-indigo-600/25 blur-[110px]" />
        <div className="aurora-2 absolute -bottom-52 right-[-10%] h-[560px] w-[560px] rounded-full bg-violet-600/20 blur-[120px]" />
        <div className="absolute left-1/2 top-1/3 h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="dot-grid absolute inset-0 opacity-[.35] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" style={{ ["--grid-dot" as string]: "#1f2a44" }} />
      </div>
      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 pb-24 pt-16 lg:grid-cols-[1fr_1.05fr] lg:pb-32 lg:pt-24">
        <div>
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5 }} className="inline-flex items-center gap-2 rounded-full border border-indigo-400/25 bg-indigo-400/10 px-3 py-1 text-xs font-medium text-indigo-200"><span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-400" /> PostgreSQL · MySQL · SQLite · MongoDB — more on the way</motion.div>
          <motion.h1 initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: .12, delayChildren: .15 } } }} className="mt-6 text-5xl font-semibold leading-[1.02] tracking-tight sm:text-6xl lg:text-[4.4rem]">
            {["Understand it.", "Transform it."].map((l) => <motion.span key={l} variants={{ hidden: { opacity: 0, y: 28 }, show: { opacity: 1, y: 0, transition: { duration: .7, ease: [.2, .8, .2, 1] } } }} className="block">{l}</motion.span>)}
            <motion.span variants={{ hidden: { opacity: 0, y: 28 }, show: { opacity: 1, y: 0, transition: { duration: .7, ease: [.2, .8, .2, 1] } } }} className="text-gradient block">Choose the right one.</motion.span>
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .55, duration: .6 }} className="mt-6 max-w-xl text-lg leading-8 text-slate-400">
            DB Architect turns a real database into a diagram, evidence-backed findings and reviewable migrations — and when it&apos;s time to move, a complete plan for another engine with a live look at how your data changes.
          </motion.p>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .75 }} className="mt-4 h-7 font-mono text-sm text-indigo-200/90">
            {reduce ? <span>Postgres → MongoDB: embed order_items into orders</span> : <>&gt; <Typewriter phrases={["Postgres → MongoDB: embed order_items into orders", "MySQL dump → 4 findings · MyISAM, utf8, float money", "Which database fits 100 TB of write-heavy events?", "Mongo → PostgreSQL: arrays become child tables"]} /></>}
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .85, duration: .6 }} className="mt-8 flex flex-wrap items-center gap-4">
            <Magnetic><DemoButton className="group flex items-center gap-2 rounded-xl bg-indigo-500 px-6 py-3.5 text-sm font-bold text-white shadow-xl shadow-indigo-500/25 transition hover:bg-indigo-400 disabled:opacity-60">Open the live demo <ArrowRight size={16} className="transition group-hover:translate-x-1" /></DemoButton></Magnetic>
            <Link href="/app" className="rounded-xl border border-white/15 px-6 py-3.5 text-sm font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/5">Create a workspace</Link>
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }} className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-500">{["Read-only by default", "AES-256-GCM encrypted credentials", "Never stores your rows"].map((t) => <span key={t} className="flex items-center gap-1.5"><BadgeCheck size={14} className="text-emerald-400" />{t}</span>)}</motion.div>
        </div>
        <HeroScene />
      </div>
      {/* bottom fade */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-canvas" />
    </section>
  );
}

export function EngineMarquee() {
  const extra = [["SQL Server", "#a4262c", "next"], ["Redis", "#d82c20", "planned"], ["DynamoDB", "#4053d6", "advisor"], ["ClickHouse", "#ffcc01", "advisor"], ["Elasticsearch", "#f3c41a", "advisor"], ["Cassandra", "#1287b1", "advisor"]];
  const items = [...ENGINE_LIST.map((e) => [e.label, e.color, e.live ? "live" : "import"] as const), ...(extra as [string, string, string][])];
  const row = [...items, ...items];
  return (
    <section id="engines" className="relative border-y border-line bg-elevated/60 py-6">
      <div className="mx-auto mb-3 max-w-7xl px-5 text-center text-[11px] font-bold uppercase tracking-[.2em] text-ink-muted">Engines · built in order of real-world usage</div>
      <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
        <div className="marquee flex w-max gap-3 px-3">{row.map(([label, color, tag], i) => <span key={i} className="flex items-center gap-2 rounded-full border border-line bg-elevated px-4 py-2 text-sm font-semibold text-ink"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />{label}<span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${tag === "live" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : tag === "import" ? "bg-sky-500/15 text-sky-600 dark:text-sky-300" : tag === "next" ? "bg-amber-500/15 text-amber-600 dark:text-amber-300" : "bg-slate-500/15 text-ink-muted"}`}>{tag}</span></span>)}</div>
      </div>
    </section>
  );
}

const ROWS = [["100", "1", "shipped"], ["101", "1", "pending"], ["102", "2", "shipped"]];
const ITEMS = [["100", "SKU-1000", "2"], ["100", "SKU-1001", "1"], ["101", "SKU-1003", "4"], ["102", "SKU-1000", "1"]];
export function TransformShowcase() {
  const [idx, setIdx] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => { if (reduce) return; const t = window.setInterval(() => setIdx((i) => (i + 1) % ROWS.length), 2600); return () => window.clearInterval(t); }, [reduce]);
  const order = ROWS[idx]; const items = ITEMS.filter((it) => it[0] === order[0]);
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_auto_1.1fr] sm:items-stretch">
      <div className="rounded-xl border border-white/10 bg-slate-900 p-4 font-mono text-[11px] leading-5 text-slate-300">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500"><span className="h-2 w-2 rounded-full bg-[#00758f]" />MySQL rows</div>
        <div className="text-sky-300">orders</div>
        <div className="text-slate-500">id | customer_id | status</div>
        {ROWS.map((r, i) => <motion.div key={r[0]} animate={{ backgroundColor: i === idx ? "rgba(99,102,241,.22)" : "rgba(0,0,0,0)", x: i === idx ? 4 : 0 }} transition={{ duration: .35 }} className="rounded px-1 -mx-1">{r.join(" | ")}</motion.div>)}
        <div className="mt-3 text-sky-300">order_items</div>
        <div className="text-slate-500">order_id | sku | qty</div>
        {ITEMS.map((r, i) => <motion.div key={i} animate={{ backgroundColor: r[0] === order[0] ? "rgba(139,92,246,.22)" : "rgba(0,0,0,0)", x: r[0] === order[0] ? 4 : 0 }} transition={{ duration: .35 }} className="rounded px-1 -mx-1">{r.join(" | ")}</motion.div>)}
      </div>
      <div className="flex items-center justify-center">
        <motion.div animate={reduce ? {} : { x: [0, 6, 0] }} transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }} className="rounded-full border border-indigo-400/30 bg-indigo-500/10 p-2 text-indigo-300 rotate-90 sm:rotate-0"><ArrowRight size={18} /></motion.div>
      </div>
      <div className="rounded-xl border border-indigo-400/30 bg-slate-900 p-4 font-mono text-[11px] leading-5 text-slate-300">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-indigo-300"><span className="h-2 w-2 rounded-full bg-[#13aa52]" />MongoDB document</div>
        <AnimatePresence mode="wait">
          <motion.pre key={order[0]} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: .3 }} className="whitespace-pre-wrap">{`{ `}<span className="text-emerald-300">&quot;_id&quot;</span>{`: ${order[0]},\n  `}<span className="text-emerald-300">&quot;customerId&quot;</span>{`: ${order[1]},\n  `}<span className="text-emerald-300">&quot;status&quot;</span>{`: "${order[2]}",\n  `}<span className="text-indigo-300">&quot;orderItems&quot;</span>{`: [\n${items.map((it) => `    { "sku": "${it[1]}", "qty": ${it[2]} }`).join(",\n")}\n  ] }`}</motion.pre>
        </AnimatePresence>
        <div className="mt-2 rounded-md bg-indigo-500/10 px-2 py-1 text-[10px] text-indigo-200">order_items embedded · owned · ON DELETE CASCADE · {items.length} item{items.length === 1 ? "" : "s"}</div>
      </div>
    </div>
  );
}

export function AdvisorBars({ ranked }: { ranked: { id: string; label: string; score: number }[] }) {
  return (
    <div className="space-y-3.5">{ranked.map((r, i) => <div key={r.id}><div className="flex items-baseline justify-between text-sm"><span className="font-semibold text-ink">{r.label}</span><span className="font-mono text-xs text-ink-muted">{r.score}</span></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"><motion.div initial={{ width: 0 }} whileInView={{ width: `${r.score}%` }} viewport={{ once: true }} transition={{ duration: 1, delay: .15 + i * .12, ease: [.2, .8, .2, 1] }} className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" /></div></div>)}</div>
  );
}
