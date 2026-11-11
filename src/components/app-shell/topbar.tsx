"use client";

import { motion } from "framer-motion";
import { ChevronDown, ChevronRight, Command, Database, Menu, Plus, Search } from "lucide-react";
import ThemeToggle from "@/components/theme-toggle";

export interface ProjectOption { id: string; name: string; role?: string; organizationName?: string }
export interface ScanOption { id: string; engine: string; status: string }

export default function TopBar({ project, projects, onProjectChange, scans, scanId, onScanChange, onMenu, onAddSchema, onOpenPalette, onNewProject, view, canWrite }: {
  project?: ProjectOption; projects: ProjectOption[]; onProjectChange: (id: string) => void;
  scans: ScanOption[]; scanId: string; onScanChange: (id: string) => void;
  onMenu: () => void; onAddSchema: () => void; onOpenPalette: () => void; onNewProject: () => void; view: string; canWrite: boolean;
}) {
  return (
    <header className="glass sticky top-0 z-30 border-b border-line">
      <div className="flex h-[62px] items-center gap-2 px-3 sm:gap-3 sm:px-5">
        <button onClick={onMenu} className="rounded-lg p-2 text-ink-muted hover:bg-muted lg:hidden" aria-label="Open navigation"><Menu size={19} /></button>

        {/* breadcrumb */}
        <div className="hidden min-w-0 items-center gap-1.5 text-xs md:flex">
          <span className="truncate text-ink-muted">{project?.organizationName ?? "Workspace"}</span>
          <ChevronRight size={12} className="shrink-0 text-ink-muted/60" />
          <div className="relative">
            <select value={project?.id ?? ""} onChange={(e) => onProjectChange(e.target.value)} aria-label="Select project" className="max-w-[190px] appearance-none truncate rounded-lg bg-transparent py-1 pl-1 pr-6 text-xs font-semibold text-ink outline-none hover:bg-muted focus:ring-2 focus:ring-indigo-500/40">
              {projects.length === 0 && <option value="">No projects</option>}
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <ChevronDown size={12} className="pointer-events-none absolute right-1.5 top-1.5 text-ink-muted" />
          </div>
          <ChevronRight size={12} className="shrink-0 text-ink-muted/60" />
          <motion.span key={view} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="font-semibold text-ink">{view}</motion.span>
        </div>
        <div className="flex min-w-0 items-center gap-2 md:hidden">
          <Database size={15} className="shrink-0 text-indigo-500" />
          <span className="truncate text-sm font-semibold">{project?.name ?? "No project"}</span>
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <button onClick={onOpenPalette} className="hidden items-center gap-2 rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-ink-muted transition hover:border-indigo-400/50 hover:text-ink sm:flex" aria-label="Open command palette">
            <Search size={14} /><span className="hidden lg:inline">Search or jump to…</span><kbd className="hidden items-center gap-0.5 rounded border border-line bg-muted px-1 py-0.5 font-mono text-[10px] lg:flex"><Command size={9} />K</kbd>
          </button>
          <button onClick={onOpenPalette} className="rounded-lg border border-line p-2 text-ink-muted sm:hidden" aria-label="Search"><Search size={15} /></button>

          {scans.length > 0 && <div className="relative hidden sm:block">
            <select value={scanId} onChange={(e) => onScanChange(e.target.value)} aria-label="Select schema version" className="max-w-[170px] appearance-none truncate rounded-lg border border-line bg-elevated py-1.5 pl-2.5 pr-7 text-xs text-ink outline-none hover:border-indigo-400/50 xl:max-w-[240px]">
              <option value="">Latest version</option>
              {scans.map((s) => <option key={s.id} value={s.id}>{s.engine === "mongodb" ? "Mongo" : s.engine === "mysql" ? "MySQL" : s.engine === "sqlite" ? "SQLite" : "Postgres"} · {s.id.slice(0, 6)} · {s.status}</option>)}
            </select>
            <ChevronDown size={12} className="pointer-events-none absolute right-2 top-2 text-ink-muted" />
          </div>}

          <ThemeToggle compact />
          <button onClick={onNewProject} className="hidden rounded-lg border border-line p-2 text-ink-muted transition hover:text-ink lg:block" title="New project" aria-label="New project"><Plus size={15} /></button>
          {canWrite && <button onClick={onAddSchema} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-2 text-xs font-bold text-white shadow-sm shadow-indigo-600/20 transition hover:bg-indigo-500"><Plus size={14} /><span className="hidden sm:inline">Add schema</span></button>}
        </div>
      </div>
      {(project?.role || scans.length > 0) && <div className="flex items-center gap-3 border-t border-line/60 px-5 py-1 text-[10px] text-ink-muted"><span className="capitalize">{project?.role ?? "member"}</span><span className="text-ink-muted/40">·</span><span>{scans.length} schema version{scans.length === 1 ? "" : "s"}</span>{scanId && <><span className="text-ink-muted/40">·</span><span className="font-mono">{scanId.slice(0, 8)}</span></>}</div>}
    </header>
  );
}
