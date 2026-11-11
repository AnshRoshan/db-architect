"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Bot, Check, Copy, Gauge, Loader2, Network, RotateCcw, ShieldCheck, Wrench } from "lucide-react";
import Markdown from "@/components/markdown";
import { Card, Chip, EmptyState, Segmented } from "@/components/ui";
import type { ModelT } from "./types";

type Mode = "architect" | "optimizer" | "operations";
type Msg = { q: string; a: string; cites: string[]; mode: string; engine: string };

const MODES: Record<Mode, { label: string; icon: typeof Network; blurb: string; prompts: string[] }> = {
  architect: { label: "Architecture", icon: Network, blurb: "Topology, hubs, integrity rules and normalization trade-offs.", prompts: ["Perform an architectural & bottleneck audit", "Which entities are the primary join/delete hubs?", "Evaluate normalization vs document embedding for this schema"] },
  optimizer: { label: "Query & indexes", icon: Gauge, blurb: "Index selectivity, compound key order and redundancy.", prompts: ["Analyze index selectivity, redundancy & missing covering indexes", "Which indexes look redundant?", "Explain compound index ordering for this schema"] },
  operations: { label: "Operations", icon: Wrench, blurb: "Online DDL, lock budgets, partitioning and rollback.", prompts: ["Generate a zero-downtime online migration strategy", "Design a partitioning and sharding roadmap for 100M+ rows", "Identify high-risk failure modes & lock contention"] },
};

export default function AssistantView({ scanId, model }: { scanId: string; model: ModelT | null }) {
  const [mode, setMode] = useState<Mode>("architect");
  const [q, setQ] = useState("");
  const [log, setLog] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [provider, setProvider] = useState("built-in");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { fetch("/api/v1/ai").then((r) => r.json()).then((d) => setProvider(d.provider ?? "built-in")).catch(() => undefined); }, []);
  useEffect(() => { setLog([]); }, [scanId]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [log, busy]);

  async function ask(text?: string) {
    const question = (text ?? q).trim();
    if (!question || !scanId || busy) return;
    setBusy(true); setQ("");
    try {
      const r = await fetch("/api/v1/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scanId, question, modelType: mode }) }).then((x) => x.json());
      setLog((l) => [...l, { q: question, a: r.answer ?? r.error ?? "No answer returned.", cites: r.citations ?? [], mode: r.model?.name ?? MODES[mode].label, engine: r.model?.engine ?? "built-in" }]);
    } catch {
      setLog((l) => [...l, { q: question, a: "The assistant could not be reached. Try again in a moment.", cites: [], mode: MODES[mode].label, engine: "—" }]);
    } finally { setBusy(false); inputRef.current?.focus(); }
  }

  if (!scanId || !model) return <EmptyState icon={Bot} title="The assistant needs a schema" hint="Select an analyzed schema version — every answer is grounded in its model and findings." />;
  const M = MODES[mode];

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
      <div className="space-y-4">
        <Card>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Mode</div>
          <div className="mt-2 space-y-1.5">
            {(Object.keys(MODES) as Mode[]).map((k) => { const I = MODES[k].icon; const on = k === mode; return (
              <button key={k} onClick={() => setMode(k)} aria-pressed={on} className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${on ? "border-indigo-400/50 bg-indigo-500/[.07]" : "border-line hover:bg-muted"}`}>
                <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${on ? "bg-indigo-600 text-white" : "bg-muted text-ink-muted"}`}><I size={15} /></div>
                <div><div className="text-[13px] font-semibold text-ink">{MODES[k].label}</div><div className="mt-0.5 text-[11px] leading-4 text-ink-muted">{MODES[k].blurb}</div></div>
              </button>); })}
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-xs font-semibold text-ink"><ShieldCheck size={14} className="text-emerald-500" />Grounded answers</div>
          <p className="mt-1.5 text-[11px] leading-5 text-ink-muted">Answers use only this schema&apos;s model and findings — no invented tables, columns or statistics, and no row data leaves the workspace.</p>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-muted">Engine: <Chip className="bg-muted text-ink ring-line">{provider === "built-in" ? "Built-in, rule-grounded" : provider}</Chip></div>
        </Card>
      </div>

      <Card padded={false} className="flex h-[calc(100vh-13rem)] min-h-[520px] flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0"><div className="text-sm font-bold text-ink">Ask about <span className="font-mono">{model.database}</span></div><div className="text-[11px] text-ink-muted">{model.entities.length} entities · {model.relationships.length} relationships · mode: {M.label}</div></div>
          {log.length > 0 && <button onClick={() => setLog([])} className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-ink-muted hover:bg-muted hover:text-ink"><RotateCcw size={13} />New conversation</button>}
        </div>
        <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {log.length === 0 && !busy && (
            <div className="mx-auto flex max-w-lg flex-col items-center pt-8 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-500"><M.icon size={22} /></div>
              <h3 className="mt-4 font-bold text-ink">{M.label} questions</h3>
              <p className="mt-1 text-sm text-ink-muted">{M.blurb}</p>
              <div className="mt-6 grid w-full gap-2">{M.prompts.map((p) => <button key={p} onClick={() => ask(p)} className="rounded-xl border border-line bg-muted/40 px-4 py-3 text-left text-[13px] text-ink transition hover:border-indigo-400/50 hover:bg-indigo-500/[.05]">{p}</button>)}</div>
            </div>
          )}
          <AnimatePresence initial={false}>
            {log.map((m, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                <div className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-sm text-white">{m.q}</div>
                <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-line bg-muted/40 p-4">
                  <div className="mb-3 flex items-center gap-2 text-[11px] text-ink-muted"><Bot size={13} className="text-indigo-500" /><span className="font-semibold text-ink">{m.mode}</span><span>· {m.engine === "built-in" ? "built-in" : m.engine}</span><button onClick={() => { navigator.clipboard?.writeText(m.a); setCopied(i); setTimeout(() => setCopied(null), 1500); }} className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-elevated hover:text-ink">{copied === i ? <Check size={12} /> : <Copy size={12} />}{copied === i ? "Copied" : "Copy"}</button></div>
                  <Markdown source={m.a} />
                  {m.cites.length > 0 && <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line pt-3"><span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Cited</span>{m.cites.map((c, j) => <Chip key={j} className="bg-elevated font-mono text-ink ring-line">{c}</Chip>)}</div>}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {busy && <div className="flex items-center gap-2 text-xs text-ink-muted"><Loader2 size={14} className="animate-spin text-indigo-500" />Analyzing the schema…</div>}
          <div ref={endRef} />
        </div>
        <div className="border-t border-line p-3">
          <div className="flex items-end gap-2 rounded-2xl border border-line bg-elevated p-2 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-500/10">
            <textarea ref={inputRef} rows={1} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }} placeholder={`Ask about ${model.database} — Enter to send, Shift+Enter for a new line`} aria-label="Question" className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-muted/70" />
            <button onClick={() => ask()} disabled={busy || !q.trim()} aria-label="Send" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:opacity-40"><ArrowUp size={16} /></button>
          </div>
          <div className="mt-2 px-1"><Segmented<Mode> layoutId="assistant-mode" value={mode} onChange={setMode} options={(Object.keys(MODES) as Mode[]).map((k) => ({ value: k, label: MODES[k].label }))} /></div>
        </div>
      </Card>
    </div>
  );
}
