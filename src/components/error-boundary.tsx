"use client";

import React from "react";
import Link from "next/link";
import { Home, Loader2, RefreshCw, ShieldAlert } from "lucide-react";

interface State { error: Error | null }

/**
 * Prevents a rendering exception from blanking the app — the class of failure
 * that previously looked to users like an unexplained "logout".
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[db-architect] render error", error, info.componentStack);
  }
  componentWillUnmount() { if (this.retryTimer) clearTimeout(this.retryTimer); }
  retry = () => {
    this.setState({ error: null });
    this.retryTimer = setTimeout(() => { /* children re-render with fresh state */ }, 0);
  };
  render() {
    if (!this.state.error) return this.props.children;
    const msg = this.state.error.message?.slice(0, 240) ?? "Unknown error";
    return (
      <div className="grid min-h-screen place-items-center bg-canvas px-6 text-center">
        <div className="surface max-w-md p-8">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-amber-500/10 text-amber-500"><ShieldAlert size={22} /></div>
          <h1 className="mt-4 text-lg font-bold text-ink">Something misfired in the interface</h1>
          <p className="mt-2 text-sm leading-6 text-ink-muted">Your work, sessions and schemas are safe. This is a rendering glitch, not your data.</p>
          <pre className="surface-muted mt-4 max-h-24 overflow-auto rounded-lg p-3 text-left font-mono text-[10px] text-ink-muted">{msg}</pre>
          <div className="mt-5 flex justify-center gap-2">
            <button onClick={this.retry} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-500"><RefreshCw size={15} />Reload view</button>
            <Link href="/" className="flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-bold"><Home size={15} />Home</Link>
          </div>
        </div>
      </div>
    );
  }
}

export function SuspenseFallback() {
  return <div className="flex h-64 items-center justify-center gap-3 text-sm text-ink-muted"><Loader2 size={17} className="animate-spin" />Loading…</div>;
}
