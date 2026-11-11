import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ArrowRightLeft, BadgeCheck, Boxes, Cable, Check, Compass, Database, EyeOff, ExternalLink, FileDiff, FileText, FolderTree, Gauge, GitBranch, KeyRound, Layers, ListChecks, LockKeyhole, Network, Rocket, ScanSearch, ShieldCheck, TableProperties, Timer, Workflow, type LucideIcon } from "lucide-react";
import DemoButton from "@/components/demo-button";
import { EngineBadge } from "@/components/engine-icon";
import { AdvisorBars, ArchitectureShowcase, EngineMarquee, Hero, LandingNav, TransformShowcase, type ShowcaseData } from "@/components/landing-sections";
import { CountUp, Reveal, RevealGroup, RevealItem, Spotlight, Tilt, WordReveal } from "@/components/motion";
import { advise, DEFAULT_PROFILE } from "@/lib/advisor";
import { analyzeModel } from "@/lib/analysis";
import { analyzeArchitecture, FLOW_KINDS } from "@/lib/architecture";
import { parseMongoJson, parseSqlDdl } from "@/lib/dsl";
import { ENGINE_LIST } from "@/lib/engines";
import { FIXTURE_COMMERCE_MONGO_JSON, FIXTURE_MULTISCHEMA_SQL, FIXTURE_REDIS_JSON } from "@/lib/fixtures-polyglot";
import { parseRedisDump } from "@/lib/redis-model";
import { REPO_URL } from "@/lib/project";
import { SPEC_ITEMS, TOP_10 } from "@/lib/roadmap";

export const metadata: Metadata = {
  title: "DB Architect — every schema, every database, one architecture",
  description: "Introspect PostgreSQL (all schemas), MySQL, SQLite, MongoDB and Redis; map how your datastores depend on each other; get evidence-backed findings, reviewable migrations, cross-engine transformation plans and an explainable database recommendation.",
};

/** The showcase renders what the analyzers really produce for the sample system — nothing is mocked. */
function buildShowcase(): { showcase: ShowcaseData; severities: Record<string, number>; keyspaces: { pattern: string; type: string; ttl: string; ok: boolean }[] } {
  const core = parseSqlDdl(FIXTURE_MULTISCHEMA_SQL, "commerce_core", "postgres").model;
  const content = parseMongoJson(FIXTURE_COMMERCE_MONGO_JSON, "commerce_content").model;
  const cache = parseRedisDump(FIXTURE_REDIS_JSON, "commerce_cache").model;
  const flows = [{ id: "f1", fromStoreId: "core", toStoreId: "cache", kind: "cache_aside" }];
  const report = analyzeArchitecture([
    { id: "core", name: "commerce-core", engine: "postgres", role: "primary", model: core },
    { id: "content", name: "commerce-content", engine: "mongodb", role: "service", model: content },
    { id: "cache", name: "commerce-cache", engine: "redis", role: "cache", model: cache },
  ], flows);
  const coreSummary = report.stores.find((s) => s.id === "core")!;
  const analysis = analyzeModel(core);
  const pairs = new Map<string, { a: string; b: string; count: number }>();
  for (const l of report.links) {
    const key = [l.fromStoreId, l.toStoreId].sort().join("|");
    const cur = pairs.get(key) ?? { a: l.fromStoreId, b: l.toStoreId, count: 0 };
    cur.count++;
    pairs.set(key, cur);
  }
  const pick = (f: { ruleId: string; severity: string; title: string; object: string }) => ({ ruleId: f.ruleId, severity: f.severity, title: f.title, object: f.object });
  const fmt = (sec: number) => (sec >= 3600 ? `${Math.round(sec / 3600)}h` : sec >= 60 ? `${Math.round(sec / 60)}m` : `${sec}s`);
  const keyspaces = cache.entities.filter((e) => ["session:{session_id}", "cache:product:{product_id}", "otp:{otp_id}", "queue:emails"].includes(e.shortName)).map((e) => {
    const meta = e.metadata as { redisType?: string; ttl?: { known?: number; with?: number; avg?: number }; size?: { max: number } | null };
    const expires = (meta.ttl?.with ?? 0) > 0;
    return { pattern: e.shortName, type: meta.redisType ?? "?", ttl: expires ? `TTL ${fmt(meta.ttl?.avg ?? 0)}` : meta.size && meta.size.max > 1000 ? `${meta.size.max.toLocaleString("en-US")} items · no TTL` : "no TTL", ok: expires };
  });
  return {
    severities: analysis.summary.findingsBySeverity,
    keyspaces,
    showcase: {
      schemas: {
        namespaces: coreSummary.namespaces.filter((n) => !n.external).map((n) => ({ name: n.name, entities: n.entities })),
        edges: coreSummary.edges.map((e) => ({ from: e.from, to: e.to, count: e.count })),
        cycles: coreSummary.cycles,
        tables: core.entities.length,
        crossFks: coreSummary.edges.reduce((a, e) => a + e.count, 0),
      },
      schemaFindings: [...analysis.findings.filter((f) => /-SCHEMA-/.test(f.ruleId)), ...analysis.findings.filter((f) => !/-SCHEMA-/.test(f.ruleId) && f.severity === "high")].slice(0, 3).map(pick),
      stores: report.stores.map((s) => ({ id: s.id, name: s.name, engine: s.engine, role: s.role, entities: s.entities, namespaces: s.namespaces.filter((n) => !n.external).length })),
      pairs: [...pairs.values()],
      flows: flows.map((f) => ({ from: f.fromStoreId, to: f.toStoreId, label: (FLOW_KINDS.find((k) => k.id === f.kind)?.label ?? f.kind).toLowerCase() })),
      systemFindings: report.findings.filter((f) => f.severity === "high" || f.severity === "medium").slice(0, 3).map(pick),
      score: report.score,
      links: report.links.length,
    },
  };
}

const STEPS: [LucideIcon, string, string][] = [
  [Cable, "Connect or upload", "Point at a read-only database or drop in a dump. Pick the schemas; we detect the dialect and normalize everything into one canonical model."],
  [FolderTree, "Understand", "Explore schemas, entities and an interactive diagram. Enforced constraints are kept apart from inferred links."],
  [Workflow, "See the system", "Add your other databases and caches, give each a role, and review what crosses between them."],
  [Compass, "Improve or move", "Triage findings with evidence, generate migrations you can read, or plan a move to another engine."],
];
const SECURITY: [LucideIcon, string, string][] = [
  [LockKeyhole, "Read-only by default", "Analysis never writes to a source. Previews run inside read-only transactions; Redis is sampled with SCAN, never KEYS."],
  [KeyRound, "Encrypted credentials", "AES-256-GCM at rest; no API ever returns a secret. Rotate and revoke any time."],
  [ShieldCheck, "SSRF & tenant isolation", "Metadata and private ranges are blocked unless allowlisted; every request is workspace-scoped."],
  [EyeOff, "Metadata first", "We store schemas, shapes and key patterns — not your rows or values. Live previews are masked and never persisted."],
];
const PRINCIPLES: [LucideIcon, string, string][] = [
  [ShieldCheck, "Deterministic rules first", "Findings are derived from the schema, statistics, workload, samples or a named heuristic. The assistant explains a finding — it never invents one."],
  [ListChecks, "Evidence on every claim", "Each finding carries an evidence level, a confidence score and its limitations. A heuristic is never presented as a measured fact."],
  [LockKeyhole, "Read-only by default", "Nothing is executed against your database. Migrations and ETL scripts are generated for you to review and run yourself."],
  [EyeOff, "Metadata first", "Schemas, shapes and key patterns are stored — rows are not. Live previews are masked, bounded and never persisted."],
  [Network, "Engine-neutral core", "One canonical model, with engine specifics isolated in adapters, dialect generators and rule sets."],
  [FolderTree, "Finish the top few first", "Engines are added in order of real-world usage, and each is complete before the next one starts."],
];
const STATUS_STYLE: Record<string, string> = { shipped: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300", next: "bg-amber-500/15 text-amber-600 dark:text-amber-300", planned: "bg-slate-500/15 text-ink-muted", in_progress: "bg-sky-500/15 text-sky-600 dark:text-sky-300" };

function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <div className={`inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] ${dark ? "text-indigo-300" : "text-indigo-500"}`}><span className="h-px w-6 bg-current opacity-60" />{children}</div>;
}

function Bento({ icon: Icon, title, text, className = "", children }: { icon: LucideIcon; title: string; text: string; className?: string; children?: ReactNode }) {
  return (
    <RevealItem className={className}>
      <Spotlight className="surface card-hover group flex h-full flex-col overflow-hidden p-6">
        <div className="icon-tile h-11 w-11"><Icon size={20} /></div>
        <h3 className="mt-5 text-base font-semibold text-ink">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-ink-muted">{text}</p>
        {children && <div className="mt-auto pt-5">{children}</div>}
      </Spotlight>
    </RevealItem>
  );
}

export default function Home() {
  const example = advise({ ...DEFAULT_PROFILE, dataShape: "time_series", consistency: "eventual", scale: "massive", writes: "write_heavy", queries: "aggregations", needs: ["time_series", "multi_region"] });
  const shipped = SPEC_ITEMS.filter((i) => i.status === "shipped").length;
  const { showcase, severities, keyspaces } = buildShowcase();
  const sevTotal = Math.max(1, Object.values(severities).reduce((a, b) => a + b, 0));
  const stats: [number, string, string, LucideIcon][] = [
    [ENGINE_LIST.length, "", "engines with import, analysis and diagrams", Database],
    [showcase.schemas.namespaces.length, "", "schemas in the demo database — all scanned", FolderTree],
    [10, "", "engines scored by the advisor, on 21 capabilities", Gauge],
    [65, "+", "automated tests on parsers, rules and transforms", BadgeCheck],
  ];

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <LandingNav />
      <Hero />
      <EngineMarquee />

      {/* stats */}
      <section className="mx-auto max-w-7xl px-5 py-16">
        <RevealGroup className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.map(([n, suffix, label, Icon]) => (
            <RevealItem key={label}><Spotlight className="surface card-hover group h-full p-6"><div className="flex items-start justify-between"><div className="text-4xl font-semibold tracking-tight text-ink"><CountUp to={n} suffix={suffix} /></div><div className="icon-tile h-9 w-9"><Icon size={17} /></div></div><div className="mt-2 text-sm leading-5 text-ink-muted">{label}</div></Spotlight></RevealItem>
          ))}
        </RevealGroup>
      </section>

      {/* features */}
      <section id="features" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-16">
        <Reveal className="max-w-2xl"><Eyebrow>Everything in one place</Eyebrow><h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-[2.6rem]"><WordReveal text="More than an ER-diagram generator." /></h2><p className="mt-4 text-lg leading-8 text-ink-muted">The diagram is where it starts. The value is turning the real structure of your databases — all of them — into decisions you can defend.</p></Reveal>
        <RevealGroup className="mt-12 grid gap-4 md:grid-cols-6" delay={.06}>
          <Bento className="md:col-span-4" icon={FolderTree} title="Every schema, not just public" text="Discover every schema on the server, choose by name, glob or exclusion, and keep the foreign keys that cross between them. Views, materialized views and partitioned tables keep their identity.">
            <div className="flex flex-wrap gap-1.5">{showcase.schemas.namespaces.map((n) => <span key={n.name} className="flex items-center gap-1.5 rounded-lg border border-line bg-muted px-2 py-1 font-mono text-[11px] text-ink"><span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />{n.name}<span className="text-ink-muted">{n.entities}</span></span>)}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">{showcase.schemas.edges.slice(0, 7).map((e) => <span key={`${e.from}>${e.to}`} className="flex items-center gap-1 rounded-lg bg-indigo-500/10 px-2 py-1 font-mono text-[11px] text-ink-muted ring-1 ring-inset ring-indigo-500/20">{e.from}<ArrowRight size={10} className="text-indigo-500" />{e.to}<b className="font-sans text-ink">×{e.count}</b></span>)}</div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted"><span><b className="text-ink">{showcase.schemas.crossFks}</b> cross-schema foreign keys kept</span><span><b className="text-ink">{showcase.schemas.cycles.length}</b> circular dependency found</span></div>
          </Bento>
          <Bento className="md:col-span-2" icon={Network} title="Diagrams you can work in" text="ELK-laid-out SVG with draggable nodes, schema colours and filters, relationship highlighting, saved layouts and true SVG/PNG export.">
            <svg viewBox="0 0 220 70" className="w-full" aria-hidden><path d="M62 22 C 90 22, 80 48, 108 48" fill="none" stroke="#6366f1" strokeWidth="1.6" className="edge-flow" /><path d="M158 48 C 176 48, 168 22, 186 22" fill="none" stroke="#a78bfa" strokeWidth="1.6" strokeDasharray="4 3" />{[[6, 8, "users"], [108, 34, "orders"], [150, 8, "items"]].map(([x, y, l]) => <g key={String(l)}><rect x={Number(x)} y={Number(y)} width="56" height="28" rx="7" className="fill-[var(--bg-muted)] stroke-[var(--border)]" /><rect x={Number(x)} y={Number(y)} width="56" height="9" rx="4" fill="#6366f1" fillOpacity=".25" /><text x={Number(x) + 6} y={Number(y) + 21} fontSize="8" fontFamily="ui-monospace,monospace" className="fill-[var(--fg)]">{l}</text></g>)}</svg>
          </Bento>
          <Bento className="md:col-span-2" icon={ScanSearch} title="Evidence-based analysis" text="Deterministic rules with severity, confidence, evidence level and limitations. A heuristic is never presented as a measured fact.">
            <div className="space-y-1.5">{(["high", "medium", "low", "info"] as const).map((k) => <div key={k} className="flex items-center gap-2 text-[11px]"><span className="w-14 capitalize text-ink-muted">{k}</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${k === "high" ? "bg-orange-500" : k === "medium" ? "bg-amber-500" : k === "low" ? "bg-sky-500" : "bg-slate-400"}`} style={{ width: `${Math.max(4, ((severities[k] ?? 0) / sevTotal) * 100)}%` }} /></div><span className="w-4 text-right tabular-nums text-ink">{severities[k] ?? 0}</span></div>)}</div>
          </Bento>
          <Bento className="md:col-span-4" icon={Workflow} title="The whole system, not one database" text="Two databases and a Redis are one architecture. Give each store a role, declare how data flows, and get findings no single-database tool can see: entities stored twice, references nothing enforces, caches that never expire.">
            <div className="flex flex-wrap items-center gap-2">{showcase.stores.map((s, i) => <div key={s.id} className="flex items-center gap-2">{i > 0 && <span className="hidden h-px w-6 border-t-2 border-dashed border-indigo-400/50 sm:block" />}<span className="flex items-center gap-2 rounded-xl border border-line bg-muted py-1.5 pl-1.5 pr-3"><EngineBadge engine={s.engine} size={28} /><span><span className="block text-xs font-semibold text-ink">{s.name}</span><span className="block text-[10px] text-ink-muted">{s.namespaces > 1 ? `${s.namespaces} schemas · ` : ""}{s.entities} entities</span></span></span></div>)}</div>
            <div className="mt-3 text-xs text-ink-muted"><b className="text-ink">{showcase.links}</b> cross-store links inferred · architecture score <b className="text-ink">{showcase.score}</b>/100</div>
          </Bento>
          <Bento className="md:col-span-2" icon={ArrowRightLeft} title="Cross-engine transformation" text="SQL to documents with embed-vs-reference reasoning, or documents to tables — with a live data preview and a ready ETL script.">
            <div className="space-y-1 font-mono text-[11px]">{[["uuid", "CHAR(36)", true], ["timestamptz", "datetime(6)", false], ["jsonb", "JSON", true]].map(([a, b, ok]) => <div key={String(a)} className="flex items-center gap-2 rounded-md bg-muted px-2 py-1"><span className="text-ink">{a}</span><ArrowRight size={11} className="text-ink-muted" /><span className="text-ink">{b}</span><span className={`ml-auto text-[10px] font-sans font-semibold ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{ok ? "lossless" : "lossy"}</span></div>)}</div>
          </Bento>
          <Bento className="md:col-span-2" icon={Layers} title="Redis has a schema too" text="Keys are sampled with SCAN and grouped into patterns. See the data type, TTL coverage and size of every keyspace — and which ones never expire.">
            <div className="space-y-1">{keyspaces.map((k) => <div key={k.pattern} className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-[11px]"><code className="truncate font-mono text-ink">{k.pattern}</code><span className={`ml-auto flex shrink-0 items-center gap-1 font-semibold ${k.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}><Timer size={10} />{k.ttl}</span></div>)}</div>
          </Bento>
          <Bento className="md:col-span-2" icon={FileDiff} title="Reviewable migrations" text="Dialect-correct scripts with risk classification, online-DDL patterns, static validation and hashes. Nothing auto-executes.">
            <div className="rounded-lg bg-slate-950 p-2.5 font-mono text-[10.5px] leading-5"><div className="text-emerald-300">+ CREATE INDEX CONCURRENTLY orders_user_idx</div><div className="text-red-300">- DROP INDEX orders_user_id_idx;</div><div className="text-slate-500">-- risk: low · duplicate index</div></div>
          </Bento>
          <Bento className="md:col-span-3" icon={Compass} title="Which database fits?" text="Describe the workload and get a transparent ranking of ten widely used engines, honest watch-outs and polyglot suggestions instead of one database for everything.">
            <div className="flex flex-wrap gap-1.5">{example.ranked.slice(0, 4).map((r, i) => <span key={r.id} className="flex items-center gap-1.5 rounded-lg border border-line bg-muted py-1 pl-1 pr-2 text-[11px] font-semibold text-ink"><EngineBadge engine={r.label} size={20} className="!rounded-md" />{r.label}<span className="font-mono text-ink-muted">{r.score}</span>{i === 0 && <span className="rounded bg-emerald-500/15 px-1 text-[9px] text-emerald-600 dark:text-emerald-300">best fit</span>}</span>)}</div>
          </Bento>
          <Bento className="md:col-span-3" icon={FileText} title="Docs your team will read" text="HTML, Markdown and JSON reports with the diagram, the inventory, the findings and the analysis limitations built in — plus a grounded assistant that cites rule ids.">
            <div className="flex flex-wrap gap-1.5">{["report.html", "schema.md", "findings.json", "diagram.svg", "migration-up.sql"].map((f) => <span key={f} className="rounded-lg border border-line bg-muted px-2 py-1 font-mono text-[11px] text-ink-muted">{f}</span>)}</div>
          </Bento>
        </RevealGroup>
      </section>

      {/* architecture */}
      <section id="architecture" className="relative scroll-mt-16 overflow-hidden bg-[#070b14] py-24 text-white">
        <div className="pointer-events-none absolute -left-40 top-10 h-[520px] w-[520px] rounded-full bg-indigo-600/20 blur-[130px]" />
        <div className="pointer-events-none absolute -right-40 bottom-0 h-[420px] w-[420px] rounded-full bg-cyan-500/10 blur-[130px]" />
        <div className="relative mx-auto max-w-7xl px-5">
          <Reveal className="max-w-3xl"><Eyebrow dark>Architecture</Eyebrow><h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-[2.6rem]"><WordReveal text="Real systems are not one database with one schema." /></h2><p className="mt-4 text-lg leading-8 text-slate-400">A database has many schemas. A system has many databases. DB Architect models both levels — and everything below is live output of the analyzers on the sample system, not a mock-up.</p></Reveal>
          <Reveal className="mt-12" delay={.1}><ArchitectureShowcase data={showcase} /></Reveal>
        </div>
      </section>

      {/* transform */}
      <section id="transform" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <Reveal>
            <Eyebrow>Transformation Studio</Eyebrow>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight">See how your data will change — before you move it.</h2>
            <p className="mt-4 text-lg leading-8 text-ink-muted">Moving between SQL and documents is a modelling decision, not a type conversion. The studio explains each decision, flags lossy conversions, and shows rows turning into target rows or documents.</p>
            <RevealGroup as="ul" className="mt-8 space-y-4" delay={.1}>{[["Embed vs. reference, with reasons", "Owned, bounded children are embedded; growth-prone or shared ones stay separate."], ["Junctions become arrays, arrays become tables", "Many-to-many links, nested objects and arrays are mapped in both directions."], ["Preview with synthetic or consented live data", "Masked, bounded, read-only, never stored — and audit-logged."], ["A runnable ETL script and runbook", "Idempotent batches, validation queries and orphan checks included."]].map(([t, d]) => <RevealItem as="li" key={t} className="flex gap-3"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"><Check size={13} strokeWidth={3} /></span><div><div className="font-semibold text-ink">{t}</div><div className="mt-0.5 text-sm text-ink-muted">{d}</div></div></RevealItem>)}</RevealGroup>
          </Reveal>
          <Reveal delay={.15}><Tilt max={5}><div className="rounded-2xl bg-[#0b1120] p-4 shadow-2xl ring-1 ring-white/10"><TransformShowcase /></div></Tilt></Reveal>
        </div>
      </section>

      {/* advisor */}
      <section id="advisor" className="scroll-mt-16 border-y border-line bg-elevated/60 py-24">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-[1.1fr_1fr]">
          <Reveal delay={.1}><Tilt max={4} className="surface p-6 shadow-sm"><div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-ink-muted"><Compass size={14} className="text-indigo-500" />Example · massive write-heavy time-series, multi-region</div><div className="mt-5"><AdvisorBars ranked={example.ranked.slice(0, 5)} /></div><div className="surface-muted mt-6 rounded-xl p-4 text-xs leading-5 text-ink-muted">{example.summary}</div></Tilt></Reveal>
          <Reveal>
            <Eyebrow>Database Advisor</Eyebrow>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight">You are a database architect — not a Postgres architect.</h2>
            <p className="mt-4 text-lg leading-8 text-ink-muted">Tell us about the workload. The advisor scores ten widely used engines across 21 capabilities, explains every score, and suggests complementary stores instead of forcing one database to do everything.</p>
            <p className="mt-4 text-sm leading-6 text-ink-muted/80">Scores are a transparent heuristic over declared requirements — not a benchmark. Validate the shortlist with a prototype.</p>
            <div className="mt-8"><DemoButton className="group flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-bold text-canvas transition hover:opacity-90 disabled:opacity-60">Try the advisor <ArrowRight size={15} className="transition group-hover:translate-x-1" /></DemoButton></div>
          </Reveal>
        </div>
      </section>

      {/* how it works */}
      <section className="mx-auto max-w-7xl px-5 py-24">
        <Reveal className="mx-auto max-w-2xl text-center"><Eyebrow>How it works</Eyebrow><h2 className="mt-4 text-4xl font-semibold tracking-tight">From connection to decision in four steps</h2></Reveal>
        <RevealGroup className="relative mt-14 grid gap-6 md:grid-cols-4" delay={.12}>
          <div className="pointer-events-none absolute left-[12%] right-[12%] top-[2.9rem] hidden h-px bg-gradient-to-r from-transparent via-indigo-400/60 to-transparent md:block" />
          {STEPS.map(([Icon, t, d], i) => <RevealItem key={t}><Spotlight className="surface card-hover group relative h-full p-6"><div className="flex items-center gap-3"><div className="icon-tile relative h-11 w-11"><Icon size={20} /></div><span className="font-mono text-xs font-bold text-ink-muted/60">0{i + 1}</span></div><h3 className="mt-4 font-semibold text-ink">{t}</h3><p className="mt-2 text-sm leading-6 text-ink-muted">{d}</p></Spotlight></RevealItem>)}
        </RevealGroup>
      </section>

      {/* about */}
      <section id="about" className="scroll-mt-16 border-b border-line bg-elevated/60 py-24">
        <div className="mx-auto max-w-7xl px-5">
          <Reveal className="max-w-3xl">
            <Eyebrow>About</Eyebrow>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-[2.6rem]">
              <WordReveal text="Built to be argued with." />
            </h2>
            <p className="mt-4 text-lg leading-8 text-ink-muted">
              Every number DB Architect shows can be traced back to a rule, a
              statistic, a sample or a named heuristic. That is what makes it
              useful in a design review — you can disagree with a finding, and
              the tool will tell you why it believes it.
            </p>
          </Reveal>
          <RevealGroup className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3" delay={.06}>
            {PRINCIPLES.map(([Icon, t, d]) => (
              <RevealItem key={t}>
                <Spotlight className="surface card-hover group flex h-full flex-col p-6">
                  <div className="icon-tile h-11 w-11"><Icon size={20} /></div>
                  <h3 className="mt-5 text-base font-semibold text-ink">{t}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink-muted">{d}</p>
                </Spotlight>
              </RevealItem>
            ))}
          </RevealGroup>
          <Reveal className="mt-12" delay={.1}>
            <div className="surface flex flex-col items-start gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-semibold text-ink">Open source, end to end</h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
                  The full product is on GitHub: every engine adapter, every
                  rule, the transformation planner and the migration generator.
                  Read the code, run it locally, or add the engine your stack is
                  missing.
                </p>
              </div>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="group flex shrink-0 items-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-bold text-canvas transition hover:opacity-90"
              >
                <ExternalLink size={16} />
                View on GitHub
                <ArrowRight size={15} className="transition group-hover:translate-x-1" />
              </a>
            </div>
          </Reveal>
        </div>
      </section>

      {/* security */}
      <section id="security" className="scroll-mt-16 border-y border-line bg-elevated/60 py-24">
        <div className="mx-auto max-w-7xl px-5">
          <Reveal className="max-w-2xl"><Eyebrow>Security &amp; trust</Eyebrow><h2 className="mt-4 text-4xl font-semibold tracking-tight">Your databases are sensitive. We designed for that first.</h2></Reveal>
          <RevealGroup className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{SECURITY.map(([Icon, t, d]) => <RevealItem key={t}><Spotlight className="surface card-hover group h-full p-6"><div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-500/12 text-emerald-600 ring-1 ring-inset ring-emerald-500/25 transition group-hover:scale-110 dark:text-emerald-400"><Icon size={20} /></div><h3 className="mt-4 font-semibold text-ink">{t}</h3><p className="mt-2 text-sm leading-6 text-ink-muted">{d}</p></Spotlight></RevealItem>)}</RevealGroup>
        </div>
      </section>

      {/* roadmap */}
      <section id="roadmap" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-24">
        <Reveal className="flex flex-wrap items-end justify-between gap-4"><div className="max-w-2xl"><Eyebrow>Roadmap</Eyebrow><h2 className="mt-4 text-4xl font-semibold tracking-tight">Common engines first. Then the long tail.</h2><p className="mt-3 text-ink-muted">{shipped} of {SPEC_ITEMS.length} spec items shipped. We add databases in order of real-world usage and finish the top few before starting the next.</p></div><GitBranch className="hidden text-ink-muted/40 lg:block" size={40} /></Reveal>
        <RevealGroup className="mt-10 grid gap-3 md:grid-cols-2 lg:grid-cols-5" delay={.05}>{TOP_10.map((t) => <RevealItem key={t.rank} className="surface card-hover p-4"><div className="flex items-center justify-between"><span className="font-mono text-xs font-bold text-ink-muted/60">#{String(t.rank).padStart(2, "0")}</span><span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[t.status]}`}>{t.status === "shipped" && <Check size={10} strokeWidth={3} />}{t.status === "shipped" ? "Shipped" : t.status === "next" ? "Next" : "Planned"}</span></div><div className="mt-2 text-[13px] font-semibold leading-5 text-ink">{t.title}</div></RevealItem>)}</RevealGroup>
      </section>

      {/* cta */}
      <section className="relative overflow-hidden bg-[#070b14] px-5 py-28 text-center text-white">
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600/25 blur-[130px]" />
        <div className="grid-lines pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
        <Reveal className="relative mx-auto max-w-3xl">
          <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-xl shadow-indigo-500/30"><Rocket size={24} /></div>
          <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">See your system the way an architect does.</h2>
          <p className="mt-4 text-lg text-slate-400">Open the demo workspace in one click — a pre-analyzed PostgreSQL with eight schemas, a MongoDB and a Redis. No sign-up.</p>
          <div className="mt-9 flex flex-wrap justify-center gap-4"><DemoButton className="group flex items-center gap-2 rounded-xl bg-indigo-500 px-7 py-3.5 text-sm font-bold text-white shadow-xl shadow-indigo-500/25 transition hover:bg-indigo-400 disabled:opacity-60">Open the live demo <ArrowRight size={16} className="transition group-hover:translate-x-1" /></DemoButton><Link href="/app" className="rounded-xl border border-white/15 px-7 py-3.5 text-sm font-semibold text-slate-200 transition hover:bg-white/5">Create a workspace</Link></div>
        </Reveal>
      </section>

      <footer className="border-t border-white/5 bg-[#070b14] px-5 py-12 text-slate-400">
        <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div><div className="flex items-center gap-2.5 text-white"><span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600"><Database size={17} /></span><span className="font-bold tracking-tight">DB Architect</span></div><p className="mt-3 max-w-xs text-sm leading-6">Database-agnostic architecture intelligence. Deterministic rules first, evidence over guesswork.</p><div className="mt-4 flex gap-2">{ENGINE_LIST.map((e) => <span key={e.id} title={e.label}><EngineBadge engine={e.id} size={28} /></span>)}</div></div>
          {([["Product", [["Features", "#features"], ["Architecture", "#architecture"], ["Transformation Studio", "#transform"], ["Database Advisor", "#advisor"]]], ["Trust", [["About", "#about"], ["Security model", "#security"], ["Roadmap", "#roadmap"], ["Engines", "#engines"]]], ["Get started", [["Open the workspace", "/app"], ["Sign in", "/app"], ["GitHub", REPO_URL]]]] as [string, [string, string][]][]).map(([title, links]) => <div key={title}><div className="text-xs font-bold uppercase tracking-[.16em] text-slate-500">{title}</div><ul className="mt-3 space-y-2 text-sm">{links.map(([l, h]) => <li key={l}>{h.startsWith("/") ? <Link href={h} className="transition hover:text-white">{l}</Link> : h.startsWith("http") ? <a href={h} target="_blank" rel="noreferrer" className="transition hover:text-white">{l}</a> : <a href={h} className="transition hover:text-white">{l}</a>}</li>)}</ul></div>)}
        </div>
        <div className="mx-auto mt-10 flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/5 pt-6 text-xs text-slate-500"><span className="flex items-center gap-1.5"><Boxes size={13} />Every schema · every database · one architecture</span><span className="flex items-center gap-1.5"><TableProperties size={13} />Nothing is ever executed against your database</span></div>
      </footer>
    </div>
  );
}
