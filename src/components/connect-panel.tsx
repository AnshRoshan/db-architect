"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Boxes, CheckCircle2, FileUp, FolderTree, Loader2, LockKeyhole, Play, Plug, Radar, Save, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { detectSqlDialect, ENGINES, engineLabel, namespaceLabel, type Engine } from "@/lib/engines";
import { STORE_ROLES } from "@/lib/architecture";
import { EngineBadge, EngineIcon } from "@/components/engine-icon";
import { FIXTURE_ECOMMERCE_SQL, FIXTURE_MONGO_JSON, FIXTURE_MYSQL_SQL, FIXTURE_SAAS_YAML, FIXTURE_SQLITE_SQL, FIXTURE_TARGET_SQL } from "@/lib/fixtures";
import { FIXTURE_COMMERCE_MONGO_JSON, FIXTURE_MULTISCHEMA_SQL, FIXTURE_REDIS_JSON } from "@/lib/fixtures-polyglot";

type Tab = "upload" | "postgres" | "mysql" | "mongodb" | "redis";
type Conn = { id: string; name: string; engine: string; status: string; maskedConnection?: string; hasCredentials?: boolean; schemaSelection?: string };
type Namespace = { name: string; tables: number; views: number; owner?: string | null; keys?: number };
type Discovery = { kind: string; namespaces: Namespace[]; note?: string };
export type StoreOption = { id: string; name: string; engine: string; role: string };

const FIXTURES: { id: string; label: string; engine: Engine; file: string; content: string; desc: string; group: "system" | "single" }[] = [
  { id: "pgms", label: "Commerce core", engine: "postgres", file: "commerce_core.sql", content: FIXTURE_MULTISCHEMA_SQL, desc: "8 schemas · cross-schema FKs · a schema cycle", group: "system" },
  { id: "mgc", label: "Commerce content", engine: "mongodb", file: "commerce_content.json", content: FIXTURE_COMMERCE_MONGO_JSON, desc: "duplicated catalog · references into PostgreSQL", group: "system" },
  { id: "rd", label: "Commerce cache", engine: "redis", file: "commerce_cache.redis.json", content: FIXTURE_REDIS_JSON, desc: "sessions · caches · missing TTLs · big keys", group: "system" },
  { id: "pg", label: "E-commerce", engine: "postgres", file: "ecommerce.sql", content: FIXTURE_ECOMMERCE_SQL, desc: "uuid keys · duplicate index · cascade FKs", group: "single" },
  { id: "v2", label: "E-commerce v2", engine: "postgres", file: "ecommerce_v2.sql", content: FIXTURE_TARGET_SQL, desc: "import after v1 to try Diff & Migrate", group: "single" },
  { id: "my", label: "Shop dump", engine: "mysql", file: "shop.sql", content: FIXTURE_MYSQL_SQL, desc: "MyISAM · utf8 · float money", group: "single" },
  { id: "lite", label: "Notes app", engine: "sqlite", file: "notes.sql", content: FIXTURE_SQLITE_SQL, desc: "AUTOINCREMENT · junction table", group: "single" },
  { id: "mg", label: "Social app", engine: "mongodb", file: "social.json", content: FIXTURE_MONGO_JSON, desc: "mixed types · arrays · inferred refs", group: "single" },
  { id: "yaml", label: "SaaS (YAML DSL)", engine: "postgres", file: "saas.yaml", content: FIXTURE_SAAS_YAML, desc: "tenants · audit log · weak FKs", group: "single" },
];

function detect(name: string, content: string): string | null {
  const t = content.trimStart();
  if (!t) return null;
  if (/\.(redis|keys)(\.(json|txt))?$/i.test(name) || /"engine"\s*:\s*"redis"/.test(content.slice(0, 4000))) return "redis";
  if (/\.sql$/i.test(name) || /^(--|\/\*|create|pragma|begin|drop|set|use|alter)\b/i.test(t)) return detectSqlDialect(content);
  if (t.startsWith("[") || /"sample"|"collections"|"validator"/.test(content)) return "mongodb";
  const m = content.match(/^\s*engine:\s*(\w+)/m) ?? content.match(/"engine"\s*:\s*"(\w+)"/);
  return m ? m[1] : null;
}

const input = "mt-1.5 w-full rounded-xl border border-line bg-elevated px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-muted/60 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10";
const label = "text-xs font-semibold text-ink-muted";

export default function ConnectPanel({ projectId, stores, onImported, setMsg }: { projectId: string; stores: StoreOption[]; onImported: (scanId: string) => void; setMsg: (s: string) => void }) {
  const [tab, setTab] = useState<Tab>("upload");
  const [form, setForm] = useState({ host: "", port: "5432", database: "postgres", username: "", password: "", uri: "", sampleSize: "200", sslMode: "prefer", db: "0", maxKeys: "2000", match: "" });
  const [selection, setSelection] = useState("*");
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [override, setOverride] = useState("auto");
  const [busy, setBusy] = useState<string | null>(null);
  const [conns, setConns] = useState<Conn[]>([]);
  const [savedDiscovery, setSavedDiscovery] = useState<{ id: string; found: Discovery; picked: string[] } | null>(null);
  const [storeTarget, setStoreTarget] = useState("auto");
  const [newStore, setNewStore] = useState({ name: "", role: "service" });
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
    setDiscovery(null);
    setSelection(t === "postgres" ? "*" : "");
    if (t === "postgres") setForm((f) => ({ ...f, port: "5432", database: f.database || "postgres" }));
    if (t === "mysql") setForm((f) => ({ ...f, port: "3306", database: f.database === "postgres" ? "" : f.database }));
    if (t === "redis") setForm((f) => ({ ...f, port: "6379", sslMode: f.sslMode === "prefer" ? "disable" : f.sslMode }));
  }
  const post = (url: string, body: unknown, method = "POST") => fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ error: "Could not reach the server" }));
  const storePayload = () => (storeTarget === "auto" ? {} : storeTarget === "new" ? { storeName: newStore.name.trim() || undefined, storeRole: newStore.role } : { dataStoreId: storeTarget });
  const liveBody = () => tab === "mongodb" ? { engine: "mongodb", uri: form.uri, database: form.database === "postgres" ? "" : form.database, sampleSize: Number(form.sampleSize) }
    : tab === "redis" ? { engine: "redis", host: form.host, port: Number(form.port), username: form.username, password: form.password, db: Number(form.db) || 0, sslMode: form.sslMode, maxKeys: Number(form.maxKeys) || 2000, match: form.match, schemaSelection: selection }
    : { engine: tab, host: form.host, port: Number(form.port), database: form.database, username: form.username, password: form.password, sslMode: form.sslMode, schemaSelection: selection };
  const nsWord = tab === "upload" ? "schema" : namespaceLabel(tab);

  async function test() { setBusy("test"); const r = await post("/api/v1/connections/test", liveBody()); setBusy(null); setMsg(r.ok ? `✓ Connected${r.version ? ` · ${r.version}` : ""}${r.collections !== undefined ? ` · ${r.collections} collections` : ""}${r.keys !== undefined ? ` · ${Number(r.keys).toLocaleString()} keys` : ""} in ${r.latencyMs}ms` : `Connection failed: ${r.error ?? "unknown error"}`); }
  async function discover() {
    setBusy("discover");
    const r = await post("/api/v1/connections/schemas", liveBody());
    setBusy(null);
    if (!r.namespaces) return setMsg(`Discovery failed: ${r.error ?? "unknown error"}`);
    setDiscovery(r);
    if (tab === "postgres") setSelection("*");
    if (tab === "redis") setSelection(`db${Number(form.db) || 0}`);
    if (tab === "mysql") setSelection(form.database);
    setMsg(`✓ Found ${r.namespaces.length} ${r.kind}${r.namespaces.length === 1 ? "" : "s"}`);
  }
  async function scan() {
    if (!projectId) return setMsg("Select a project first");
    setBusy("scan");
    const r = await post("/api/v1/scans", { projectId, ...liveBody(), ...storePayload() });
    setBusy(null);
    if (r.scanId) { setMsg(`✓ Read-only ${engineLabel(r.engine)} scan complete · ${r.entities ?? 0} entities${Array.isArray(r.namespaces) && r.namespaces.length > 1 ? ` across ${r.namespaces.length} ${nsWord}s` : ""}`); onImported(r.scanId); } else setMsg(`Scan failed: ${r.error ?? "unknown error"}`);
  }
  async function save() {
    if (!projectId) return;
    setBusy("save");
    const b = liveBody();
    const name = `${engineLabel(tab)} · ${tab === "mongodb" ? form.database || "cluster" : tab === "redis" ? `${form.host}/db${Number(form.db) || 0}` : `${form.host}/${form.database}`}`;
    const r = await post("/api/v1/connections", { projectId, name, ...b });
    setBusy(null);
    if (r.connection) { setMsg("✓ Connection saved with AES-256-GCM encrypted credentials"); loadConns(); } else setMsg(`Save failed: ${r.error}`);
  }
  async function doImport() {
    if (!projectId) return setMsg("Select a project first");
    if (!file?.content.trim()) return setMsg("Choose a file, paste a schema, or load a sample first");
    setBusy("import");
    const r = await post("/api/v1/import", { projectId, filename: file.name, content: file.content, label: file.name, ...(override !== "auto" ? { engine: override } : {}), ...storePayload() });
    setBusy(null);
    if (r.scanId) { setMsg(`✓ Imported ${file.name} as ${engineLabel(r.engine)}${r.namespaces > 1 ? ` · ${r.namespaces} schemas` : ""}${r.warnings?.length ? ` · ${r.warnings.length} note(s)` : ""}`); onImported(r.scanId); } else setMsg(`Import failed: ${r.error}`);
  }
  function onFile(e: React.ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => setFile({ name: f.name, content: String(rd.result ?? "") }); rd.readAsText(f); }
  async function testSaved(id: string) { setBusy(id); const r = await post("/api/v1/connections/test", { connectionId: id }); setBusy(null); loadConns(); setMsg(r.ok ? `✓ Healthy (${r.latencyMs}ms)` : `Connection failed: ${r.error ?? "unknown"}`); }
  async function scanSaved(id: string, schemaSelection?: string) { setBusy(id); const r = await post("/api/v1/scans", { projectId, connectionId: id, ...(schemaSelection !== undefined ? { schemaSelection } : {}), ...storePayload() }); setBusy(null); if (r.scanId) { setSavedDiscovery(null); setMsg(`✓ Read-only scan complete · ${r.entities ?? 0} entities`); loadConns(); onImported(r.scanId); } else setMsg(`Scan failed: ${r.error ?? "unknown"}`); }
  async function discoverSaved(c: Conn) {
    if (savedDiscovery?.id === c.id) return setSavedDiscovery(null);
    setBusy(c.id);
    const r = await post("/api/v1/connections/schemas", { connectionId: c.id });
    setBusy(null);
    if (!r.namespaces) return setMsg(`Discovery failed: ${r.error ?? "unknown error"}`);
    const all = (r.namespaces as Namespace[]).map((n) => n.name);
    const current = (c.schemaSelection ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    setSavedDiscovery({ id: c.id, found: r, picked: !current.length || current.includes("*") ? all : all.filter((n) => current.includes(n)) });
  }
  async function revoke(id: string) { if (!window.confirm("Revoke the stored credentials? Existing scans remain available.")) return; const r = await post("/api/v1/connections", { connectionId: id, action: "revoke" }, "PATCH"); if (r.connection) { setMsg("Credentials revoked"); loadConns(); } else setMsg(r.error ?? "Revoke failed"); }

  // schema picker ⇄ selection text
  const allNames = discovery?.namespaces.map((n) => n.name) ?? [];
  const tokens = selection.split(",").map((t) => t.trim()).filter(Boolean);
  const isPicked = (name: string) => (tab === "postgres" && (!tokens.length || tokens.includes("*")) && !tokens.includes(`!${name}`)) || tokens.includes(name);
  function toggle(name: string) {
    const picked = allNames.filter((n) => (n === name ? !isPicked(n) : isPicked(n)));
    setSelection(tab === "postgres" && picked.length === allNames.length ? "*" : picked.join(","));
  }

  const tabs: { id: Tab; label: string; hint: string }[] = [
    { id: "upload", label: "Upload", hint: "SQL · YAML · JSON" },
    { id: "postgres", label: "PostgreSQL", hint: "every schema" },
    { id: "mysql", label: "MySQL", hint: "many databases" },
    { id: "mongodb", label: "MongoDB", hint: "sampled shapes" },
    { id: "redis", label: "Redis", hint: "key patterns" },
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <div className="surface min-w-0 overflow-hidden">
        <div className="grid grid-cols-2 gap-2 border-b border-line p-3 sm:grid-cols-5" role="tablist" aria-label="Schema source">
          {tabs.map((t) => { const active = tab === t.id; return (
            <button key={t.id} role="tab" aria-selected={active} onClick={() => choose(t.id)} className={`relative rounded-xl border px-3 py-2.5 text-left transition ${active ? "border-indigo-500/60 bg-indigo-500/10 shadow-sm" : "border-line hover:border-indigo-400/40 hover:bg-muted"}`}>
              {active && <motion.span layoutId="connect-tab" className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-indigo-500" />}
              <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">{t.id === "upload" ? <Upload size={15} className="text-indigo-500" /> : <EngineIcon engine={t.id} size={15} />}{t.label}</div>
              <div className="mt-0.5 truncate text-[11px] text-ink-muted">{t.hint}</div>
            </button>); })}
        </div>

        {/* which datastore does this schema belong to? */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-muted/40 px-4 py-2.5 text-xs">
          <Boxes size={14} className="text-indigo-500" /><span className="font-semibold text-ink">Datastore</span>
          <select value={storeTarget} onChange={(e) => setStoreTarget(e.target.value)} aria-label="Target datastore" className="rounded-lg border border-line bg-elevated px-2 py-1.5 text-xs text-ink outline-none focus:border-indigo-400">
            <option value="auto">Auto — match by connection or database name</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name} · {engineLabel(s.engine)}</option>)}
            <option value="new">New datastore…</option>
          </select>
          {storeTarget === "new" && <>
            <input value={newStore.name} onChange={(e) => setNewStore({ ...newStore, name: e.target.value })} placeholder="name (optional)" aria-label="New datastore name" className="w-40 rounded-lg border border-line bg-elevated px-2 py-1.5 text-xs text-ink outline-none focus:border-indigo-400" />
            <select value={newStore.role} onChange={(e) => setNewStore({ ...newStore, role: e.target.value })} aria-label="New datastore role" className="rounded-lg border border-line bg-elevated px-2 py-1.5 text-xs text-ink outline-none focus:border-indigo-400">{STORE_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
          </>}
          <span className="ml-auto hidden text-[11px] text-ink-muted lg:inline">A project is a system of datastores. Each import is a version of one of them.</span>
        </div>

        <div className="p-5">
          {tab === "upload" ? <div className="space-y-4">
            {(["system", "single"] as const).map((group) => <div key={group}>
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-ink-muted"><Sparkles size={13} className="text-indigo-500" />{group === "system" ? "Sample system — import all three, then open Architecture" : "Single-database samples"}</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{FIXTURES.filter((f) => f.group === group).map((f) => { const on = file?.name === f.file; return (
                <button key={f.id} onClick={() => setFile({ name: f.file, content: f.content })} aria-pressed={on} className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition ${on ? "border-indigo-400 bg-indigo-500/10" : "border-line hover:border-indigo-400/50 hover:bg-muted"}`}>
                  <EngineBadge engine={f.engine} size={30} />
                  <span className="min-w-0"><span className="block truncate text-[13px] font-semibold text-ink">{f.label}</span><span className="block text-[11px] leading-4 text-ink-muted">{f.desc}</span></span>
                </button>); })}</div>
            </div>)}
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line py-5 text-sm font-medium text-ink-muted transition hover:border-indigo-400/60 hover:bg-indigo-500/5 hover:text-ink"><FileUp size={18} /> Choose a .sql, .yaml or .json file<input type="file" accept=".sql,.yaml,.yml,.json,.txt,.redis,.keys" onChange={onFile} className="hidden" /></label>
            <textarea value={file?.content ?? ""} onChange={(e) => setFile({ name: file?.name ?? "schema.sql", content: e.target.value })} rows={12} spellCheck={false} aria-label="Schema content" placeholder="…or paste a CREATE TABLE script, a pg_dump / mysqldump / sqlite3 .schema output, a YAML/JSON schema, a MongoDB sample array, or Redis keys (key type ttl size per line)" className="scroll-thin w-full rounded-xl bg-slate-950 p-4 font-mono text-xs leading-relaxed text-emerald-200 outline-none ring-1 ring-white/5 placeholder:text-slate-500 focus:ring-indigo-400/50" />
            <div className="flex flex-wrap items-center gap-3">
              <input value={file?.name ?? ""} onChange={(e) => setFile({ name: e.target.value, content: file?.content ?? "" })} placeholder="filename.sql" aria-label="File name" className="w-52 rounded-xl border border-line bg-elevated px-3 py-2.5 text-sm text-ink outline-none focus:border-indigo-400" />
              <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs text-ink"><span className="text-ink-muted">Engine</span><select value={override} onChange={(e) => setOverride(e.target.value)} aria-label="Engine" className="bg-transparent font-semibold outline-none"><option value="auto">Auto-detect</option>{Object.values(ENGINES).map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</select>{override === "auto" && detected && <span className="flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={12} />{engineLabel(detected)}</span>}</div>
              <button disabled={busy !== null} onClick={doImport} className="ml-auto flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50">{busy === "import" ? <Loader2 size={16} className="animate-spin" /> : <Play size={15} />} Import &amp; analyze</button>
            </div>
            <p className="text-[11px] leading-5 text-ink-muted">Max ~2.5 MB. Schema-qualified names keep their schema; <code>CREATE SCHEMA</code> and <code>ALTER TABLE … ADD CONSTRAINT</code> (pg_dump style) are understood. INSERT/DROP/SET statements are skipped and summarized — never silently.</p>
          </div> : tab === "mongodb" ? <div className="space-y-4">
            <label className={`block ${label}`}>Connection URI (Atlas supported)<input value={form.uri} onChange={(e) => set("uri", e.target.value)} placeholder="mongodb+srv://readonly-user:••••@cluster0.example.mongodb.net" className={`${input} font-mono`} /></label>
            <div className="grid gap-4 sm:grid-cols-2"><label className={label}>Database<input value={form.database === "postgres" ? "" : form.database} onChange={(e) => set("database", e.target.value)} className={input} /></label><label className={label}>Sample size per collection (10–1000)<input value={form.sampleSize} onChange={(e) => set("sampleSize", e.target.value)} className={input} /></label></div>
            <Actions busy={busy} test={test} save={save} scan={scan} scanLabel="Sample & analyze" />
            <p className="text-[11px] leading-5 text-ink-muted">Sampling is bounded and read-only; only field shapes are stored — never documents. Use a user with the <code>read</code> role. Each MongoDB database is its own datastore.</p>
          </div> : <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={`${label} sm:col-span-2`}>Host<input value={form.host} onChange={(e) => set("host", e.target.value)} placeholder="db.example.com (private/loopback hosts need an allowlist entry)" className={input} /></label>
              <label className={label}>Port<input value={form.port} onChange={(e) => set("port", e.target.value)} inputMode="numeric" className={input} /></label>
              {tab === "redis" ? <label className={label}>Logical database (SELECT n)<input value={form.db} onChange={(e) => set("db", e.target.value)} inputMode="numeric" className={input} /></label> : <label className={label}>Database<input value={form.database} onChange={(e) => set("database", e.target.value)} className={input} /></label>}
              <label className={label}>Username{tab === "redis" && " (ACL, optional)"}<input value={form.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" className={input} /></label>
              <label className={label}>Password{tab === "redis" && " (optional)"}<input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" className={input} /></label>
              <label className={label}>TLS<select value={form.sslMode} onChange={(e) => set("sslMode", e.target.value)} className={input}>{tab !== "redis" && <option value="prefer">Prefer (try TLS)</option>}<option value="require">Require TLS</option><option value="disable">Disable</option></select></label>
              {tab === "redis" && <label className={label}>Keys to sample (100–20,000)<input value={form.maxKeys} onChange={(e) => set("maxKeys", e.target.value)} inputMode="numeric" className={input} /></label>}
              {tab === "redis" && <label className={`${label} sm:col-span-2`}>MATCH pattern (optional)<input value={form.match} onChange={(e) => set("match", e.target.value)} placeholder="* — or narrow it, e.g. session:*" className={`${input} font-mono`} /></label>}
            </div>

            {/* schema / database / logical-db picker */}
            <div className="rounded-xl border border-line bg-muted/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <FolderTree size={15} className="text-indigo-500" />
                <span className="text-sm font-bold text-ink">{tab === "postgres" ? "Schemas to scan" : tab === "mysql" ? "Databases to scan" : "Logical databases to sample"}</span>
                <button type="button" disabled={busy !== null} onClick={discover} className="ml-auto flex items-center gap-1.5 rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs font-semibold text-ink transition hover:border-indigo-400/60 disabled:opacity-50">{busy === "discover" ? <Loader2 size={13} className="animate-spin" /> : <Radar size={13} />}Discover {nsWord}s</button>
              </div>
              <AnimatePresence initial={false}>{discovery && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="mt-3 flex flex-wrap gap-1.5">{discovery.namespaces.map((n) => { const on = isPicked(n.name); return (
                  <button key={n.name} type="button" onClick={() => toggle(n.name)} aria-pressed={on} title={n.owner ? `owner: ${n.owner}` : undefined} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${on ? "border-indigo-400/70 bg-indigo-500/12 text-ink" : "border-line bg-elevated text-ink-muted hover:text-ink"}`}>
                    <span className={`grid h-3.5 w-3.5 place-items-center rounded border ${on ? "border-indigo-500 bg-indigo-500 text-white" : "border-line"}`}>{on && <CheckCircle2 size={10} />}</span>
                    <code className="font-mono font-semibold">{n.name}</code>
                    <span className="tabular-nums text-[10px] text-ink-muted">{n.keys !== undefined ? `${n.keys.toLocaleString()} keys` : `${n.tables} tbl${n.views ? ` · ${n.views} vw` : ""}`}</span>
                  </button>); })}</div>
                <div className="mt-2 flex items-center gap-3 text-[11px]"><button type="button" onClick={() => setSelection(tab === "postgres" ? "*" : allNames.join(","))} className="font-semibold text-indigo-600 hover:underline dark:text-indigo-300">Select all</button><button type="button" onClick={() => setSelection(allNames.filter((n) => discovery.namespaces.find((x) => x.name === n)!.tables + (discovery.namespaces.find((x) => x.name === n)!.keys ?? 0) > 0).join(","))} className="font-semibold text-indigo-600 hover:underline dark:text-indigo-300">Only non-empty</button>{discovery.note && <span className="text-ink-muted">{discovery.note}</span>}</div>
              </motion.div>}</AnimatePresence>
              <label className={`mt-3 block ${label}`}>Selection<input value={selection} onChange={(e) => setSelection(e.target.value)} placeholder={tab === "postgres" ? "* (every schema)" : tab === "mysql" ? "leave empty for the database above" : "leave empty for the logical database above"} className={`${input} font-mono`} /></label>
              <p className="mt-1.5 text-[11px] leading-5 text-ink-muted">{tab === "postgres" ? <>Use <code>*</code> for every non-system schema, a list (<code>public, billing</code>), a glob (<code>tenant_*</code>) or exclusions (<code>*, !audit</code>). Cross-schema foreign keys are kept.</> : tab === "mysql" ? <>List several databases (<code>shop, billing</code>) or globs to model them as one store with cross-database foreign keys.</> : <>List logical databases (<code>db0, db2</code>) or <code>*</code>. Keys are sampled with SCAN — never KEYS.</>}</p>
            </div>

            <Actions busy={busy} test={test} save={save} scan={scan} scanLabel={tab === "redis" ? "Sample & analyze" : "Run read-only scan"} />
            <p className="text-[11px] leading-5 text-ink-muted">{tab === "postgres" ? "Reads pg_catalog only: needs CONNECT on the database. Statistics are optional — the analysis degrades honestly without them." : tab === "mysql" ? "Needs SELECT on information_schema for the chosen databases. Row counts are InnoDB estimates." : "Read-only commands only (SCAN, TYPE, TTL, MEMORY USAGE, HSCAN, GETRANGE). Values are inspected for shape and discarded; nothing but key patterns is stored."}</p>
          </div>}
        </div>
      </div>

      <div className="space-y-4">
        {conns.length > 0 && <div className="surface p-5">
          <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-bold text-ink"><Plug size={15} className="text-indigo-500" />Saved connections</h3><span className="text-[11px] text-ink-muted">{conns.length} encrypted</span></div>
          <div className="mt-3 space-y-2">{conns.map((c) => { const open = savedDiscovery?.id === c.id; return (
            <div key={c.id} className="rounded-xl border border-line bg-muted/50 p-3">
              <div className="flex items-center gap-2"><EngineIcon engine={c.engine} size={14} /><b className="truncate text-xs text-ink">{c.name}</b><span className={`ml-auto h-2 w-2 shrink-0 rounded-full ${c.status === "healthy" ? "bg-emerald-500" : c.status === "revoked" || c.status === "error" ? "bg-red-500" : "bg-slate-400"}`} title={c.status} /></div>
              <div className="mt-1 truncate font-mono text-[10px] text-ink-muted">{c.maskedConnection}</div>
              {c.engine !== "mongodb" && c.schemaSelection && <div className="mt-1 truncate text-[10px] text-ink-muted">scans: <code className="font-mono text-ink">{c.schemaSelection}</code></div>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button disabled={busy !== null || !c.hasCredentials} onClick={() => testSaved(c.id)} className="rounded-lg bg-elevated px-2 py-1 text-[11px] font-semibold text-ink ring-1 ring-line disabled:opacity-40">{busy === c.id ? "…" : "Test"}</button>
                {c.engine !== "mongodb" && <button disabled={busy !== null || !c.hasCredentials} onClick={() => discoverSaved(c)} className="rounded-lg bg-elevated px-2 py-1 text-[11px] font-semibold text-ink ring-1 ring-line disabled:opacity-40">{namespaceLabel(c.engine) === "schema" ? "Schemas" : "Databases"}</button>}
                <button disabled={busy !== null || !c.hasCredentials} onClick={() => scanSaved(c.id)} className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40">Scan again</button>
                {c.hasCredentials && <button onClick={() => revoke(c.id)} className="ml-auto rounded-lg px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-500/10 dark:text-red-400">Revoke</button>}
              </div>
              {open && savedDiscovery && <div className="mt-2.5 border-t border-line pt-2.5">
                <div className="flex flex-wrap gap-1">{savedDiscovery.found.namespaces.map((n) => { const on = savedDiscovery.picked.includes(n.name); return <button key={n.name} onClick={() => setSavedDiscovery({ ...savedDiscovery, picked: on ? savedDiscovery.picked.filter((x) => x !== n.name) : [...savedDiscovery.picked, n.name] })} aria-pressed={on} className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${on ? "border-indigo-400/70 bg-indigo-500/12 text-ink" : "border-line text-ink-muted"}`}>{n.name} <span className="text-ink-muted">{n.keys ?? n.tables}</span></button>; })}</div>
                <button disabled={busy !== null || !savedDiscovery.picked.length} onClick={() => scanSaved(c.id, c.engine === "postgres" && savedDiscovery.picked.length === savedDiscovery.found.namespaces.length ? "*" : savedDiscovery.picked.join(","))} className="mt-2 w-full rounded-lg bg-indigo-600 py-1.5 text-[11px] font-bold text-white disabled:opacity-40">Scan {savedDiscovery.picked.length} selected</button>
              </div>}
            </div>); })}</div>
        </div>}
        <div className="rounded-2xl bg-slate-950 p-5 text-slate-200 ring-1 ring-white/5"><h3 className="flex items-center gap-2 text-sm font-semibold text-white"><LockKeyhole size={15} className="text-indigo-300" /> Connection security</h3><ul className="mt-3 space-y-2 text-[12px] leading-5 text-slate-400">{["Read-only by default; analysis never writes to the source", "AES-256-GCM encrypted credentials, never returned by any API", "SSRF guard blocks metadata/private ranges unless allowlisted", "MongoDB and Redis: shapes only — values are never stored", "Live data preview is masked, bounded and consent-gated"].map((t) => <li key={t} className="flex gap-2"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-400" />{t}</li>)}</ul></div>
        <div className="surface p-5"><h3 className="flex items-center gap-2 text-sm font-bold text-ink"><Save size={15} className="text-emerald-500" /> What happens next</h3><ol className="mt-3 space-y-2 text-[12px] text-ink-muted">{["Validate size, type and host", "Parse / introspect every selected schema into the canonical model", "Run deterministic analysis rules", "Attach the version to its datastore", "Re-check the architecture across all stores"].map((s, i) => <li key={s} className="flex gap-2.5"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold text-ink">{i + 1}</span>{s}</li>)}</ol></div>
      </div>
    </div>
  );
}

function Actions({ busy, test, save, scan, scanLabel }: { busy: string | null; test: () => void; save: () => void; scan: () => void; scanLabel: string }) {
  const ghost = "rounded-xl border border-line px-4 py-2.5 text-sm font-bold text-ink transition hover:bg-muted disabled:opacity-50";
  return <div className="flex flex-wrap gap-2"><button disabled={busy !== null} onClick={test} className={ghost}>{busy === "test" ? "Testing…" : "Test connection"}</button><button disabled={busy !== null} onClick={save} className={ghost}>{busy === "save" ? "Saving…" : "Save encrypted"}</button><button disabled={busy !== null} onClick={scan} className="ml-auto flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-500 disabled:opacity-50">{busy === "scan" ? <Loader2 size={16} className="animate-spin" /> : <Play size={15} />}{scanLabel}</button></div>;
}
