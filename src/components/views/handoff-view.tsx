"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Bot, Check, CheckCircle2, Code2, Copy, Download, FileCode2, FileJson, FileUp, Layers, Loader2, ShieldAlert, ShieldCheck, Sparkles, Terminal, Upload, Workflow, type LucideIcon } from "lucide-react";
import { Card, Chip, Segmented, SeverityChip } from "@/components/ui";
import { engineLabel } from "@/lib/engines";
import type { HandoffBundle, HandoffDetail, HandoffFormat, HandoffScope, HandoffTask, VerifiedProposal } from "@/lib/handoff";

type MainTab = "export" | "verify";
type StoreOpt = { id: string; name: string; engine: string; role: string };

const FORMATS: { id: HandoffFormat; label: string; file: string; desc: string; icon: LucideIcon; badge?: string }[] = [
  { id: "prompt_pack", label: "ChatGPT / Claude Prompt", file: "prompt.md", desc: "Paste into ChatGPT Plus, Claude Pro or Gemini. Includes round-trip output contract.", icon: Sparkles, badge: "No API key" },
  { id: "skill_md", label: "Agent Skill", file: "SKILL.md", desc: "Standard Agent Skill with YAML frontmatter for Claude Code & Codex.", icon: Terminal, badge: "Portable skill" },
  { id: "claude_md", label: "Claude Code", file: "CLAUDE.md", desc: "Drop into repo root so Claude Code respects every schema & migration rule.", icon: Bot },
  { id: "cursor_mdc", label: "Cursor Rule", file: "db-architect.mdc", desc: "Auto-attached .cursor/rules/db-architect.mdc for SQL & migration files.", icon: Code2 },
  { id: "agents_md", label: "AGENTS.md", file: "AGENTS.md", desc: "Universal agent context for Codex, Windsurf, Copilot and Goose.", icon: FileCode2 },
  { id: "context_json", label: "Canonical JSON", file: "context.json", desc: "Machine-readable db-architect/context/v1 for scripts, CI and MCP tools.", icon: FileJson },
];

const TASKS: [HandoffTask, string][] = [
  ["redesign", "Full architecture & schema redesign"],
  ["fix_findings", "Fix all critical & high findings"],
  ["migrate_engine", "Migrate to another database engine"],
  ["optimize_queries", "Query, index & Redis optimization"],
  ["security_tenancy", "Security, RLS multi-tenancy & GDPR"],
  ["custom", "Custom prompt / goal"],
];

const SAMPLE_AI_REPLY = `Here is a redesigned PostgreSQL schema that resolves the missing primary key on \`audit.change_log\`, removes the duplicate index on \`sales.orders\`, breaks the \`auth ⇄ billing\` schema cycle, converts \`analytics.daily_revenue.revenue\` from \`double precision\` to \`numeric(14,2)\`, and declares a CDC flow from \`commerce-core\` to \`commerce-content\`.

\`\`\`db-architect-proposal
{
  "format": "db-architect/proposal/v1",
  "title": "Harden commerce-core + declare CDC sync to MongoDB",
  "summary": "Adds a UUID PK to audit.change_log, drops duplicate orders_user_id_idx, breaks auth->billing back-reference FK, replaces float revenue with numeric(14,2), and declares CDC from commerce-core to commerce-content.",
  "targetEngine": "postgres",
  "rationale": [
    "PG-CONST-001: audit.change_log now has id uuid PRIMARY KEY for safe CDC/replication",
    "PG-INDEX-001: removed duplicate sales.orders index orders_user_id_idx",
    "PG-SCHEMA-001: removed auth.users -> billing.subscriptions back-edge to eliminate schema cycle",
    "PG-TYPE-020: analytics.daily_revenue.revenue changed to numeric(14,2)",
    "ARCH-001: declared CDC flow from commerce-core to commerce-content"
  ],
  "sql": "CREATE SCHEMA IF NOT EXISTS auth;\\nCREATE SCHEMA IF NOT EXISTS catalog;\\nCREATE SCHEMA IF NOT EXISTS sales;\\nCREATE SCHEMA IF NOT EXISTS billing;\\nCREATE SCHEMA IF NOT EXISTS support;\\nCREATE SCHEMA IF NOT EXISTS analytics;\\nCREATE SCHEMA IF NOT EXISTS audit;\\nCREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(320) NOT NULL UNIQUE, display_name text NOT NULL, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());\\nCREATE TABLE auth.sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());\\nCREATE INDEX sessions_user_idx ON auth.sessions (user_id);\\nCREATE TABLE catalog.products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sku text NOT NULL UNIQUE, name text NOT NULL, description text, price_cents integer NOT NULL CHECK (price_cents >= 0), attributes jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now());\\nCREATE TABLE sales.orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), status text NOT NULL DEFAULT 'pending', total_cents integer NOT NULL DEFAULT 0, currency char(3) NOT NULL DEFAULT 'USD', placed_at timestamptz NOT NULL DEFAULT now());\\nCREATE INDEX orders_user_idx ON sales.orders (user_id);\\nCREATE TABLE sales.order_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES sales.orders(id) ON DELETE CASCADE, product_id uuid NOT NULL REFERENCES catalog.products(id), quantity integer NOT NULL CHECK (quantity > 0), unit_price_cents integer NOT NULL);\\nCREATE INDEX order_items_order_idx ON sales.order_items (order_id);\\nCREATE INDEX order_items_product_idx ON sales.order_items (product_id);\\nCREATE TABLE billing.subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), plan text NOT NULL, status text NOT NULL DEFAULT 'active', renews_at timestamptz);\\nCREATE INDEX subscriptions_user_idx ON billing.subscriptions (user_id);\\nCREATE TABLE analytics.daily_revenue (day date PRIMARY KEY, orders integer NOT NULL, revenue numeric(14,2) NOT NULL);\\nCREATE TABLE audit.change_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, row_id uuid NOT NULL, actor_id uuid, change jsonb NOT NULL, changed_at timestamptz NOT NULL DEFAULT now());",
  "architectureChanges": {
    "flows": [
      { "from": "commerce-core", "to": "commerce-content", "kind": "cdc", "description": "Debezium/outbox streams authoritative catalog.products updates to MongoDB." }
    ]
  },
  "migrationNotes": [
    "Run DROP INDEX CONCURRENTLY outside transaction",
    "Add audit.change_log.id with DEFAULT gen_random_uuid() before promoting to PRIMARY KEY"
  ]
}
\`\`\``;

function download(filename: string, content: string, mime: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  a.download = filename;
  a.click();
}

export default function HandoffView({
  projectId,
  scanId,
  stores,
  canWrite,
  initialBrief,
  initialTargetEngine,
  onOpenScan,
  onChanged,
  notify,
}: {
  projectId: string;
  scanId: string;
  stores: StoreOpt[];
  canWrite: boolean;
  initialBrief?: string;
  initialTargetEngine?: string;
  onOpenScan: (scanId: string, view: "Explorer" | "Diagram" | "Analysis") => void;
  onChanged: () => void;
  notify: (text: string, kind?: "success" | "error") => void;
}) {
  const [tab, setTab] = useState<MainTab>("export");
  const [format, setFormat] = useState<HandoffFormat>("prompt_pack");
  const [task, setTask] = useState<HandoffTask>("redesign");
  const [scope, setScope] = useState<HandoffScope>("system");
  const [focusStoreId, setFocusStoreId] = useState<string>("");
  const [detail, setDetail] = useState<HandoffDetail>("standard");
  const [brief, setBrief] = useState(initialBrief ?? "");
  const [targetEngine, setTargetEngine] = useState(initialTargetEngine ?? "keep");
  const [bundle, setBundle] = useState<HandoffBundle | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Round-trip verification state
  const [rawProposal, setRawProposal] = useState("");
  const [verified, setVerified] = useState<VerifiedProposal | null>(null);
  const [applyArch, setApplyArch] = useState(true);

  useEffect(() => { if (initialBrief) setBrief(initialBrief); }, [initialBrief]);
  useEffect(() => { if (initialTargetEngine) setTargetEngine(initialTargetEngine); }, [initialTargetEngine]);

  const generateExport = useCallback(async () => {
    if (!projectId) return;
    setBusy("export");
    const r = await fetch("/api/v1/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        action: "export",
        format,
        task,
        scope,
        focusStoreId: scope === "store" ? focusStoreId || stores[0]?.id : undefined,
        detail,
        productRequirements: brief,
        targetEngine,
      }),
    }).then((x) => x.json()).catch(() => ({ error: "Could not reach the server" }));
    setBusy(null);
    if (r.bundle) setBundle(r.bundle);
    else notify(r.error ?? "Could not generate export", "error");
  }, [projectId, format, task, scope, focusStoreId, stores, detail, brief, targetEngine, notify]);

  useEffect(() => {
    if (tab === "export") generateExport();
  }, [tab, format, scope, detail, task, focusStoreId, targetEngine, generateExport]);

  async function runVerify(inputText?: string) {
    const text = (inputText ?? rawProposal).trim();
    if (!text) return notify("Paste an AI response or upload a proposal file first", "error");
    setBusy("verify");
    const r = await fetch("/api/v1/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "verify", rawInput: text, baselineScanId: scanId || undefined }),
    }).then((x) => x.json()).catch(() => ({ error: "Could not reach the server" }));
    setBusy(null);
    if (r.verified) {
      setVerified(r.verified);
      notify(`Verified proposal: ${r.verified.proposed.entities} entities · score ${r.verified.proposed.designScore}/100`);
    } else notify(r.error ?? "Could not parse proposal", "error");
  }

  async function applyVerified() {
    if (!verified || !rawProposal.trim()) return;
    setBusy("apply");
    const r = await fetch("/api/v1/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        action: "apply",
        rawInput: rawProposal,
        baselineScanId: scanId || undefined,
        saveSchema: verified.parsed.model.entities.length > 0,
        applyArchitecture: applyArch && Boolean(verified.parsed.architectureChanges),
      }),
    }).then((x) => x.json()).catch(() => ({ error: "Could not reach the server" }));
    setBusy(null);
    if (r.ok) {
      notify(`Saved proposal${r.scanId ? " as a new schema version" : ""}${r.storesAdded || r.flowsAdded ? ` (+${r.storesAdded} stores, +${r.flowsAdded} flows)` : ""}`);
      onChanged();
      if (r.scanId) onOpenScan(r.scanId, "Diagram");
    } else notify(r.error ?? "Apply failed", "error");
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { const text = String(rd.result ?? ""); setRawProposal(text); runVerify(text); };
    rd.readAsText(f);
  }

  return (
    <div className="space-y-4">
      {/* Top explainer & mode toggle */}
      <Card className="flex flex-wrap items-center gap-4 !py-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm"><Sparkles size={18} /></div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-ink">Bring your own AI subscription — ChatGPT, Claude, Cursor, Claude Code or Codex</h2>
            <p className="text-xs text-ink-muted">No API keys required. Export a verified metadata-only Skill or Prompt Pack, let your AI design improvements, then paste its reply back for strict deterministic verification.</p>
          </div>
        </div>
        <Segmented<MainTab>
          layoutId="handoff-main"
          value={tab}
          onChange={setTab}
          options={[
            { value: "export", label: <><Download size={13} />1 · Export to AI / Skills</> },
            { value: "verify", label: <><ShieldCheck size={13} />2 · Verify AI Response</> },
          ]}
        />
      </Card>

      {tab === "export" ? (
        <div className="grid gap-5 xl:grid-cols-[410px_1fr]">
          {/* Export configuration */}
          <div className="space-y-4">
            <Card className="space-y-4">
              <div>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-muted">Export format</div>
                <div className="grid gap-2">
                  {FORMATS.map((f) => {
                    const active = format === f.id;
                    return (
                      <button key={f.id} onClick={() => setFormat(f.id)} aria-pressed={active} className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${active ? "border-indigo-500 bg-indigo-500/10" : "border-line hover:border-indigo-400/50 hover:bg-muted"}`}>
                        <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${active ? "bg-indigo-600 text-white" : "bg-muted text-ink-muted"}`}><f.icon size={15} /></div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2"><span className="text-xs font-bold text-ink">{f.label}</span><code className="text-[10px] text-ink-muted">{f.file}</code>{f.badge && <Chip className="ml-auto bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300">{f.badge}</Chip>}</div>
                          <p className="mt-0.5 text-[11px] leading-4 text-ink-muted">{f.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-semibold text-ink-muted">
                  Scope
                  <select value={scope} onChange={(e) => setScope(e.target.value as HandoffScope)} className="mt-1.5 w-full rounded-xl border border-line bg-elevated px-2.5 py-2 text-xs text-ink outline-none focus:border-indigo-400">
                    <option value="system">Entire system ({stores.length} stores)</option>
                    <option value="store">Single datastore</option>
                  </select>
                </label>
                <label className="text-xs font-semibold text-ink-muted">
                  Token budget
                  <select value={detail} onChange={(e) => setDetail(e.target.value as HandoffDetail)} className="mt-1.5 w-full rounded-xl border border-line bg-elevated px-2.5 py-2 text-xs text-ink outline-none focus:border-indigo-400">
                    <option value="compact">Compact (chat-friendly)</option>
                    <option value="standard">Standard (tables + findings)</option>
                    <option value="full">Full (all evidence + metadata)</option>
                  </select>
                </label>
              </div>

              {scope === "store" && stores.length > 0 && (
                <label className="block text-xs font-semibold text-ink-muted">
                  Datastore
                  <select value={focusStoreId || stores[0]?.id} onChange={(e) => setFocusStoreId(e.target.value)} className="mt-1.5 w-full rounded-xl border border-line bg-elevated px-2.5 py-2 text-xs text-ink outline-none focus:border-indigo-400">
                    {stores.map((s) => <option key={s.id} value={s.id}>{s.name} ({engineLabel(s.engine)})</option>)}
                  </select>
                </label>
              )}

              {format === "prompt_pack" && (
                <>
                  <label className="block text-xs font-semibold text-ink-muted">
                    Task focus
                    <select value={task} onChange={(e) => setTask(e.target.value as HandoffTask)} className="mt-1.5 w-full rounded-xl border border-line bg-elevated px-2.5 py-2 text-xs text-ink outline-none focus:border-indigo-400">
                      {TASKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-ink-muted">
                    Product requirements / goal (included in prompt)
                    <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} placeholder="Optional: e.g. We need B2B multi-tenancy, EU GDPR compliance, or migrating from MySQL to PostgreSQL…" className="mt-1.5 w-full rounded-xl border border-line bg-elevated p-2.5 text-xs text-ink outline-none placeholder:text-ink-muted/60 focus:border-indigo-400" />
                  </label>
                  <button disabled={busy !== null} onClick={generateExport} className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-muted py-2 text-xs font-bold text-ink hover:bg-elevated">
                    {busy === "export" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}Refresh prompt with requirements
                  </button>
                </>
              )}
            </Card>
          </div>

          {/* Live bundle preview */}
          <Card padded={false} className="flex min-w-0 flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3.5">
              <code className="font-mono text-xs font-bold text-ink">{bundle?.filename ?? "…"}</code>
              {bundle && (
                <>
                  <Chip className="bg-indigo-500/12 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300">~{bundle.estimatedTokens.toLocaleString()} tokens</Chip>
                  <Chip className="bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300"><ShieldCheck size={10} />0 rows · 0 secrets</Chip>
                </>
              )}
              <div className="ml-auto flex gap-2">
                <button disabled={!bundle} onClick={() => { if (!bundle) return; navigator.clipboard?.writeText(bundle.content); setCopied(true); notify(`Copied ${bundle.filename} (~${bundle.estimatedTokens} tokens)`); setTimeout(() => setCopied(false), 1800); }} className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
                  {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied!" : "Copy"}
                </button>
                <button disabled={!bundle} onClick={() => bundle && download(bundle.filename, bundle.content, bundle.mimeType)} className="flex items-center gap-1.5 rounded-xl border border-line bg-elevated px-3.5 py-2 text-xs font-semibold text-ink hover:bg-muted disabled:opacity-50">
                  <Download size={13} />Download
                </button>
              </div>
            </div>
            {bundle && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-muted/40 px-5 py-2 text-[11px] text-ink-muted">
                <span><b>How to use:</b> {bundle.installHint}</span>
                <span className="ml-auto tabular-nums">{bundle.stats.stores} store(s) · {bundle.stats.schemas} schema(s) · {bundle.stats.entities} entities · {bundle.stats.findings} findings</span>
              </div>
            )}
            <pre className="scroll-thin max-h-[640px] flex-1 overflow-auto bg-slate-950 p-5 font-mono text-[11.5px] leading-relaxed text-slate-200">{busy === "export" && !bundle ? "Building metadata-only bundle…" : bundle?.content ?? ""}</pre>
          </Card>
        </div>
      ) : (
        /* Tab 2: Round-trip Verify AI Response */
        <div className="grid gap-5 xl:grid-cols-[440px_1fr]">
          <Card className="h-fit space-y-4">
            <div className="flex items-center justify-between">
              <div><h3 className="text-sm font-bold text-ink">Paste AI response or proposal file</h3><p className="mt-0.5 text-xs text-ink-muted">Paste the full reply from ChatGPT, Claude or Cursor — prose and all. We extract the proposal and verify it with our deterministic engine.</p></div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={() => { setRawProposal(SAMPLE_AI_REPLY); runVerify(SAMPLE_AI_REPLY); }} className="flex items-center gap-1.5 rounded-xl border border-indigo-400/50 bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-500/15 dark:text-indigo-300">
                <Sparkles size={13} />Try sample AI proposal
              </button>
              <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-elevated px-3 py-2 text-xs font-semibold text-ink hover:bg-muted">
                <FileUp size={13} />Upload .md / .json / .sql
                <input type="file" accept=".md,.txt,.json,.yaml,.yml,.sql" onChange={onFile} className="hidden" />
              </label>
            </div>

            <textarea
              value={rawProposal}
              onChange={(e) => setRawProposal(e.target.value)}
              rows={15}
              spellCheck={false}
              aria-label="AI proposal response"
              placeholder="Paste ChatGPT / Claude's full response here (a ```db-architect-proposal block, fenced ```sql DDL, YAML DSL, MongoDB JSON, or Redis key dump)…"
              className="scroll-thin w-full rounded-xl bg-slate-950 p-3.5 font-mono text-[11.5px] leading-5 text-emerald-200 outline-none ring-1 ring-white/5 placeholder:text-slate-500 focus:ring-indigo-400/60"
            />

            <button disabled={busy !== null || !rawProposal.trim()} onClick={() => runVerify()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50">
              {busy === "verify" ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
              Verify Deterministically
            </button>
            <p className="text-[11px] leading-5 text-ink-muted">Nothing is saved or executed during verification. DB Architect parses the AI&apos;s design, runs all structural/index/schema rules, catches regressions the AI missed, and builds a diff migration.</p>
          </Card>

          <div className="min-w-0 space-y-4">
            {!verified ? (
              <Card className="flex flex-col items-center justify-center px-6 py-20 text-center">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-500"><Upload size={22} /></div>
                <h3 className="mt-4 text-base font-bold text-ink">Round-trip AI verification</h3>
                <p className="mt-1 max-w-md text-sm leading-6 text-ink-muted">Export your system on tab 1, iterate in ChatGPT / Claude / Cursor, then paste the reply here. We check the AI&apos;s work with deterministic rules before you commit to anything.</p>
              </Card>
            ) : (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                {/* Verification header & Before/After Scorecard */}
                <div className="rounded-2xl bg-[#0d1424] p-6 text-white ring-1 ring-white/10">
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-indigo-300">
                        <span>Deterministic Verification Report</span>
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-200">{verified.parsed.sourceKind.replace("_", " ")}</span>
                      </div>
                      <h3 className="mt-1.5 text-xl font-bold">{verified.parsed.title}</h3>
                      {verified.parsed.summary && <p className="mt-1.5 text-sm leading-6 text-slate-400">{verified.parsed.summary}</p>}
                    </div>
                    <div className="flex shrink-0 gap-3">
                      <div className="rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-center">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Design score</div>
                        <div className="mt-1 flex items-center justify-center gap-1.5 text-lg font-bold tabular-nums">
                          {verified.baseline && <><span className="text-slate-400">{verified.baseline.designScore}</span><ArrowRight size={14} className="text-indigo-400" /></>}
                          <span className={verified.comparison.scoreDelta !== null && verified.comparison.scoreDelta < 0 ? "text-red-300" : "text-emerald-300"}>{verified.proposed.designScore}</span>
                        </div>
                        {verified.comparison.scoreDelta !== null && (
                          <div className={`text-[10px] font-semibold ${verified.comparison.scoreDelta >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                            {verified.comparison.scoreDelta >= 0 ? `+${verified.comparison.scoreDelta}` : verified.comparison.scoreDelta} pts
                          </div>
                        )}
                      </div>
                      {verified.architecturePreview && (
                        <div className="rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-center">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">System score</div>
                          <div className="mt-1 flex items-center justify-center gap-1.5 text-lg font-bold tabular-nums">
                            <span className="text-slate-400">{verified.architecturePreview.beforeScore}</span>
                            <ArrowRight size={14} className="text-indigo-400" />
                            <span className="text-emerald-300">{verified.architecturePreview.afterScore}</span>
                          </div>
                          <div className="text-[10px] text-emerald-300">{verified.architecturePreview.scoreDelta >= 0 ? `+${verified.architecturePreview.scoreDelta}` : verified.architecturePreview.scoreDelta} pts</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Stats strip */}
                  <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/10 pt-4 sm:grid-cols-4">
                    <div className="rounded-lg bg-white/[.04] px-3 py-2"><div className="text-[10px] uppercase text-slate-400">Entities</div><div className="text-base font-bold tabular-nums">{verified.proposed.entities} <span className="text-xs font-normal text-slate-400">({verified.proposed.namespaces} ns)</span></div></div>
                    <div className="rounded-lg bg-emerald-500/15 px-3 py-2"><div className="text-[10px] uppercase text-emerald-300">Findings fixed</div><div className="text-base font-bold tabular-nums text-emerald-200">{verified.comparison.findingsFixed.length}</div></div>
                    <div className={`rounded-lg px-3 py-2 ${verified.comparison.regressions.length ? "bg-red-500/20" : "bg-white/[.04]"}`}><div className={`text-[10px] uppercase ${verified.comparison.regressions.length ? "text-red-300" : "text-slate-400"}`}>Regressions caught</div><div className={`text-base font-bold tabular-nums ${verified.comparison.regressions.length ? "text-red-200" : "text-white"}`}>{verified.comparison.regressions.length}</div></div>
                    <div className="rounded-lg bg-white/[.04] px-3 py-2"><div className="text-[10px] uppercase text-slate-400">Validation</div><div className={`text-base font-bold ${verified.validation.errors.length ? "text-red-300" : "text-emerald-300"}`}>{verified.validation.errors.length ? `${verified.validation.errors.length} error(s)` : "Clean"}</div></div>
                  </div>

                  {/* Apply controls */}
                  {canWrite && (
                    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
                      {verified.parsed.architectureChanges && (
                        <label className="flex items-center gap-2 text-xs text-slate-300">
                          <input type="checkbox" checked={applyArch} onChange={(e) => setApplyArch(e.target.checked)} className="rounded border-white/20" />
                          Also apply proposed stores &amp; flows ({verified.architecturePreview?.proposedStores.length ?? 0} stores, {verified.architecturePreview?.proposedFlows.length ?? 0} flows)
                        </label>
                      )}
                      <button disabled={busy !== null || verified.validation.errors.length > 0} onClick={applyVerified} className="ml-auto flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-400 disabled:opacity-50">
                        {busy === "apply" ? <Loader2 size={13} className="animate-spin" /> : <Layers size={13} />}
                        Save verified proposal as version
                      </button>
                    </div>
                  )}
                </div>

                {/* Structural validation errors / warnings */}
                {(verified.validation.errors.length > 0 || verified.validation.warnings.length > 0) && (
                  <Card className="!py-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-amber-600 dark:text-amber-400"><AlertTriangle size={14} />Parser &amp; model validation notes</div>
                    <ul className="mt-2 space-y-1 text-xs text-ink-muted">
                      {verified.validation.errors.map((e, i) => <li key={`e-${i}`} className="font-semibold text-red-600 dark:text-red-400">ERROR: {e}</li>)}
                      {verified.validation.warnings.slice(0, 8).map((w, i) => <li key={`w-${i}`}>• {w}</li>)}
                    </ul>
                  </Card>
                )}

                {/* Regressions caught (AI mistakes!) */}
                {verified.comparison.regressions.length > 0 && (
                  <Card className="border-red-500/30 !py-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-red-600 dark:text-red-400"><ShieldAlert size={16} />New regressions introduced by AI ({verified.comparison.regressions.length})</div>
                    <p className="mt-0.5 text-xs text-ink-muted">Our deterministic analyzer caught these new issues in the AI&apos;s proposal — review or ask your AI to fix them before saving.</p>
                    <div className="mt-3 space-y-2">
                      {verified.comparison.regressions.map((f, i) => (
                        <div key={i} className="rounded-xl border border-red-500/20 bg-red-500/[.06] p-3 text-xs">
                          <div className="flex flex-wrap items-center gap-2"><SeverityChip severity={f.severity} /><b className="text-ink">{f.title}</b><code className="font-mono text-ink-muted">{f.object}</code><code className="ml-auto text-[10px] text-ink-muted">{f.ruleId}</code></div>
                          <p className="mt-1 text-ink-muted">{f.recommendation}</p>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Findings resolved */}
                {verified.comparison.findingsFixed.length > 0 && (
                  <Card className="!py-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={16} />Findings resolved by this proposal ({verified.comparison.findingsFixed.length})</div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {verified.comparison.findingsFixed.slice(0, 12).map((f, i) => (
                        <div key={i} className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[.06] p-2.5 text-xs">
                          <Check size={13} className="mt-0.5 shrink-0 text-emerald-500" />
                          <div className="min-w-0"><div className="font-semibold text-ink">{f.title}</div><div className="truncate font-mono text-[10px] text-ink-muted">{f.ruleId} · {f.object}</div></div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Architecture delta */}
                {verified.architecturePreview && (
                  <Card className="!py-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-ink"><Workflow size={15} className="text-indigo-500" />System architecture impact</div>
                    <div className="mt-2 space-y-2 text-xs">
                      {verified.architecturePreview.resolvedArchFindings.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={13} /><b>Resolved {f.ruleId}:</b> {f.title} ({f.object})</div>
                      ))}
                      {verified.architecturePreview.proposedFlows.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-ink"><span className="font-semibold">{f.from}</span><ArrowRight size={12} className="text-indigo-500" /><span className="font-semibold">{f.to}</span><Chip className="bg-indigo-500/12 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300">{f.kind}</Chip></div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Auto-generated diff & migration */}
                {verified.diff && (
                  <Card className="!py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-ink">Generated migration from current schema → AI proposal</span>
                      <Chip className="bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300">+{verified.diff.added} added</Chip>
                      <Chip className="bg-red-500/12 text-red-700 ring-red-500/25 dark:text-red-300">−{verified.diff.removed} removed</Chip>
                      <Chip className="bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300">~{verified.diff.modified} modified</Chip>
                      {verified.migration && (
                        <Chip className={`ml-auto ${verified.migration.validation.ok ? "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300" : "bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300"}`}>
                          {verified.migration.validation.ok ? "Static checks passed" : "Review checks"}
                        </Chip>
                      )}
                    </div>
                    {verified.migration && (
                      <pre className="scroll-thin mt-3 max-h-72 overflow-auto rounded-xl bg-slate-950 p-4 font-mono text-[11px] leading-5 text-emerald-200">{verified.migration.up}</pre>
                    )}
                  </Card>
                )}
              </motion.div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
