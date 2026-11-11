"use client";

// Shared design-system primitives. One source of truth for severity, engine and
// status colour so every view reads the same in light and dark mode.
import type { ComponentType, ReactNode } from "react";
import { motion } from "framer-motion";
import { AlertOctagon, AlertTriangle, Info, CircleDot, ArrowDownCircle, Inbox } from "lucide-react";
import { ENGINES, isEngine } from "@/lib/engines";

type Icon = ComponentType<{ size?: number; className?: string }>;

// ── Severity palette (dark-safe: tinted backgrounds + adaptive text) ──
export const SEVERITY = {
  critical: { edge: "border-l-red-500", label: "Critical", dot: "bg-red-500", bar: "bg-red-500", chip: "bg-red-500/12 text-red-700 ring-red-500/25 dark:text-red-300", icon: AlertOctagon },
  high: { edge: "border-l-orange-500", label: "High", dot: "bg-orange-500", bar: "bg-orange-500", chip: "bg-orange-500/12 text-orange-700 ring-orange-500/25 dark:text-orange-300", icon: AlertTriangle },
  medium: { edge: "border-l-amber-500", label: "Medium", dot: "bg-amber-500", bar: "bg-amber-500", chip: "bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300", icon: AlertTriangle },
  low: { edge: "border-l-sky-500", label: "Low", dot: "bg-sky-500", bar: "bg-sky-500", chip: "bg-sky-500/12 text-sky-700 ring-sky-500/25 dark:text-sky-300", icon: ArrowDownCircle },
  info: { edge: "border-l-slate-400", label: "Info", dot: "bg-slate-400", bar: "bg-slate-400", chip: "bg-slate-500/12 text-slate-600 ring-slate-500/25 dark:text-slate-300", icon: Info },
} as const;
export type SeverityKey = keyof typeof SEVERITY;
export const SEVERITY_ORDER: SeverityKey[] = ["critical", "high", "medium", "low", "info"];
export const sev = (s: string) => SEVERITY[(s in SEVERITY ? s : "info") as SeverityKey];

export const STATUS_STYLE: Record<string, string> = {
  open: "bg-indigo-500/12 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300",
  accepted: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
  fixed: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
  dismissed: "bg-slate-500/12 text-slate-600 ring-slate-500/25 dark:text-slate-300",
  needs_review: "bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300",
  completed: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
  partial: "bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300",
  failed: "bg-red-500/12 text-red-700 ring-red-500/25 dark:text-red-300",
};

export function Chip({ children, className = "", title }: { children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${className}`}>{children}</span>;
}
export function SeverityChip({ severity, withIcon = true }: { severity: string; withIcon?: boolean }) {
  const s = sev(severity); const I = s.icon;
  return <Chip className={s.chip}>{withIcon && <I size={11} />}{s.label}</Chip>;
}
export function StatusChip({ status }: { status: string }) {
  return <Chip className={STATUS_STYLE[status] ?? STATUS_STYLE.dismissed}>{status.replace("_", " ")}</Chip>;
}
export function EngineChip({ engine }: { engine: string }) {
  const meta = isEngine(engine) ? ENGINES[engine] : null;
  return <Chip className="bg-muted text-ink ring-line"><span className="h-1.5 w-1.5 rounded-full" style={{ background: meta?.color ?? "#94a3b8" }} />{meta?.label ?? engine}</Chip>;
}

// ── Type chip: colour by type family so columns scan quickly ──
export function typeTone(type: string): string {
  const t = type.toLowerCase();
  if (/uuid|objectid/.test(t)) return "text-violet-600 dark:text-violet-300";
  if (/int|serial|numeric|decimal|float|double|real|long|money/.test(t)) return "text-sky-600 dark:text-sky-300";
  if (/time|date/.test(t)) return "text-amber-600 dark:text-amber-300";
  if (/bool/.test(t)) return "text-emerald-600 dark:text-emerald-300";
  if (/json|object|array|\[\]/.test(t)) return "text-pink-600 dark:text-pink-300";
  return "text-ink-muted";
}
export function TypeLabel({ type }: { type: string }) {
  return <code className={`font-mono text-[11px] ${typeTone(type)}`}>{type}</code>;
}

// ── Layout ──
export function Card({ children, className = "", padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <section className={`surface ${padded ? "p-5" : ""} ${className}`}>{children}</section>;
}
export function CardHeader({ title, subtitle, icon: I, actions }: { title: ReactNode; subtitle?: ReactNode; icon?: Icon; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      {I && <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"><I size={17} /></div>}
      <div className="min-w-0 flex-1"><h3 className="text-sm font-bold text-ink">{title}</h3>{subtitle && <p className="mt-0.5 text-xs leading-5 text-ink-muted">{subtitle}</p>}</div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
export function Stat({ label, value, hint, icon: I, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; icon?: Icon; tone?: "default" | "good" | "warn" | "bad" }) {
  const toneCls = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : tone === "bad" ? "text-red-600 dark:text-red-400" : "text-ink";
  return (
    <div className="surface card-hover p-4">
      <div className="flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{label}</span>{I && <I size={15} className="text-ink-muted/60" />}</div>
      <div className={`mt-2 text-2xl font-bold tabular-nums tracking-tight ${toneCls}`}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-ink-muted">{hint}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, layoutId }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; layoutId: string }) {
  return (
    <div role="tablist" className="inline-flex flex-wrap gap-0.5 rounded-xl border border-line bg-muted p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} role="tab" aria-selected={active} onClick={() => onChange(o.value)} className={`relative rounded-lg px-3 py-1.5 text-xs font-semibold transition ${active ? "text-ink" : "text-ink-muted hover:text-ink"}`}>
            {active && <motion.span layoutId={layoutId} className="absolute inset-0 rounded-lg bg-elevated shadow-sm ring-1 ring-line" transition={{ type: "spring", stiffness: 480, damping: 36 }} />}
            <span className="relative flex items-center gap-1.5">{o.label}{o.count !== undefined && <span className="rounded-md bg-muted px-1.5 text-[10px] tabular-nums text-ink-muted">{o.count}</span>}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder, className = "" }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <label className={`relative block ${className}`}>
      <svg aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="w-full rounded-xl border border-line bg-elevated py-2 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-ink-muted/70 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10" />
    </label>
  );
}

export function EmptyState({ title, hint, icon: I = Inbox, action }: { title: string; hint: string; icon?: Icon; action?: ReactNode }) {
  return (
    <div className="surface flex flex-col items-center px-6 py-14 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-500"><I size={22} /></div>
      <h3 className="mt-4 text-base font-bold text-ink">{title}</h3>
      <p className="mt-1 max-w-md text-sm leading-6 text-ink-muted">{hint}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Horizontal stacked bar for a severity distribution. */
export function SeverityBar({ counts }: { counts: Record<string, number> }) {
  const total = SEVERITY_ORDER.reduce((a, k) => a + (counts[k] ?? 0), 0);
  if (!total) return <div className="h-2 rounded-full bg-muted" />;
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-muted">
      {SEVERITY_ORDER.map((k) => (counts[k] ?? 0) > 0 && <motion.div key={k} initial={{ width: 0 }} animate={{ width: `${((counts[k] ?? 0) / total) * 100}%` }} transition={{ duration: .7, ease: [.2, .8, .2, 1] }} className={SEVERITY[k].bar} title={`${SEVERITY[k].label}: ${counts[k]}`} />)}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-muted px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">{children}</kbd>;
}
export { CircleDot };
