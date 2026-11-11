"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, CircleDashed, Clock, Rocket } from "lucide-react";
import { MATRIX_ENGINES, SPEC_ITEMS, SUPPORT_MATRIX, TOP_10, type Status, type Support } from "@/lib/roadmap";

const STATUS: Record<Status, { label: string; cls: string; Icon: typeof Clock }> = {
  shipped: { label: "Shipped", cls: "bg-emerald-50 text-emerald-700", Icon: CheckCircle2 },
  in_progress: { label: "In progress", cls: "bg-indigo-50 text-indigo-700", Icon: Rocket },
  next: { label: "Next up", cls: "bg-amber-50 text-amber-700", Icon: Clock },
  planned: { label: "Planned", cls: "bg-muted text-ink-muted", Icon: CircleDashed },
};
const SUP: Record<Support, [string, string]> = { full: ["●", "text-emerald-600"], partial: ["◐", "text-amber-500"], planned: ["○", "text-ink-muted"], none: ["—", "text-ink-muted/60"] };

function Pill({ s }: { s: Status }) { const { label, cls, Icon } = STATUS[s]; return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}><Icon size={11} />{label}</span>; }

export default function RoadmapPanel() {
  const [area, setArea] = useState("All");
  const areas = useMemo(() => ["All", ...new Set(SPEC_ITEMS.map((i) => i.area))], []);
  const items = SPEC_ITEMS.filter((i) => area === "All" || i.area === area);
  const done = SPEC_ITEMS.filter((i) => i.status === "shipped").length;
  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-[#101828] p-6 text-white">
        <div className="flex flex-wrap items-end gap-6"><div><div className="text-[11px] font-bold uppercase tracking-widest text-indigo-300">Product spec status</div><h2 className="mt-1 text-2xl font-semibold tracking-tight">{done} of {SPEC_ITEMS.length} spec items shipped</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">DB Architect is database-agnostic by design. We add engines in order of real-world usage and keep the canonical schema model engine-neutral.</p></div><div className="ml-auto w-64"><div className="h-2 overflow-hidden rounded-full bg-elevated/10"><motion.div initial={{ width: 0 }} animate={{ width: `${(done / SPEC_ITEMS.length) * 100}%` }} transition={{ duration: 1.1, ease: [.2, .8, .2, 1] }} className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-indigo-400" /></div><div className="mt-2 flex justify-between text-[11px] text-slate-400"><span>{SPEC_ITEMS.filter((i) => i.status === "next").length} next</span><span>{SPEC_ITEMS.filter((i) => i.status === "planned").length} planned</span></div></div></div>
      </section>

      <section className="surface p-5">
        <h3 className="text-sm font-bold">Top 10 priorities</h3><p className="mt-1 text-xs text-ink-muted">Ranked by user value × engineering leverage. We build the top few first and finish them properly.</p>
        <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: .05 } } }} className="mt-4 grid gap-3 lg:grid-cols-2">{TOP_10.map((t) => <motion.article variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} key={t.rank} className={`rounded-xl border p-4 ${t.status === "shipped" ? "border-emerald-100 bg-emerald-50/30" : "border-line/60"}`}><div className="flex items-start gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-900 text-xs font-bold text-white">{t.rank}</div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className="text-[13px] font-bold leading-5">{t.title}</h4><Pill s={t.status} /></div><p className="mt-1 text-xs leading-5 text-ink-muted">{t.why}</p><div className="mt-2 flex flex-wrap gap-1.5">{t.scope.map((s) => <span key={s} className="rounded-md bg-elevated px-2 py-0.5 text-[10px] text-ink-muted ring-1 ring-line">{s}</span>)}</div></div></div></motion.article>)}</motion.div>
      </section>

      <section className="surface p-5">
        <h3 className="text-sm font-bold">Engine support matrix</h3>
        <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[640px] text-xs"><thead><tr><th className="py-2 text-left font-semibold text-ink-muted">Capability</th>{MATRIX_ENGINES.map((e) => <th key={e} className="px-3 py-2 text-center font-semibold">{e}</th>)}</tr></thead><tbody>{SUPPORT_MATRIX.map((r) => <tr key={r.capability} className="border-t border-slate-50"><td className="py-2.5 text-ink-muted">{r.capability}</td>{r.values.map((v, i) => <td key={i} className={`px-3 text-center text-base ${SUP[v][1]}`}>{SUP[v][0]}</td>)}</tr>)}</tbody></table></div>
        <div className="mt-3 flex gap-5 text-[11px] text-ink-muted"><span className="text-emerald-600">● supported</span><span className="text-amber-500">◐ partial</span><span>○ planned</span><span>— not applicable</span></div>
      </section>

      <section className="surface p-5">
        <div className="flex flex-wrap items-center gap-2"><h3 className="mr-2 text-sm font-bold">Full specification</h3>{areas.map((a) => <button key={a} onClick={() => setArea(a)} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${area === a ? "bg-ink text-canvas" : "bg-muted text-ink-muted hover:bg-line"}`}>{a}</button>)}</div>
        <div className="mt-4 divide-y divide-line/60">{items.map((i) => <div key={i.id} className="flex flex-wrap items-center gap-3 py-2.5"><code className="w-16 shrink-0 text-[11px] text-ink-muted">{i.id}</code><span className="min-w-0 flex-1 text-[13px] font-medium">{i.title}{i.notes && <span className="ml-2 text-xs font-normal text-ink-muted">{i.notes}</span>}</span><span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold text-ink-muted">{i.priority}</span><Pill s={i.status} /></div>)}</div>
      </section>
    </div>
  );
}
