"use client";

import { useCallback, useEffect, useState } from "react";
import { Clipboard, KeyRound, Loader2, Plus, ShieldCheck, Trash2, UserRound, X } from "lucide-react";

type Member = { id: string; role: string; email: string; name: string; userId: string };
type Audit = { id: string; actor: string; action: string; entityType?: string; createdAt: string; detail?: Record<string, unknown> };

export default function WorkspaceSettings({ projectId, user, onToast }: { projectId: string; user: { name: string; email: string } | null; onToast: (message: string, kind?: "success" | "error") => void }) {
  const [data, setData] = useState<{ organization?: { name: string; slug: string; plan: string }; role?: string; members: Member[]; audit: Audit[] } | null>(null);
  const [tab, setTab] = useState<"members" | "security" | "audit">("members");
  const [invite, setInvite] = useState({ email: "", role: "viewer" });
  const [busy, setBusy] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [passwords, setPasswords] = useState({ currentPassword: "", password: "" });
  const load = useCallback(async () => {
    if (!projectId) return;
    const r = await fetch(`/api/v1/organizations?projectId=${projectId}`).then((x) => x.json()).catch(() => null);
    if (r?.members) setData(r); else if (r?.error) onToast(r.error, "error");
  }, [projectId, onToast]);
  useEffect(() => { load(); }, [load]);
  async function addMember(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setTemporaryPassword("");
    const r = await fetch("/api/v1/organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, ...invite }) }).then((x) => x.json());
    setBusy(false);
    if (r.ok) { setTemporaryPassword(r.temporaryPassword ?? ""); setInvite({ email: "", role: "viewer" }); onToast(r.temporaryPassword ? "Member created — copy the one-time password now" : "Member access updated"); load(); }
    else onToast(r.error ?? "Invite failed", "error");
  }
  async function remove(id: string) {
    if (!window.confirm("Remove this member from the workspace?")) return;
    const r = await fetch(`/api/v1/organizations?projectId=${projectId}&memberId=${id}`, { method: "DELETE" }).then((x) => x.json());
    if (r.ok) { onToast("Member removed"); load(); } else onToast(r.error ?? "Could not remove member", "error");
  }
  async function rotatePassword(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    const r = await fetch("/api/v1/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "password", ...passwords }) }).then((x) => x.json());
    setBusy(false);
    if (r.ok) { setPasswords({ currentPassword: "", password: "" }); onToast("Password updated securely"); } else onToast(r.error ?? "Password update failed", "error");
  }
  if (!projectId) return <div className="surface p-8 text-sm text-ink-muted">Select a project to manage its workspace.</div>;
  const canAdmin = data?.role === "owner" || data?.role === "admin";
  return <div className="space-y-4">
    <div className="surface p-5"><div className="flex flex-wrap items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600"><ShieldCheck size={21} /></div><div><h2 className="font-bold">{data?.organization?.name ?? "Workspace"}</h2><p className="text-xs text-ink-muted">{data?.organization?.plan ?? "team"} plan · your role: <b>{data?.role ?? "…"}</b></p></div><div className="ml-auto flex rounded-xl bg-muted p-1">{(["members", "security", "audit"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize ${tab === t ? "bg-elevated shadow-sm" : "text-ink-muted"}`}>{t}</button>)}</div></div></div>
    {tab === "members" && <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <section className="overflow-hidden surface"><div className="border-b border-line/60 px-5 py-4"><h3 className="text-sm font-bold">Workspace members</h3><p className="mt-1 text-xs text-ink-muted">Roles apply to every project in this organization.</p></div><div className="divide-y divide-line/60">{data?.members.map((m) => <div key={m.id} className="flex items-center gap-3 px-5 py-3.5"><div className="grid h-9 w-9 place-items-center rounded-full bg-muted text-ink-muted"><UserRound size={16} /></div><div className="min-w-0"><div className="truncate text-sm font-semibold">{m.name}{m.email === user?.email && " (you)"}</div><div className="truncate text-xs text-ink-muted">{m.email}</div></div><span className={`ml-auto rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ${m.role === "owner" ? "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" : "bg-muted text-ink-muted"}`}>{m.role}</span>{canAdmin && m.role !== "owner" && <button onClick={() => remove(m.id)} className="rounded-lg p-2 text-ink-muted hover:bg-red-500/10 hover:text-red-600"><Trash2 size={14} /></button>}</div>)}</div></section>
      <section className="surface p-5"><h3 className="text-sm font-bold">Invite or update a member</h3><p className="mt-1 text-xs leading-5 text-ink-muted">Existing users get immediate access. New users receive a one-time generated password.</p>{canAdmin ? <form onSubmit={addMember} className="mt-4 space-y-3"><input required type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="teammate@company.com" className="w-full rounded-xl border border-line px-3 py-2.5 text-sm outline-none focus:border-indigo-500" /><select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })} className="w-full rounded-xl border border-line bg-elevated px-3 py-2.5 text-sm">{["viewer", "developer", "architect", "admin"].map((r) => <option key={r}>{r}</option>)}</select><button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}Add member</button></form> : <p className="mt-4 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">Only owners and admins can manage members.</p>}{temporaryPassword && <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3"><div className="flex items-center justify-between text-xs font-bold text-emerald-700 dark:text-emerald-300"><span>One-time password</span><button onClick={() => setTemporaryPassword("")}><X size={13} /></button></div><div className="mt-2 flex items-center gap-2"><code className="flex-1 rounded-lg bg-elevated px-2 py-2 text-xs">{temporaryPassword}</code><button onClick={() => navigator.clipboard?.writeText(temporaryPassword)} className="p-2"><Clipboard size={15} /></button></div><p className="mt-2 text-[10px] text-emerald-700 dark:text-emerald-300">Shown once. Share it through a secure channel and ask the member to rotate it.</p></div>}</section>
    </div>}
    {tab === "security" && <div className="grid gap-4 lg:grid-cols-2"><section className="surface p-5"><div className="flex items-center gap-2"><KeyRound size={18} className="text-indigo-500" /><h3 className="text-sm font-bold">Rotate your password</h3></div><form onSubmit={rotatePassword} className="mt-4 space-y-3"><input required type="password" value={passwords.currentPassword} onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })} placeholder="Current password" className="w-full rounded-xl border border-line px-3 py-2.5 text-sm" /><input required minLength={10} type="password" value={passwords.password} onChange={(e) => setPasswords({ ...passwords, password: e.target.value })} placeholder="New password (10+ characters)" className="w-full rounded-xl border border-line px-3 py-2.5 text-sm" /><button disabled={busy} className="rounded-xl bg-ink px-4 py-2.5 text-sm font-bold text-white">Update password</button></form></section><section className="surface p-5"><h3 className="text-sm font-bold">Role permissions</h3><div className="mt-3 space-y-2 text-xs">{[["Viewer", "Read schemas, diagrams and reports"], ["Developer", "+ Import, scan, diff and generate migrations"], ["Architect", "+ Review and disposition findings"], ["Admin", "+ Manage connections and members"], ["Owner", "+ Delete projects and transfer ownership"]].map(([r, p]) => <div key={r} className="flex gap-3 rounded-lg bg-muted p-2.5"><b className="w-20">{r}</b><span className="text-ink-muted">{p}</span></div>)}</div><p className="mt-4 text-[11px] leading-5 text-ink-muted">Sessions expire after 7 days. Passwords use scrypt. Connection credentials use AES-256-GCM and are never returned by an API.</p></section></div>}
    {tab === "audit" && <section className="overflow-hidden surface"><div className="border-b border-line/60 px-5 py-4"><h3 className="text-sm font-bold">Project audit trail</h3><p className="mt-1 text-xs text-ink-muted">Sensitive operations, newest first.</p></div><div className="divide-y divide-line/60">{data?.audit.map((a) => <div key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-xs"><code className="rounded-md bg-muted px-2 py-1 font-semibold text-ink">{a.action}</code><span className="text-ink-muted">{a.actor}</span><span className="text-ink-muted">{a.entityType}</span><time className="ml-auto text-ink-muted">{new Date(a.createdAt).toLocaleString()}</time></div>)}{data?.audit.length === 0 && <p className="p-8 text-center text-sm text-ink-muted">No audit events yet.</p>}</div></section>}
  </div>;
}
