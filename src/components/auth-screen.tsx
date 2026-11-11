"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import ThemeToggle from "@/components/theme-toggle";
import { setToken } from "@/lib/client-session";
import { ArrowRight, Database, Eye, EyeOff, GitBranch, Loader2, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";

export type AuthUser = { id: string; email: string; name: string; token?: string };

export default function AuthScreen({ onAuthenticated }: { onAuthenticated: (user?: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", workspace: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/v1/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mode, ...form }),
      }).then((x) => x.json());

      if (r.user) {
        if (r.token) setToken(r.token);
        onAuthenticated({ ...r.user, token: r.token });
      } else {
        setError(r.error ?? "Authentication failed");
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function enterDemo() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/v1/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "demo" }) }).then((x) => x.json());
      if (r.user) { if (r.token) setToken(r.token); onAuthenticated({ ...r.user, token: r.token }); }
      else setError(r.error ?? "Could not open the demo workspace");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-xl border border-line bg-elevated px-3.5 py-3 text-sm text-ink outline-none transition placeholder:text-ink-muted focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10";

  return (
    <main className="grid min-h-screen bg-canvas lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-[#0b1120] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="aurora absolute -right-32 -top-32 h-96 w-96 rounded-full bg-indigo-600/25 blur-3xl" />
        <div className="aurora-2 absolute -bottom-40 -left-20 h-96 w-96 rounded-full bg-violet-600/15 blur-3xl" />
        <div className="dot-grid absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" style={{ ["--grid-dot" as string]: "#1f2a44" }} />
        <div className="relative flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500">
            <Database size={21} />
          </div>
          <div>
            <div className="font-bold">DB Architect</div>
            <div className="text-xs text-slate-400">Database architecture intelligence</div>
          </div>
        </div>
        <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.1, delayChildren: 0.1 } } }} className="relative max-w-xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-400/10 px-3 py-1 text-xs text-indigo-200">
            <Sparkles size={13} /> Understand before you optimize
          </div>
          <motion.h1 variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }} className="text-5xl font-semibold leading-[1.08] tracking-tight">
            Your database,<br /><span className="text-gradient">made legible.</span>
          </motion.h1>
          <motion.p variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } }} className="mt-6 max-w-lg text-lg leading-8 text-slate-400">
            Introspect PostgreSQL, MySQL, SQLite and MongoDB, explore every relationship, review evidence-backed design findings, prepare safe migrations, and plan moves between engines.
          </motion.p>
          <div className="mt-10 grid grid-cols-3 gap-5">
            {[[GitBranch, "Living diagrams", "ELK layouts you can edit"], [ShieldCheck, "Evidence first", "No invented performance claims"], [LockKeyhole, "Safe by default", "Read-only, encrypted connections"]].map(([Icon, title, text]) => {
              const I = Icon as typeof GitBranch;
              return (
                <motion.div variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }} key={String(title)}>
                  <I size={19} className="text-indigo-300" />
                  <div className="mt-3 text-sm font-semibold">{String(title)}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-400">{String(text)}</div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
        <div className="relative text-xs text-slate-400">Schema metadata only by default · Nothing executes against your database</div>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }} className="w-full max-w-md">
          <div className="mb-6 flex items-center justify-between">
            <Link href="/" className="text-xs font-medium text-ink-muted hover:text-ink">← Back to home</Link>
            <ThemeToggle compact />
          </div>
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600 text-white">
              <Database size={20} />
            </div>
            <span className="font-bold">DB Architect</span>
          </div>

          <div className="mb-7 flex rounded-xl bg-muted p-1">
            <button
              onClick={() => { setMode("login"); setError(""); }}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold ${mode === "login" ? "bg-elevated text-ink shadow-sm" : "text-ink-muted"}`}
            >
              Sign in
            </button>
            <button
              onClick={() => { setMode("signup"); setError(""); }}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold ${mode === "signup" ? "bg-elevated text-ink shadow-sm" : "text-ink-muted"}`}
            >
              Create account
            </button>
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-ink">
            {mode === "login" ? "Welcome back" : "Create your workspace"}
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            {mode === "login" ? "Sign in to your architecture workspace." : "A private workspace and starter project will be created for you."}
          </p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            {mode === "signup" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-semibold text-ink-muted">
                  Your name
                  <input
                    required
                    minLength={2}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={input + " mt-1.5"}
                    placeholder="Ada Lovelace"
                  />
                </label>
                <label className="text-xs font-semibold text-ink-muted">
                  Workspace
                  <input
                    value={form.workspace}
                    onChange={(e) => setForm({ ...form, workspace: e.target.value })}
                    className={input + " mt-1.5"}
                    placeholder="Platform team"
                  />
                </label>
              </div>
            )}
            <label className="block text-xs font-semibold text-ink-muted">
              Work email
              <input
                required
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={input + " mt-1.5"}
                placeholder="you@company.com"
              />
            </label>
            <label className="block text-xs font-semibold text-ink-muted">
              Password
              <div className="relative mt-1.5">
                <input
                  required
                  minLength={mode === "signup" ? 10 : 1}
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className={input + " pr-11"}
                  placeholder={mode === "signup" ? "At least 10 characters" : "Your password"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-3 text-ink-muted"
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            {error && (
              <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}
            <button
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500 disabled:opacity-60"
            >
              {busy ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={17} className="animate-spin" /> Entering workspace…
                </span>
              ) : (
                <>
                  {mode === "login" ? "Sign in securely" : "Create account & workspace"}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">or</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <button
            onClick={enterDemo}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-elevated py-3 text-sm font-bold text-ink transition hover:border-indigo-500/30 hover:bg-indigo-500/10 disabled:opacity-60"
          >
            {busy ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={16} className="text-indigo-500" />} Explore the demo workspace
          </button>
          <p className="mt-2 text-center text-[11px] text-ink-muted">A separate sample workspace with a pre-analyzed schema</p>

          <div className="mt-7 flex items-center justify-center gap-2 text-xs text-ink-muted">
            <LockKeyhole size={13} /> Passwords hashed with scrypt · HTTP-only expiring sessions
          </div>
        </motion.div>
      </section>
    </main>
  );
}
