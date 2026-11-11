"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { setToken } from "@/lib/client-session";

export default function DemoButton({ className, children }: { className?: string; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/v1/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "demo" }) }).then((x) => x.json());
      if (!r?.user) { setBusy(false); setError(r?.error ?? "Could not open the demo"); return; }
      if (r.token) setToken(r.token);
      window.location.assign("/app");
    } catch {
      setBusy(false);
      setError("Could not reach the server");
    }
  }

  return (
    <span className="inline-flex flex-col items-start">
      <button onClick={start} disabled={busy} className={className}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : null}
        {children}
      </button>
      {error && <span role="alert" className="mt-2 text-xs text-red-400">{error}</span>}
    </span>
  );
}
