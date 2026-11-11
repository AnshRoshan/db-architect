"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion, useScroll, useSpring } from "framer-motion";
import { ArrowRight, Database, EyeOff, FolderTree, KeyRound, LockKeyhole, Menu, Sparkles, Workflow, X } from "lucide-react";
import DemoButton from "@/components/demo-button";
import ThemeToggle from "@/components/theme-toggle";
import HeroScene from "@/components/hero-scene";
import { EngineBadge, engineGlyph, engineTint } from "@/components/engine-icon";
import { Magnetic, Typewriter } from "@/components/motion";
import { ENGINE_LIST } from "@/lib/engines";
import { REPO_URL } from "@/lib/project";

const NAV = [["Features", "#features"], ["Architecture", "#architecture"], ["Transform", "#transform"], ["Advisor", "#advisor"], ["About", "#about"], ["Security", "#security"], ["Roadmap", "#roadmap"]];

export function LandingNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 24 });
  useEffect(() => { const f = () => setScrolled(window.scrollY > 24); f(); window.addEventListener("scroll", f, { passive: true }); return () => window.removeEventListener("scroll", f); }, []);
  return (
    <header className={`sticky top-0 z-40 border-b transition-all duration-300 ${scrolled ? "border-white/10 bg-[#070b14]/92 shadow-lg shadow-black/20 backdrop-blur-xl" : "border-transparent bg-transparent"}`}>
      <motion.div style={{ scaleX: progress }} className="absolute inset-x-0 top-0 h-[2px] origin-left bg-gradient-to-r from-indigo-400 via-violet-400 to-cyan-300" />
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-5">
        <Link href="/" className="flex items-center gap-2.5 text-white"><motion.span whileHover={{ rotate: 12, scale: 1.08 }} className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30"><Database size={17} /></motion.span><span className="whitespace-nowrap font-bold tracking-tight">DB Architect</span></Link>
        <nav className="ml-2 hidden gap-0.5 text-sm text-slate-400 lg:flex" aria-label="Sections">{NAV.map(([l, h]) => <a key={l} href={h} className="rounded-lg px-3 py-1.5 transition hover:bg-white/5 hover:text-white">{l}</a>)}</nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <span className="hidden sm:block"><ThemeToggle compact className="!border-white/15 !bg-white/5 !text-slate-300 hover:!text-white" /></span>
          <Link href="/app" className="hidden text-sm font-medium text-slate-300 transition hover:text-white sm:block">Sign in</Link>
          <a href={REPO_URL} target="_blank" rel="noreferrer" aria-label="DB Architect on GitHub" className="hidden text-sm font-medium text-slate-300 transition hover:text-white sm:block">GitHub</a>
          <Magnetic><DemoButton className="flex items-center gap-2 whitespace-nowrap rounded-lg bg-indigo-500 px-3.5 py-2 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400 disabled:opacity-60">Try the demo</DemoButton></Magnetic>
          <button onClick={() => setOpen((v) => !v)} className="rounded-lg p-2 text-slate-300 lg:hidden" aria-label="Menu" aria-expanded={open}>{open ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </div>
      <AnimatePresence>{open && <motion.nav initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-white/10 bg-[#070b14] lg:hidden"><div className="flex flex-col p-3">{NAV.map(([l, h]) => <a key={l} href={h} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-sm text-slate-300 hover:bg-white/5">{l}</a>)}<Link href="/app" className="rounded-lg px-3 py-2.5 text-sm text-slate-300">Sign in</Link></div></motion.nav>}</AnimatePresence>
    </header>
  );
}

const rise = { hidden: { opacity: 0, y: 28 }, show: { opacity: 1, y: 0, transition: { duration: .7, ease: [.2, .8, .2, 1] as [number, number, number, number] } } };

export function Hero() {
  const reduce = useReducedMotion();
  return (
    <section className="relative -mt-16 overflow-hidden bg-[#070b14] pt-16 text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="aurora absolute -top-40 left-[8%] h-[640px] w-[640px] rounded-full bg-indigo-600/25 blur-[110px]" />
        <div className="aurora-2 absolute -bottom-52 right-[-10%] h-[560px] w-[560px] rounded-full bg-violet-600/20 blur-[120px]" />
        <div className="absolute left-1/2 top-1/3 h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="grid-lines absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_25%,transparent_75%)]" />
      </div>
      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-5 pb-24 pt-14 lg:grid-cols-[1.02fr_1fr] lg:pb-32 lg:pt-20">
        <div className="min-w-0">
          <motion.a href="#architecture" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5 }} className="group inline-flex max-w-full items-center gap-2 rounded-full border border-indigo-400/25 bg-indigo-400/10 py-1 pl-1 pr-3 text-xs font-medium text-indigo-100 transition hover:border-indigo-300/50">
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"><Sparkles size={10} />New</span>
            <span className="min-w-0 truncate">Multi-schema databases &amp; polyglot system maps</span><ArrowRight size={12} className="shrink-0 transition group-hover:translate-x-0.5" />
          </motion.a>
          <motion.h1 initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: .12, delayChildren: .15 } } }} className="mt-6 text-[2.35rem] font-semibold leading-[1.06] tracking-tight sm:text-6xl lg:whitespace-nowrap lg:text-[3.45rem] xl:text-[3.7rem]">
            <motion.span variants={rise} className="block">Every schema.</motion.span>
            <motion.span variants={rise} className="block">Every database.</motion.span>
            <motion.span variants={rise} className="text-gradient block pb-1">One architecture.</motion.span>
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .55, duration: .6 }} className="mt-6 max-w-xl text-lg leading-8 text-slate-400">
            DB Architect reads the databases you actually run — a PostgreSQL with ten schemas, a second service database, a Redis in front — and turns them into diagrams, evidence-backed findings, reviewable migrations and a map of how it all fits together.
          </motion.p>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .75 }} className="mt-4 flex min-h-7 items-start gap-2 font-mono text-xs text-indigo-200/90 sm:items-center sm:text-sm">
            <span className="text-slate-600">$</span>
            {reduce ? <span>scan commerce_core --schemas &quot;*&quot; → 8 schemas, 9 cross-schema FKs</span> : <Typewriter phrases={["scan commerce_core --schemas \"*\" → 8 schemas, 20 tables", "auth ⇄ billing: circular schema dependency", "session:{session_id} → auth.users · TTL 30m", "products is stored in PostgreSQL and MongoDB", "Postgres → MongoDB: embed order_items into orders"]} />}
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .85, duration: .6 }} className="mt-8 flex flex-wrap items-center gap-4">
            <Magnetic><DemoButton className="group flex items-center gap-2 rounded-xl bg-indigo-500 px-6 py-3.5 text-sm font-bold text-white shadow-xl shadow-indigo-500/25 transition hover:bg-indigo-400 disabled:opacity-60">Open the live demo <ArrowRight size={16} className="transition group-hover:translate-x-1" /></DemoButton></Magnetic>
            <Link href="/app" className="rounded-xl border border-white/15 px-6 py-3.5 text-sm font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/5">Create a workspace</Link>
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.05 }} className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
            {([[LockKeyhole, "Read-only by default"], [KeyRound, "AES-256-GCM credentials"], [EyeOff, "Never stores your rows"]] as const).map(([Icon, t]) => <span key={t} className="flex items-center gap-1.5"><Icon size={14} className="text-emerald-400" />{t}</span>)}
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="mt-8 flex items-center gap-3 border-t border-white/10 pt-6">
            <span className="text-[11px] font-semibold uppercase tracking-[.16em] text-slate-500">Reads</span>
            <div className="flex gap-2">{ENGINE_LIST.map((e, i) => <motion.span key={e.id} initial={{ opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.25 + i * .07, type: "spring", stiffness: 300, damping: 18 }} title={e.label}><EngineBadge engine={e.id} size={34} /></motion.span>)}</div>
            <span className="hidden text-xs text-slate-500 sm:inline">PostgreSQL · MySQL · SQLite · MongoDB · Redis</span>
          </motion.div>
        </div>
        <HeroScene />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-canvas" />
    </section>
  );
}

const TAG_STYLE: Record<string, string> = {
  live: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  import: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  next: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  advisor: "bg-slate-500/15 text-ink-muted",
};

export function EngineMarquee() {
  const extra: [string, string][] = [["SQL Server", "next"], ["DynamoDB", "advisor"], ["ClickHouse", "advisor"], ["Elasticsearch", "advisor"], ["Cassandra", "advisor"]];
  const items: [string, string][] = [...ENGINE_LIST.map((e) => [e.label, e.live ? "live" : "import"] as [string, string]), ...extra];
  const row = [...items, ...items];
  return (
    <section id="engines" className="relative border-y border-line bg-elevated/60 py-7">
      <div className="mx-auto mb-4 max-w-7xl px-5 text-center text-[11px] font-bold uppercase tracking-[.2em] text-ink-muted">Engines · built in order of real-world usage</div>
      <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
        <div className="marquee flex w-max gap-3 px-3">{row.map(([label, tag], i) => <span key={i} className="flex items-center gap-2.5 rounded-full border border-line bg-elevated py-1.5 pl-1.5 pr-4 text-sm font-semibold text-ink"><EngineBadge engine={label} size={28} className="!rounded-full" />{label}<span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${TAG_STYLE[tag]}`}>{tag}</span></span>)}</div>
      </div>
    </section>
  );
}

// ── Architecture showcase: real analyzer output, computed on the server from the sample system ──
export interface ShowcaseFinding { ruleId: string; severity: string; title: string; object: string }
export interface ShowcaseData {
  schemas: { namespaces: { name: string; entities: number }[]; edges: { from: string; to: string; count: number }[]; cycles: [string, string][]; tables: number; crossFks: number };
  schemaFindings: ShowcaseFinding[];
  stores: { id: string; name: string; engine: string; role: string; entities: number; namespaces: number }[];
  pairs: { a: string; b: string; count: number }[];
  flows: { from: string; to: string; label: string }[];
  systemFindings: ShowcaseFinding[];
  score: number;
  links: number;
}
const SEV_DOT: Record<string, string> = { critical: "bg-red-500", high: "bg-orange-500", medium: "bg-amber-400", low: "bg-sky-400", info: "bg-slate-400" };

function SchemaWheel({ data }: { data: ShowcaseData["schemas"] }) {
  const nodes = data.namespaces;
  const max = Math.max(1, ...nodes.map((n) => n.entities));
  const cx = 210, cy = 172, R = 112;
  const at = new Map(nodes.map((n, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / nodes.length; return [n.name, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), a, r: 10 + 11 * Math.sqrt(n.entities / max) }]; }));
  const cyc = new Set(data.cycles.flatMap(([a, b]) => [`${a}>${b}`, `${b}>${a}`]));
  return (
    <svg viewBox="0 0 420 344" className="w-full" role="img" aria-label="Schema dependency map of the sample PostgreSQL database">
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(148,163,184,.14)" strokeDasharray="3 6" />
      {data.edges.map((e, i) => {
        const a = at.get(e.from), b = at.get(e.to);
        if (!a || !b) return null;
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const x1 = a.x + (dx / len) * a.r, y1 = a.y + (dy / len) * a.r, x2 = b.x - (dx / len) * (b.r + 2), y2 = b.y - (dy / len) * (b.r + 2);
        const qx = (x1 + x2) / 2 + (cx - (x1 + x2) / 2) * 0.4 - (dy / len) * 9, qy = (y1 + y2) / 2 + (cy - (y1 + y2) / 2) * 0.4 + (dx / len) * 9;
        const red = cyc.has(`${e.from}>${e.to}`);
        const d = `M ${x1} ${y1} Q ${qx} ${qy} ${x2} ${y2}`;
        return <g key={`${e.from}>${e.to}`}>
          <motion.path d={d} fill="none" stroke={red ? "#f87171" : "#818cf8"} strokeWidth={Math.min(1.2 + e.count * 0.6, 4)} strokeOpacity=".8" strokeLinecap="round" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: .9, delay: .2 + i * .06 }} />
          <circle r="2.6" fill={red ? "#fca5a5" : "#c7d2fe"}><animateMotion dur={`${2.4 + (i % 3) * 0.5}s`} repeatCount="indefinite" path={d} /></circle>
        </g>;
      })}
      {nodes.map((n, i) => {
        const p = at.get(n.name)!;
        const right = Math.cos(p.a) > 0.25, left = Math.cos(p.a) < -0.25;
        const inCycle = data.cycles.some((c) => c.includes(n.name));
        return <motion.g key={n.name} initial={{ opacity: 0, scale: .4 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: i * .06, type: "spring", stiffness: 260, damping: 18 }} style={{ transformOrigin: `${p.x}px ${p.y}px` }}>
          {inCycle && <circle cx={p.x} cy={p.y} r={p.r} fill="none" stroke="#f87171" strokeWidth="1.5" className="pulse-ring" />}
          <circle cx={p.x} cy={p.y} r={p.r} fill={`hsl(${(i * 47 + 232) % 360} 80% 64%)`} stroke="#0b1120" strokeWidth="2.5" />
          <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="10" fontWeight="800" fill="#0b1120">{n.entities}</text>
          <text x={p.x + (right ? p.r + 7 : left ? -p.r - 7 : 0)} y={p.y + (right || left ? 4 : Math.sin(p.a) > 0 ? p.r + 15 : -p.r - 8)} textAnchor={right ? "start" : left ? "end" : "middle"} fontSize="11.5" fontWeight="700" fontFamily="ui-monospace,monospace" fill="#e2e8f0">{n.name}</text>
        </motion.g>;
      })}
    </svg>
  );
}

const STORE_BOX: Record<string, { x: number; y: number; w: number; h: number }> = { cache: { x: 24, y: 36, w: 168, h: 76 }, content: { x: 228, y: 36, w: 168, h: 76 }, core: { x: 96, y: 232, w: 228, h: 84 } };

function SystemMap({ data }: { data: ShowcaseData }) {
  const box = (id: string) => STORE_BOX[id];
  const anchor = (from: string, to: string, shift: number) => {
    const a = box(from), b = box(to);
    const down = a.y < b.y;
    const x1 = a.x + a.w / 2 + shift, y1 = down ? a.y + a.h : a.y, x2 = b.x + b.w / 2 + shift * (down ? -0.4 : -0.4), y2 = down ? b.y : b.y + b.h;
    const my = (y1 + y2) / 2;
    return { d: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`, mx: (x1 + x2) / 2, my };
  };
  return (
    <svg viewBox="0 0 420 344" className="w-full" role="img" aria-label="Topology of the sample system: PostgreSQL, MongoDB and Redis">
      {data.pairs.filter((p) => box(p.a) && box(p.b)).map((p, i) => {
        const hasFlow = data.flows.some((f) => (f.from === p.a && f.to === p.b) || (f.from === p.b && f.to === p.a));
        const e = anchor(p.a, p.b, hasFlow ? 26 : 0);
        return <g key={`${p.a}|${p.b}`}>
          <motion.path d={e.d} fill="none" stroke="#a78bfa" strokeWidth="2" strokeDasharray="6 5" strokeLinecap="round" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: .3 + i * .15 }} />
          <circle r="3" fill="#ddd6fe"><animateMotion dur="2.6s" repeatCount="indefinite" path={e.d} /></circle>
          <rect x={e.mx - 30} y={e.my - 10} width="60" height="20" rx="10" fill="#1e1b4b" stroke="#a78bfa" /><text x={e.mx} y={e.my + 3.5} textAnchor="middle" fontSize="10" fontWeight="700" fill="#ddd6fe">{p.count} links</text>
        </g>;
      })}
      {data.flows.filter((f) => box(f.from) && box(f.to)).map((f) => {
        const e = anchor(f.from, f.to, -26);
        const w = f.label.length * 6.2 + 18;
        return <g key={`${f.from}>${f.to}`}>
          <path d={e.d} fill="none" stroke="#6366f1" strokeWidth="2.2" strokeLinecap="round" className="edge-flow" />
          <circle r="3.4" fill="#a5b4fc"><animateMotion dur="2.2s" repeatCount="indefinite" path={e.d} /></circle>
          <rect x={e.mx - w / 2} y={e.my - 10} width={w} height="20" rx="10" fill="#6366f1" /><text x={e.mx} y={e.my + 3.5} textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">{f.label}</text>
        </g>;
      })}
      {data.stores.filter((s) => box(s.id)).map((s, i) => {
        const b = box(s.id);
        const Icon = engineGlyph(s.engine);
        const color = engineTint(s.engine);
        return <motion.g key={s.id} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * .1, type: "spring", stiffness: 240, damping: 22 }}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="14" fill="#0f172a" stroke="rgba(255,255,255,.14)" />
          <rect x={b.x + 12} y={b.y + 14} width="34" height="34" rx="10" fill={color} fillOpacity=".2" stroke={color} strokeOpacity=".4" />
          <Icon x={b.x + 20} y={b.y + 22} width={18} height={18} color={color} />
          <text x={b.x + 56} y={b.y + 29} fontSize="12" fontWeight="700" fill="#f1f5f9">{s.name}</text>
          <text x={b.x + 56} y={b.y + 44} fontSize="9.5" fill="#94a3b8">{s.role === "primary" ? "System of record" : s.role === "cache" ? "Cache" : "Service database"}</text>
          <text x={b.x + 12} y={b.y + b.h - 11} fontSize="9.5" fill="#94a3b8">{s.namespaces > 1 ? `${s.namespaces} schemas · ` : ""}{s.entities} {s.engine === "redis" ? "key patterns" : s.engine === "mongodb" ? "collections" : "tables"}</text>
        </motion.g>;
      })}
    </svg>
  );
}

export function ArchitectureShowcase({ data }: { data: ShowcaseData }) {
  const [tab, setTab] = useState<"schemas" | "system">("schemas");
  const tabs = [{ id: "schemas" as const, label: "One database, many schemas", icon: FolderTree }, { id: "system" as const, label: "Many databases, one system", icon: Workflow }];
  const findings = tab === "schemas" ? data.schemaFindings : data.systemFindings;
  const facts = tab === "schemas"
    ? [[String(data.schemas.namespaces.length), "schemas scanned"], [String(data.schemas.tables), "tables"], [String(data.schemas.crossFks), "cross-schema FKs"], [String(data.schemas.cycles.length), "schema cycle"]]
    : [[String(data.stores.length), "datastores"], [String(new Set(data.stores.map((s) => s.engine)).size), "engines"], [String(data.links), "inferred links"], [String(data.score), "architecture score"]];
  return (
    <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
      <div className="gradient-border relative rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-2xl shadow-black/40 backdrop-blur">
        <div className="flex flex-wrap gap-1 rounded-xl bg-white/5 p-1" role="tablist" aria-label="Architecture examples">
          {tabs.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`relative flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${tab === t.id ? "text-white" : "text-slate-400 hover:text-slate-200"}`}>{tab === t.id && <motion.span layoutId="arch-showcase-tab" className="absolute inset-0 rounded-lg bg-indigo-500/80" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}<t.icon size={14} className="relative" /><span className="relative">{t.label}</span></button>)}
        </div>
        <div className="grid-lines mt-3 overflow-hidden rounded-xl bg-[#0b1120]">
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.02 }} transition={{ duration: .3 }}>{tab === "schemas" ? <SchemaWheel data={data.schemas} /> : <SystemMap data={data} />}</motion.div>
          </AnimatePresence>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">{facts.map(([v, l]) => <div key={l} className="rounded-lg bg-white/[.04] px-2 py-2 text-center"><div className="text-lg font-bold tabular-nums text-white">{v}</div><div className="text-[10px] leading-3 text-slate-500">{l}</div></div>)}</div>
      </div>
      <div>
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: .3 }}>
            <h3 className="text-2xl font-semibold tracking-tight text-white">{tab === "schemas" ? "Scan all ten schemas — and see how they lean on each other." : "Add the second database and the Redis. Then look across them."}</h3>
            <p className="mt-3 leading-7 text-slate-400">{tab === "schemas" ? "Discover every schema on the server, pick them by name, glob or exclusion, and keep foreign keys that cross schema boundaries. The schema map shows which ones are a shared kernel and which form a cycle that can never be split apart." : "Give each store a role — system of record, service database, cache, replica — and declare how data moves between them. DB Architect infers references that no foreign key can enforce, finds entities stored twice, and checks that ephemeral stores actually expire."}</p>
            <div className="mt-6 space-y-2.5">
              <div className="text-[11px] font-bold uppercase tracking-[.16em] text-slate-500">Found in the sample system</div>
              {findings.map((f, i) => <motion.div key={f.ruleId + f.object} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .1 + i * .08 }} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[.03] p-3.5"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEV_DOT[f.severity] ?? "bg-slate-400"}`} /><div className="min-w-0"><div className="text-sm font-semibold text-white">{f.title}</div><div className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{f.ruleId} · {f.object}</div></div><span className="ml-auto shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold capitalize text-slate-300">{f.severity}</span></motion.div>)}
            </div>
          </motion.div>
        </AnimatePresence>
        <div className="mt-7"><DemoButton className="group flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-indigo-50 disabled:opacity-60">Explore this system in the demo <ArrowRight size={15} className="transition group-hover:translate-x-1" /></DemoButton></div>
      </div>
    </div>
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
        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500"><EngineBadge engine="mysql" size={20} className="!rounded-md" />MySQL rows</div>
        <div className="text-sky-300">orders</div>
        <div className="text-slate-500">id | customer_id | status</div>
        {ROWS.map((r, i) => <motion.div key={r[0]} animate={{ backgroundColor: i === idx ? "rgba(99,102,241,.22)" : "rgba(0,0,0,0)", x: i === idx ? 4 : 0 }} transition={{ duration: .35 }} className="-mx-1 rounded px-1">{r.join(" | ")}</motion.div>)}
        <div className="mt-3 text-sky-300">order_items</div>
        <div className="text-slate-500">order_id | sku | qty</div>
        {ITEMS.map((r, i) => <motion.div key={i} animate={{ backgroundColor: r[0] === order[0] ? "rgba(139,92,246,.22)" : "rgba(0,0,0,0)", x: r[0] === order[0] ? 4 : 0 }} transition={{ duration: .35 }} className="-mx-1 rounded px-1">{r.join(" | ")}</motion.div>)}
      </div>
      <div className="flex items-center justify-center">
        <motion.div animate={reduce ? {} : { x: [0, 6, 0] }} transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }} className="rotate-90 rounded-full border border-indigo-400/30 bg-indigo-500/10 p-2 text-indigo-300 sm:rotate-0"><ArrowRight size={18} /></motion.div>
      </div>
      <div className="rounded-xl border border-indigo-400/30 bg-slate-900 p-4 font-mono text-[11px] leading-5 text-slate-300">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-indigo-300"><EngineBadge engine="mongodb" size={20} className="!rounded-md" />MongoDB document</div>
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
    <div className="space-y-3.5">{ranked.map((r, i) => <div key={r.id}><div className="flex items-center justify-between text-sm"><span className="flex items-center gap-2 font-semibold text-ink"><EngineBadge engine={r.label} size={22} className="!rounded-md" />{r.label}</span><span className="font-mono text-xs text-ink-muted">{r.score}</span></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"><motion.div initial={{ width: 0 }} whileInView={{ width: `${r.score}%` }} viewport={{ once: true }} transition={{ duration: 1, delay: .15 + i * .12, ease: [.2, .8, .2, 1] }} className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" /></div></div>)}</div>
  );
}
