import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowRightLeft, BadgeCheck, Compass, Database, FileDiff, FileText, GitBranch, KeyRound, LockKeyhole, Network, ScanSearch, ShieldCheck, TableProperties } from "lucide-react";
import DemoButton from "@/components/demo-button";
import { AdvisorBars, EngineMarquee, Hero, LandingNav, TransformShowcase } from "@/components/landing-sections";
import { CountUp, Reveal, RevealGroup, RevealItem, Tilt } from "@/components/motion";
import { advise, DEFAULT_PROFILE } from "@/lib/advisor";
import { SPEC_ITEMS, TOP_10 } from "@/lib/roadmap";

export const metadata: Metadata = {
  title: "DB Architect — understand, transform and choose your database",
  description: "Introspect PostgreSQL, MySQL, SQLite and MongoDB, visualize every relationship, convert between engines with a live data preview, and get an explainable recommendation for which database fits your workload.",
};

const FEATURES = [
  { icon: Database, title: "Introspect anything you run", text: "Read-only live scans of PostgreSQL, MySQL and MongoDB, plus SQL dumps, YAML and JSON. Unsupported constructs are reported — never silently dropped." },
  { icon: Network, title: "Diagrams you can work in", text: "ELK-laid-out SVG with draggable nodes, collapse, filters, relationship highlighting, saved layouts and true SVG/PNG export." },
  { icon: ScanSearch, title: "Evidence-based analysis", text: "Deterministic rules with severity, confidence, evidence level and limitations. A heuristic is never presented as a measured fact." },
  { icon: ArrowRightLeft, title: "Cross-engine transformation", text: "Turn a SQL schema into documents (with embed-vs-reference reasoning) or documents into tables — with a live data preview and a ready ETL script." },
  { icon: Compass, title: "Which database fits?", text: "Describe the workload; get a transparent ranking of ten widely used engines, honest watch-outs and polyglot suggestions." },
  { icon: FileDiff, title: "Reviewable migrations", text: "Dialect-correct scripts with risk classification, online-DDL patterns, editable text, static validation and hashes. Nothing auto-executes." },
  { icon: FileText, title: "Docs your team will read", text: "HTML, Markdown and JSON reports with the diagram, inventory, findings and analysis limitations built in." },
  { icon: ShieldCheck, title: "Safe by construction", text: "Encrypted credentials, SSRF guard, workspace RBAC, audit log, masked previews and metadata-first analysis." },
];
const STEPS = [
  ["Connect or upload", "Point at a read-only database or drop in a dump. We detect the dialect and normalize it into one canonical model."],
  ["Understand", "Explore entities, relationships and an interactive diagram. See explicit constraints separated from inferred links."],
  ["Improve", "Review findings with evidence, compare versions, and generate migrations you can read before you run."],
  ["Move or decide", "Plan a move to another engine with mapping, preview and runbook — or ask the advisor which engine fits."],
];
const STATS: [number, string, string][] = [[4, "engines with import, analysis, diagrams & migrations", ""], [10, "engines scored by the advisor", ""], [21, "capabilities per engine", ""], [32, "golden tests on every transform direction", "+"]];

export default function Home() {
  const example = advise({ ...DEFAULT_PROFILE, dataShape: "time_series", consistency: "eventual", scale: "massive", writes: "write_heavy", queries: "aggregations", needs: ["time_series", "multi_region"] });
  const shipped = SPEC_ITEMS.filter((i) => i.status === "shipped").length;
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <LandingNav />
      <Hero />
      <EngineMarquee />

      {/* stats */}
      <section className="mx-auto max-w-7xl px-5 py-16">
        <RevealGroup className="grid grid-cols-2 gap-4 lg:grid-cols-4">{STATS.map(([n, l, s]) => <RevealItem key={l} className="surface card-hover p-6"><div className="text-4xl font-semibold tracking-tight text-ink"><CountUp to={n} suffix={s} /></div><div className="mt-2 text-sm leading-5 text-ink-muted">{l}</div></RevealItem>)}</RevealGroup>
      </section>

      {/* features */}
      <section id="features" className="mx-auto max-w-7xl px-5 py-16">
        <Reveal className="max-w-2xl"><div className="text-xs font-bold uppercase tracking-widest text-indigo-500">Everything in one place</div><h2 className="mt-3 text-4xl font-semibold tracking-tight">More than an ER-diagram generator.</h2><p className="mt-4 text-lg leading-8 text-ink-muted">The diagram is where it starts. The value is turning a database&apos;s real structure into decisions you can defend.</p></Reveal>
        <RevealGroup className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" delay={.07}>{FEATURES.map((f) => <RevealItem key={f.title} className="surface card-hover group p-6"><div className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-500/10 text-indigo-500 transition group-hover:scale-110 group-hover:bg-indigo-500 group-hover:text-white"><f.icon size={21} /></div><h3 className="mt-5 text-[15px] font-semibold">{f.title}</h3><p className="mt-2 text-sm leading-6 text-ink-muted">{f.text}</p></RevealItem>)}</RevealGroup>
      </section>

      {/* transform */}
      <section id="transform" className="relative overflow-hidden bg-[#0b1120] py-24 text-white">
        <div className="pointer-events-none absolute -left-32 top-0 h-[480px] w-[480px] rounded-full bg-indigo-600/15 blur-[120px]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-2">
          <Reveal>
            <div className="text-xs font-bold uppercase tracking-widest text-indigo-300">Transformation Studio</div>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight">See how your live data will change — before you move it.</h2>
            <p className="mt-4 text-lg leading-8 text-slate-400">Moving between SQL and documents is a modelling decision, not a type conversion. The studio explains each decision, flags lossy conversions, and shows real rows turning into target rows or documents.</p>
            <RevealGroup as="ul" className="mt-8 space-y-4" delay={.1}>{[["Embed vs. reference, with reasons", "Owned, bounded children are embedded; growth-prone or shared ones stay separate."], ["Junctions become arrays, arrays become tables", "Many-to-many links, nested objects and arrays are mapped in both directions."], ["Preview with synthetic or consented live data", "Masked, bounded, read-only, never stored — and audit-logged."], ["A runnable ETL script and runbook", "Idempotent batches, validation queries and orphan checks included."]].map(([t, d]) => <RevealItem as="li" key={t} className="flex gap-3"><BadgeCheck size={20} className="mt-0.5 shrink-0 text-emerald-400" /><div><div className="font-semibold">{t}</div><div className="mt-0.5 text-sm text-slate-400">{d}</div></div></RevealItem>)}</RevealGroup>
          </Reveal>
          <Reveal delay={.15}><Tilt max={5}><TransformShowcase /></Tilt></Reveal>
        </div>
      </section>

      {/* advisor */}
      <section id="advisor" className="mx-auto max-w-7xl px-5 py-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
          <Reveal>
            <div className="text-xs font-bold uppercase tracking-widest text-indigo-500">Database Advisor</div>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight">You are a database architect — not a Postgres architect.</h2>
            <p className="mt-4 text-lg leading-8 text-ink-muted">Tell us about the workload. The advisor scores ten widely used engines across 21 capabilities, explains every score, and suggests complementary stores instead of forcing one database to do everything.</p>
            <p className="mt-4 text-sm leading-6 text-ink-muted/80">Scores are a transparent heuristic over declared requirements — not a benchmark. Validate the shortlist with a prototype.</p>
            <div className="mt-8"><DemoButton className="group flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-bold text-canvas transition hover:opacity-90 disabled:opacity-60">Try the advisor <ArrowRight size={15} className="transition group-hover:translate-x-1" /></DemoButton></div>
          </Reveal>
          <Reveal delay={.15}><Tilt max={4} className="surface p-6 shadow-sm"><div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Example · massive write-heavy time-series, multi-region</div><div className="mt-5"><AdvisorBars ranked={example.ranked.slice(0, 5)} /></div><div className="surface-muted mt-6 rounded-xl p-4 text-xs leading-5 text-ink-muted">{example.summary}</div></Tilt></Reveal>
        </div>
      </section>

      {/* how it works */}
      <section className="border-y border-line bg-elevated/60 py-24">
        <div className="mx-auto max-w-7xl px-5"><Reveal><h2 className="text-center text-4xl font-semibold tracking-tight">From connection to decision in four steps</h2></Reveal>
          <RevealGroup className="relative mt-14 grid gap-6 md:grid-cols-4" delay={.12}>
            <div className="pointer-events-none absolute left-[12%] right-[12%] top-[2.6rem] hidden h-px bg-gradient-to-r from-transparent via-indigo-400/50 to-transparent md:block" />
            {STEPS.map(([t, d], i) => <RevealItem key={t} className="surface card-hover relative p-6"><div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 text-sm font-bold text-white shadow-lg shadow-indigo-600/30">{i + 1}</div><h3 className="mt-4 font-semibold">{t}</h3><p className="mt-2 text-sm leading-6 text-ink-muted">{d}</p></RevealItem>)}
          </RevealGroup>
        </div>
      </section>

      {/* security */}
      <section id="security" className="mx-auto max-w-7xl px-5 py-24">
        <Reveal className="max-w-2xl"><div className="text-xs font-bold uppercase tracking-widest text-indigo-500">Security &amp; trust</div><h2 className="mt-3 text-4xl font-semibold tracking-tight">Your database is sensitive. We designed for that first.</h2></Reveal>
        <RevealGroup className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[
          [LockKeyhole, "Read-only by default", "Analysis never writes to a source. Previews run inside read-only transactions."],
          [KeyRound, "Encrypted credentials", "AES-256-GCM at rest; no API ever returns a secret. Rotate and revoke any time."],
          [ShieldCheck, "SSRF & tenant isolation", "Metadata/private ranges blocked unless allowlisted; every request is workspace-scoped."],
          [TableProperties, "Metadata first", "We store schemas and shapes, not your rows. Live previews are masked and never persisted."],
        ].map(([Icon, t, d]) => { const I = Icon as typeof LockKeyhole; return <RevealItem key={String(t)} className="surface card-hover p-6"><I size={22} className="text-emerald-500" /><h3 className="mt-4 font-semibold">{String(t)}</h3><p className="mt-2 text-sm leading-6 text-ink-muted">{String(d)}</p></RevealItem>; })}</RevealGroup>
      </section>

      {/* roadmap */}
      <section id="roadmap" className="border-y border-line bg-elevated/60 py-24">
        <div className="mx-auto max-w-7xl px-5">
          <Reveal className="flex flex-wrap items-end justify-between gap-4"><div className="max-w-2xl"><div className="text-xs font-bold uppercase tracking-widest text-indigo-500">Roadmap</div><h2 className="mt-3 text-4xl font-semibold tracking-tight">Common engines first. Then the long tail.</h2><p className="mt-3 text-ink-muted">{shipped} of {SPEC_ITEMS.length} spec items shipped. We add databases in order of real-world usage and finish the top few before starting the next.</p></div><GitBranch className="hidden text-ink-muted/40 lg:block" size={40} /></Reveal>
          <RevealGroup className="mt-10 grid gap-3 md:grid-cols-2 lg:grid-cols-5" delay={.06}>{TOP_10.map((t) => <RevealItem key={t.rank} className="surface card-hover p-4"><div className="flex items-center justify-between"><span className="text-xs font-bold text-ink-muted/60">#{t.rank}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${t.status === "shipped" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : t.status === "next" ? "bg-amber-500/15 text-amber-600 dark:text-amber-300" : "bg-slate-500/15 text-ink-muted"}`}>{t.status === "shipped" ? "Shipped" : t.status === "next" ? "Next" : "Planned"}</span></div><div className="mt-2 text-[13px] font-semibold leading-5">{t.title}</div></RevealItem>)}</RevealGroup>
        </div>
      </section>

      {/* cta */}
      <section className="relative overflow-hidden bg-[#0b1120] py-28 text-center text-white">
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600/20 blur-[120px]" />
        <Reveal className="relative mx-auto max-w-3xl px-5"><h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">See your schema the way an architect does.</h2><p className="mt-4 text-lg text-slate-400">Open the demo workspace in one click — a pre-analyzed sample, no sign-up.</p>
          <div className="mt-9 flex flex-wrap justify-center gap-4"><DemoButton className="group flex items-center gap-2 rounded-xl bg-indigo-500 px-7 py-3.5 text-sm font-bold text-white shadow-xl shadow-indigo-500/25 transition hover:bg-indigo-400 disabled:opacity-60">Open the live demo <ArrowRight size={16} className="transition group-hover:translate-x-1" /></DemoButton><Link href="/app" className="rounded-xl border border-white/15 px-7 py-3.5 text-sm font-semibold text-slate-200 transition hover:bg-white/5">Create a workspace</Link></div></Reveal>
      </section>
      <footer className="border-t border-white/5 bg-[#0b1120] py-8 text-center text-xs text-slate-500">DB Architect · deterministic rules first, evidence over guesswork · nothing is ever executed against your database</footer>
    </div>
  );
}
