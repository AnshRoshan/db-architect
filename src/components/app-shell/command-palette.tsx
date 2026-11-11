"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CornerDownLeft, Search } from "lucide-react";
import type { NavIcon } from "@/components/app-shell/sidebar";

export interface PaletteItem { id: string; label: string; hint?: string; group: string; icon: NavIcon; run: () => void }

export default function CommandPalette({ open, onClose, items }: { open: boolean; onClose: () => void; items: PaletteItem[] }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matching = needle ? items.filter((i) => `${i.label} ${i.group} ${i.hint ?? ""}`.toLowerCase().includes(needle)) : items;
    return matching.slice(0, 30);
  }, [items, q]);

  useEffect(() => { if (open) { setQ(""); setActive(0); setTimeout(() => inputRef.current?.focus(), 40); } }, [open]);
  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      else if (e.key === "Enter") { e.preventDefault(); const picked = results[active]; if (picked) { picked.run(); onClose(); } }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, results, active, onClose]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  const groups = useMemo(() => { const g = new Map<string, { item: PaletteItem; index: number }[]>(); results.forEach((item, index) => g.set(item.group, [...(g.get(item.group) ?? []), { item, index }])); return [...g]; }, [results]);

  return (
    <AnimatePresence>
      {open && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[90] flex items-start justify-center bg-slate-950/50 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <motion.div initial={{ opacity: 0, y: -12, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: .98 }} transition={{ type: "spring", stiffness: 420, damping: 34 }} role="dialog" aria-modal="true" aria-label="Command palette" className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-elevated shadow-2xl">
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <Search size={16} className="text-ink-muted" />
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search views, schemas, actions…" aria-label="Search commands" className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted/70" />
            <kbd className="rounded border border-line bg-muted px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">ESC</kbd>
          </div>
          <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
            {results.length === 0 && <p className="px-3 py-8 text-center text-sm text-ink-muted">No matches for “{q}”.</p>}
            {groups.map(([group, entries]) => <div key={group} className="mb-1">
              <div className="px-2.5 pb-1 pt-2 text-[9px] font-bold uppercase tracking-[.14em] text-ink-muted/70">{group}</div>
              {entries.map(({ item, index }) => { const Icon = item.icon; const isActive = index === active; return (
                <button key={item.id} data-index={index} onMouseEnter={() => setActive(index)} onClick={() => { item.run(); onClose(); }} className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition ${isActive ? "bg-indigo-500/10 text-ink" : "text-ink-muted hover:bg-muted"}`}>
                  <Icon size={15} className={isActive ? "text-indigo-500" : "text-ink-muted"} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="shrink-0 font-mono text-[10px] text-ink-muted">{item.hint}</span>}
                  {isActive ? <CornerDownLeft size={13} className="shrink-0 text-indigo-500" /> : <ArrowRight size={13} className="shrink-0 opacity-0" />}
                </button>); })}
            </div>)}
          </div>
          <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[10px] text-ink-muted"><span>↑↓ navigate</span><span>↵ open</span><span className="ml-auto">ESC close</span></div>
        </motion.div>
      </motion.div>}
    </AnimatePresence>
  );
}
