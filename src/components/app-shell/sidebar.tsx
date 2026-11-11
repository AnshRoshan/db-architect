"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ChevronLeft, Database, LogOut, PanelLeftClose, PanelLeftOpen, Plus, ShieldCheck, X } from "lucide-react";
import ThemeToggle from "@/components/theme-toggle";

export type NavIcon = React.ComponentType<{ size?: number; className?: string }>;
export interface NavItem { id: string; label: string; icon: NavIcon; badge?: number; isNew?: boolean }
export interface NavSection { title: string; ids: string[] }

export default function Sidebar({ items, sections, active, onNavigate, collapsed, onCollapse, mobileOpen, onCloseMobile, projectName, orgName, user, onSignOut, onNewProject }: {
  items: NavItem[]; sections: NavSection[]; active: string; onNavigate: (id: string) => void;
  collapsed: boolean; onCollapse: () => void; mobileOpen: boolean; onCloseMobile: () => void;
  projectName?: string; orgName?: string; user: { name: string; email: string } | null;
  onSignOut: () => void; onNewProject: () => void;
}) {
  const byId = new Map(items.map((i) => [i.id, i]));
  return (
    <aside className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-[#0c1322] text-white transition-[width,transform] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] dark:border-r dark:border-white/5 dark:bg-[#070b14] lg:translate-x-0 ${collapsed ? "w-[76px]" : "w-[252px]"} ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
      {/* brand */}
      <div className={`flex h-[68px] shrink-0 items-center gap-3 border-b border-white/[.06] ${collapsed ? "justify-center px-2" : "px-4"}`}>
        <Link href="/" title="DB Architect home" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-950/50"><Database size={18} /></Link>
        {!collapsed && <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold tracking-tight">DB Architect</div><div className="truncate text-[10px] text-slate-500">{orgName ?? "Workspace"}</div></div>}
        <button onClick={onCloseMobile} className="text-slate-400 lg:hidden" aria-label="Close navigation"><X size={17} /></button>
        {!collapsed && <button onClick={onCollapse} className="hidden rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white lg:block" title="Collapse sidebar" aria-label="Collapse sidebar"><PanelLeftClose size={16} /></button>}
      </div>

      {/* project + action */}
      <div className={`shrink-0 ${collapsed ? "px-2 py-3" : "px-3 pb-2 pt-3"}`}>
        {collapsed ? (
          <button onClick={onNewProject} title="New project" className="grid h-10 w-full place-items-center rounded-xl border border-white/10 bg-white/5 text-indigo-300 hover:bg-white/10"><Plus size={16} /></button>
        ) : (
          <>
            <div className="rounded-xl border border-white/[.07] bg-white/[.04] p-2.5">
              <div className="text-[9px] font-bold uppercase tracking-[.14em] text-slate-500">Project</div>
              <div className="mt-0.5 truncate text-[13px] font-semibold" title={projectName}>{projectName ?? "No project"}</div>
            </div>
            <button onClick={onNewProject} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2 text-xs font-semibold text-slate-300 transition hover:border-indigo-400/40 hover:bg-white/10 hover:text-white"><Plus size={14} className="text-indigo-300" /> New project</button>
          </>
        )}
      </div>

      {/* nav */}
      <nav className="scroll-thin flex-1 space-y-3 overflow-y-auto px-2 pb-2 pt-1" aria-label="Main">
        {sections.map((section) => (
          <div key={section.title}>
            {!collapsed && <div className="px-2.5 pb-1.5 text-[9px] font-bold uppercase tracking-[.16em] text-slate-600">{section.title}</div>}
            <div className="space-y-0.5">
              {section.ids.map((id) => {
                const item = byId.get(id);
                if (!item) return null;
                const Icon = item.icon;
                const isActive = active === id;
                return (
                  <button key={id} onClick={() => onNavigate(id)} title={collapsed ? item.label : undefined} aria-current={isActive ? "page" : undefined}
                    className={`group relative flex w-full items-center rounded-xl py-2.5 text-[13px] font-medium transition ${collapsed ? "justify-center px-0" : "gap-2.5 px-2.5"} ${isActive ? "text-white" : "text-slate-400 hover:bg-white/[.06] hover:text-slate-100"}`}>
                    {isActive && <motion.span layoutId="sidebar-active" className="absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-500/25 to-violet-500/10 ring-1 ring-inset ring-indigo-400/25" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
                    {isActive && !collapsed && <motion.span layoutId="sidebar-bar" className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-indigo-400" />}
                    <Icon size={17} className={`relative shrink-0 ${isActive ? "text-indigo-300" : "text-slate-500 group-hover:text-slate-300"}`} />
                    {!collapsed && <span className="relative truncate">{item.label}</span>}
                    {!collapsed && item.badge ? <span className="relative ml-auto rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">{item.badge}</span> : null}
                    {!collapsed && !item.badge && item.isNew ? <span className="relative ml-auto rounded-full bg-indigo-400/15 px-1.5 py-0.5 text-[9px] font-bold text-indigo-300">NEW</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* trust card */}
      {!collapsed && <div className="mx-2 mb-2 rounded-xl border border-emerald-400/15 bg-emerald-400/[.06] p-2.5"><div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-300"><ShieldCheck size={12} />Read-only analysis</div><p className="mt-1 text-[10px] leading-4 text-slate-500">Credentials encrypted · tenant isolated · migrations reviewed</p></div>}

      {/* theme + user */}
      <div className="shrink-0 border-t border-white/[.06] p-2">
        <div className={`mb-2 flex items-center rounded-xl bg-white/[.04] ${collapsed ? "justify-center py-1.5" : "justify-between px-2 py-1.5"}`}>
          {!collapsed && <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Theme</span>}
          <ThemeToggle compact className="!h-7 !w-7 !border-white/10 !bg-white/5 !text-slate-300 hover:!text-white" />
        </div>
        <div className={`flex items-center gap-2 rounded-xl p-1.5 ${collapsed ? "justify-center" : ""}`}>
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 text-xs font-bold text-white">{user?.name.slice(0, 1).toUpperCase() ?? "?"}</div>
          {!collapsed && <><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{user?.name}</div><div className="truncate text-[10px] text-slate-500">{user?.email}</div></div><button onClick={onSignOut} title="Sign out" aria-label="Sign out" className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/15 hover:text-red-300"><LogOut size={15} /></button></>}
        </div>
        {collapsed && <button onClick={onCollapse} title="Expand sidebar" aria-label="Expand sidebar" className="mt-1 grid w-full place-items-center rounded-lg py-1.5 text-slate-500 hover:bg-white/10 hover:text-white"><PanelLeftOpen size={15} /></button>}
      </div>
      {!collapsed && <button onClick={onCollapse} className="hidden" aria-hidden><ChevronLeft size={12} /></button>}
    </aside>
  );
}
