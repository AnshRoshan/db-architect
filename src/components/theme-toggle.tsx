"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { AnimatePresence, motion } from "framer-motion";
import { Monitor, Moon, Sun } from "lucide-react";

const ORDER = ["light", "dark", "system"] as const;

export default function ThemeToggle({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span className={`inline-block h-9 w-9 rounded-full ${className}`} aria-hidden />;

  const current = (theme ?? "system") as (typeof ORDER)[number];
  const Icon = current === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun;
  const label = current === "system" ? `System (${resolvedTheme})` : current === "dark" ? "Dark" : "Light";
  function cycle() {
    const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
    const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
    if (doc.startViewTransition) doc.startViewTransition(() => setTheme(next));
    else setTheme(next);
  }
  if (compact) {
    return (
      <button onClick={cycle} aria-label={`Theme: ${label}. Click to change.`} title={`Theme: ${label}`} className={`relative grid h-9 w-9 place-items-center rounded-full border border-line bg-elevated/70 text-ink-muted transition hover:text-ink hover:border-indigo-400/60 ${className}`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={current + String(resolvedTheme)} initial={{ rotate: -90, opacity: 0, scale: .6 }} animate={{ rotate: 0, opacity: 1, scale: 1 }} exit={{ rotate: 90, opacity: 0, scale: .6 }} transition={{ duration: .25 }} className="grid place-items-center"><Icon size={16} /></motion.span>
        </AnimatePresence>
      </button>
    );
  }
  return (
    <div role="radiogroup" aria-label="Color theme" className={`inline-flex rounded-full border border-line bg-muted p-1 ${className}`}>
      {ORDER.map((t) => { const I = t === "system" ? Monitor : t === "dark" ? Moon : Sun; const active = current === t; return (
        <button key={t} role="radio" aria-checked={active} onClick={() => { const doc = document as Document & { startViewTransition?: (cb: () => void) => void }; if (doc.startViewTransition) doc.startViewTransition(() => setTheme(t)); else setTheme(t); }} className="relative grid h-8 w-9 place-items-center rounded-full text-ink-muted transition hover:text-ink" title={t}>
          {active && <motion.span layoutId="theme-pill" className="absolute inset-0 rounded-full bg-elevated shadow-sm ring-1 ring-line" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
          <I size={15} className={`relative ${active ? "text-ink" : ""}`} />
        </button>); })}
    </div>
  );
}
