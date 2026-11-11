"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileUp, Loader2, LockKeyhole, Play, ShieldCheck, Sparkles } from "lucide-react";
import { detectSqlDialect, ENGINES, engineLabel, type Engine } from "@/lib/engines";
import { FIXTURE_ECOMMERCE_SQL, FIXTURE_MONGO_JSON, FIXTURE_MYSQL_SQL, FIXTURE_SAAS_YAML, FIXTURE_SQLITE_SQL, FIXTURE_TARGET_SQL } from "@/lib/fixtures";

type Tab = "upload" | "postgres" | "mysql" | "mongodb";
type Conn = { id: string; name: string; engine: string; status: string; maskedConnection?: string; hasCredentials?: boolean };

const FIXTURES: { id: string; label: string; engine: Engine; file: string; content: string; desc: string }[] = [
  { id: "pg", label: "E-commerce", engine: "postgres", file: "ecommerce.sql", content: FIXTURE_ECOMMERCE_SQL, desc: "uuid keys · duplicate index · cascade FKs" },
  { id: "my", label: "Shop dump", engine: "mysql", file: "shop.sql", content: FIXTURE_MYSQL_SQL, desc: "MyISAM · utf8 · float money · KEY indexes" },
  { id: "lite", label: "Notes app", engine: "sqlite", file: "notes.sql", content: FIXTURE_SQLITE_SQL, desc: "AUTOINCREMENT · junction table" },
  { id: "mg", label: "Social app", engine: "mongodb", file: "social.json", content: FIXTURE_MONGO_JSON, desc: "mixed types · arrays · inferred refs" },
  { id: "yaml", label: "SaaS (YAML DSL)", engine: "postgres", file: "saas.yaml", content: FIXTURE_SAAS_YAML, desc: "tenants · audit log · weak FKs" },
  { id: "v2", label: "E-commerce v2 (target)", engine: "postgres", file: "ecommerce_v2.sql", content: FIXTURE_TARGET_SQL, desc: "import after v1 to try Diff & Migrate" },
];

function detect(name: string, content: string): string | null {
  const t = content.trimStart();
  if (!t) return null;
  if (/\.sql$/i.test(name) || /^(--|\/\*|create|pragma|begin|drop|set|use|alter)\b/i.test(t)) return detectSqlDialect(content);
  if (t.startsWith("[") || /"sample"|"collections"|"validator"/.test(content)) return "mongodb";
  const m = content.match(/^\s*engine:\s*(\w+)/m) ?? content.match(/"engine"\s*:\s*"(\w+)"/);
  return m ? m[1] : null;
}

export default function ConnectPanel({ projectId, onImported, setMsg }: { projectId: string; onImported: (scanId: string) => void; setMsg: (s: string) => void }) {
  const [tab, setTab] = useState<Tab>("upload");
  const [form, setForm] = useState({ host: "", port: "5432", database: "postgres", username: "", password: "", schema: "public", uri: "", sampleSize: "200", sslMode: "prefer" });
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [override, setOverride] = useState("auto");
  const [busy, setBusy] = useState<string | null>(null);
  const [conns, setConns] = useState<Conn[]>([]);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const detected = useMemo(() => (file ? detect(file.name, file.content) : null), [file]);
  const loadConns = useCallback(async () => {
    if (!projectId) return;
    const r = await fetch(`/api/v1/connections?projectId=${projectId}`).then((x) => x.json()).catch(() => ({ connections: [] }));
    setConns(r.connections ?? []);
  }, [projectId]);
  useEffect(() => { loadConns(); }, [loadConns]);

  function choose(t: Tab) {
    setTab(t);
    if (t === "postgres") setForm((f) => ({ ...f, port: "5432", database: f.database || "postgres" }));
    if (t === "mysql") setForm((f) => ({ ...f, port: "3306", database: f.database === "postgres" ? "" : f.database }));
  }
  const post = (url: string, body: unknown, method = "POST") => fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ error: "Could not reach the server" }));
  const liveBody = () => tab === "mongodb" ? { engine: "mongodb", uri: form.uri, database: form.database, sampleSize: Number(form.sampleSize) } : { engine: tab, host: form.host, port: Number(form.port), database: form.database, username: form.username, password: form.password, sslMode: form.sslMode, schemaSelection: form.schema };

  async function test() { setBusy("test"); const r = await post("/api/v1/connections/test", liveBody()); setBusy(null); setMsg(r.ok ? `✓ Connected${r.version ? ` · ${r.version}` : r.collections !== undefined ? ` · ${r.collections} collections` : ""} in ${r.latencyMs}ms` : `Connection failed: ${r.error ?? "unknown error"}`); }
  async function scan() { if (!projectId) return setMsg("Select a project first"); setBusy("scan"); const r = await post("/api/v1/scans", { projectId, ...liveBody() }); setBusy(null); if (r.scanId) { setMsg(`✓ Read-only ${engineLabel(r.engine)} scan complete`); onImported(r.scanId); } else setMsg(`Scan failed: ${r.error ?? "unknown error"}`); }
  async function save() { if (!projectId) return; setBusy("save"); const b = liveBody(); const r = await post("/api/v1/connections", { projectId, name: `${engineLabel(tab)} · ${tab === "mongodb" ? form.database || "cluster" : `${form.host}/${form.database}`}`, ...b }); setBusy(null); if (r.connection) { setMsg("✓ Connection saved with AES-256-GCM encrypted credentials"); loadConns(); } else setMsg(`Save failed: ${r.error}`); }
  async function doImport() {
    if (!projectId) return setMsg("Select a project first");
    if (!file?.content.trim()) return setMsg("Choose a file, paste a schema, or load a sample first");
    setBusy("import");
    const r = await post("/api/v1/import", { projectId, filename: file.name, content: file.content, label: file.name, ...(override !== "auto" ? { engine: override } : {}) });
    setBusy(null);
    if (r.scanId) { setMsg(`✓ Imported ${file.name} as ${engineLabel(r.engine)}${r.warnings?.length ? ` · ${r.warnings.length} note(s)` : ""}`); onImported(r.scanId); } else setMsg(`Import failed: ${r.error}`);
  }
  function onFile(e: React.ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => setFile({ name: f.name, content: String(rd.result ?? "") }); rd.readAsText(f); }
  async function testSaved(id: string) { setBusy(id); const r = await post("/api/v1/connections/test", { connectionId: id }); setBusy(null); loadConns(); setMsg(r.ok ? `✓ Healthy (${r.latencyMs}ms)` : `Connection failed: ${r.error ?? "unknown"}`); }
  async function scanSaved(id: string) { setBusy(id); const r = await post("/api/v1/scans", { projectId, connectionId: id }); setBusy(null); if (r.scanId) { setMsg("✓ Read-only scan complete"); onImported(r.scanId); } else setMsg(`Scan failed: ${r.error ?? "unknown"}`); }
  async function revoke(id: string) { if (!window.confirm("Revoke the stored credentials? Existing scans remain available.")) return; const r = await post("/api/v1/connections", { connectionId: id, action: "revoke" }, "PATCH"); if (r.connection) { setMsg("Credentials revoked"); loadConns(); } else setMsg(r.error ?? "Revoke failed"); }

  const input = "mt-1.5 w-full rounded-xl border border-line bg-elevated px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10";
  const tabs: { id: Tab; label: string; hint: string; color: string }[] = [
    { id: "upload", label: "Upload schema", hint: "SQL · YAML · JSON", color: "#6366f1" },
    { id: "postgres", label: "PostgreSQL", hint: "live, read-only", color: ENGINES.postgres.color },
    { id: "mysql", label: "MySQL", hint: "live, read-only", color: ENGINES.mysql.color },
    { id: "mongodb", label: "MongoDB", hint: "bounded sampling", color: ENGINES.mongodb.color },
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <div className="min-w-0 surface">
        <div className="grid grid-cols-2 gap-2 border-b border-line/60 p-3 sm:grid-cols-4">
          {tabs.map((t) => <button key={t.id} onClick={() => choose(t.id)} className={`rounded-xl border px-3 py-2.5 text-left transition ${tab === t.id ? "border-transparent bg-ink text-canvas shadow-md" : "border-line hover:border-slate-300"}`}><div className="flex items-center gap-2 text-sm font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: t.color }} />{t.label}</div><div className={`mt-0.5 text-[11px] ${tab === t.id ? "text-ink-muted" : "text-ink-muted"}`}>{t.hint}</div></button>)}
        </div>
        <div className="p-5">
          {tab === "upload" ? <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink-muted"><Sparkles size={13} /> Start with a sample</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{FIXTURES.map((f) => <button key={f.id} onClick={() => setFile({ name: f.file, content: f.content })} className={`rounded-xl border p-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40 ${file?.name === f.file ? "border-indigo-400 bg-indigo-50/60" : "border-line"}`}><div className="flex items-center gap-2 text-[13px] font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: ENGINES[f.engine].color }} />{f.label}<span className="ml-auto text-[10px] font-medium text-ink-muted">{ENGINES[f.engine].label}</span></div><div className="mt-1 text-[11px] text-ink-muted">{f.desc}</div></button>)}</div>
            </div>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line py-5 text-sm font-medium text-ink-muted hover:border-indigo-300 hover:bg-indigo-50/30"><FileUp size={18} /> Choose a .sql, .yaml or .json file<input type="file" accept=".sql,.yaml,.yml,.json" onChange={onFile} className="hidden" /></label>
            <textarea value={file?.content ?? ""} onChange={(e) => setFile({ name: file?.name ?? "schema.sql", content: e.target.value })} rows={13} spellCheck={false} placeholder="…or paste a CREATE TABLE script, a mysqldump / sqlite3 .schema output, a YAML/JSON schema, or a MongoDB sample document array" className="w-full rounded-xl bg-slate-950 p-4 font-mono text-xs leading-relaxed text-emerald-200 outline-none placeholder:text-ink-muted" />
            <div className="flex flex-wrap items-center gap-3">
              <input value={file?.name ?? ""} onChange={(e) => setFile({ name: e.target.value, content: file?.content ?? "" })} placeholder="filename.sql" className="w-44 rounded-xl border border-line px-3 py-2.5 text-sm outline-none focus:border-indigo-500" />
              <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs"><span className="text-ink-muted">Engine</span><select value={override} onChange={(e) => setOverride(e.target.value)} className="bg-transparent font-semibold outline-none"><option value="auto">Auto-detect</option><option value="postgres">PostgreSQL</option><option value="mysql">MySQL</option><option value="sqlite">SQLite</option><option value="mongodb">MongoDB</option></select>{override === "auto" && detected && <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700"><CheckCircle2 size={12} />{engineLabel(detected)}</span>}</div>
              <button disabled={busy !== null} onClick={doImport} className="ml-auto flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50">{busy === "import" ? <Loader2 size={16} className="animate-spin" /> : <Play size={15} />} Import & analyze</button>
            </div>
            <p className="text-[11px] leading-5 text-ink-muted">Max ~2.5 MB. INSERT/DROP/SET statements are skipped and summarized — never silently. SQLite is file-based, so it is imported from a schema dump.</p>
          </div> : tab === "mongodb" ? <div className="space-y-4">
            <label className="block text-xs font-semibold text-ink-muted">Connection URI (Atlas supported)<input value={form.uri} onChange={(e) => set("uri", e.target.value)} placeholder="mongodb+srv://readonly-user:••••@cluster0.example.mongodb.net" className={input + " font-mono"} /></label>
            <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-ink-muted">Database<input value={form.database === "postgres" ? "" : form.database} onChange={(e) => set("database", e.target.value)} className={input} /></label><label className="text-xs font-semibold text-ink-muted">Sample size per collection (10–1000)<input value={form.sampleSize} onChange={(e) => set("sampleSize", e.target.value)} className={input} /></label></div>
            <Actions busy={busy} test={test} save={save} scan={scan} scanLabel="Sample & analyze" />
            <p className="text-[11px] leading-5 text-ink-muted">Sampling is bounded and read-only; only field shapes are stored — never documents. Use a user with the <code>read</code> role.</p>
          </div> : <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-semibold text-ink-muted sm:col-span-2">Host<input value={form.host} onChange={(e) => set("host", e.target.value)} placeholder="db.example.com (private/loopback hosts need an allowlist entry)" className={input} /></label>
              <label className="text-xs font-semibold text-ink-muted">Port<input value={form.port} onChange={(e) => set("port", e.target.value)} className={input} /></label>
              <label className="text-xs font-semibold text-ink-muted">Database<input value={form.database} onChange={(e) => set("database", e.target.value)} className={input} /></label>
              <label className="text-xs font-semibold text-ink-muted">Username<input value={form.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" className={input} /></label>
              <label className="text-xs font-semibold text-ink-muted">Password<input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" className={input} /></label>
              {tab === "postgres" && <label className="text-xs font-semibold text-ink-muted">Schemas (comma-separated)<input value={form.schema} onChange={(e) => set("schema", e.target.value)} className={input} /></label>}
              <label className="text-xs font-semibold text-ink-muted">TLS<select value={form.sslMode} onChange={(e) => set("sslMode", e.target.value)} className={input}><option value="prefer">Prefer (try TLS)</option><option value="require">Require TLS</option><option value="disable">Disable</option></select></label>
            </div>
            <Actions busy={busy} test={test} save={save} scan={scan} scanLabel="Run read-only scan" />
            <p className="text-[11px] leading-5 text-ink-muted">{tab === "postgres" ? "Needs CONNECT and SELECT on pg_catalog / information_schema. pg_stat_* are optional — the analysis degrades honestly without them." : "Needs SELECT on information_schema for the chosen database. Row counts are InnoDB estimates."}</p>
          </div>}
        </div>
      </div>
      <div className="space-y-4">
        {conns.length > 0 && <div className="surface p-5"><div className="flex items-center justify-between"><h3 className="text-sm font-bold">Saved connections</h3><span className="text-[11px] text-ink-muted">{conns.length} encrypted</span></div><div className="mt-3 space-y-2">{conns.map((c) => <div key={c.id} className="rounded-xl border border-line/60 bg-muted p-3"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${c.status === "healthy" ? "bg-emerald-500" : c.status === "revoked" || c.status === "error" ? "bg-red-500" : "bg-slate-300"}`} /><b className="truncate text-xs">{c.name}</b><span className="ml-auto text-[10px] uppercase text-ink-muted">{c.engine}</span></div><div className="mt-1 truncate font-mono text-[10px] text-ink-muted">{c.maskedConnection}</div><div className="mt-2 flex gap-1.5"><button disabled={busy !== null || !c.hasCredentials} onClick={() => testSaved(c.id)} className="rounded-lg bg-elevated px-2 py-1 text-[11px] font-semibold ring-1 ring-line disabled:opacity-40">{busy === c.id ? "…" : "Test"}</button><button disabled={busy !== null || !c.hasCredentials} onClick={() => scanSaved(c.id)} className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40">Scan again</button>{c.hasCredentials && <button onClick={() => revoke(c.id)} className="ml-auto rounded-lg px-2 py-1 text-[11px] text-red-600 hover:bg-red-50">Revoke</button>}</div></div>)}</div></div>}
        <div className="rounded-2xl bg-slate-950 p-5 text-slate-200"><h3 className="flex items-center gap-2 text-sm font-semibold text-white"><LockKeyhole size={15} className="text-indigo-300" /> Connection security</h3><ul className="mt-3 space-y-1.5 text-[12px] text-slate-400"><li>• Read-only by default; analysis never writes to the source</li><li>• AES-256-GCM encrypted credentials, never returned by any API</li><li>• SSRF guard blocks metadata/private ranges unless allowlisted</li><li>• Mongo: shapes only — values are never stored</li><li>• Live data preview is masked, bounded and consent-gated</li></ul></div>
        <div className="surface p-5"><h3 className="flex items-center gap-2 text-sm font-bold"><ShieldCheck size={15} className="text-emerald-500" /> What happens next</h3><ol className="mt-3 space-y-2 text-[12px] text-ink-muted">{["Validate size, type and host", "Parse / introspect into the canonical model", "Run deterministic analysis rules", "Generate the ELK diagram layout", "Save an immutable schema version"].map((s, i) => <li key={s} className="flex gap-2.5"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold">{i + 1}</span>{s}</li>)}</ol></div>
      </div>
    </div>
  );
}

function Actions({ busy, test, save, scan, scanLabel }: { busy: string | null; test: () => void; save: () => void; scan: () => void; scanLabel: string }) {
  return <div className="flex flex-wrap gap-2"><button disabled={busy !== null} onClick={test} className="rounded-xl border border-line px-4 py-2.5 text-sm font-bold hover:bg-muted disabled:opacity-50">{busy === "test" ? "Testing…" : "Test connection"}</button><button disabled={busy !== null} onClick={save} className="rounded-xl border border-line px-4 py-2.5 text-sm font-bold hover:bg-muted disabled:opacity-50">Save encrypted</button><button disabled={busy !== null} onClick={scan} className="ml-auto flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">{busy === "scan" ? <Loader2 size={16} className="animate-spin" /> : <Play size={15} />}{scanLabel}</button></div>;
}
