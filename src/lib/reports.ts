import { SchemaModel, modelStats } from "./schema-model";
import { Finding, AnalysisSummary } from "./analysis";
import { SchemaDiff } from "./diff-migrate";

export function buildMarkdownReport(
  project: string,
  model: SchemaModel,
  findings: Finding[],
  summary: AnalysisSummary,
  scanMeta: { id: string; createdAt: string; engine: string }
): string {
  const st = modelStats(model);
  const L: string[] = [];
  L.push(`# DB Architect Report — ${project}`);
  L.push(``);
  L.push(`- Database: \`${model.database}\` (${model.engine}${model.version ? ` ${model.version}` : ""})`);
  L.push(`- Scan: \`${scanMeta.id}\` at ${scanMeta.createdAt}`);
  L.push(`- Entities: ${st.entities} · Fields: ${st.fields} · Indexes: ${st.indexes} · Relationships: ${st.relationships}`);
  L.push(`- Design score (heuristic): **${summary.designScore}/100** — schema-evidence blend, not a performance guarantee.`);
  L.push(``);
  L.push(`## Limitations`);
  for (const l of summary.limitations) L.push(`- ${l}`);
  L.push(``);
  L.push(`## Entity inventory`);
  for (const e of model.entities) {
    L.push(`### ${e.name} (${e.kind})`);
    if (e.comment) L.push(`> ${e.comment}`);
    L.push(`| Field | Type | Null | Default | Notes |`);
    L.push(`|---|---|---|---|---|`);
    for (const f of e.fields) {
      const notes = [f.isPrimaryKey ? "PK" : "", f.isUnique ? "UQ" : "", f.presence !== undefined ? `${Math.round((f.presence ?? 0) * 100)}% present` : ""].filter(Boolean).join(" ");
      L.push(`| ${f.name} | ${f.type} | ${f.nullable ? "yes" : "no"} | ${f.defaultValue ?? "—"} | ${notes} |`);
    }
    if (e.indexes.length) {
      L.push(``);
      L.push(`Indexes: ${e.indexes.map((i) => `\`${i.name}\` (${i.columns.join(", ")})${i.unique ? " UNIQUE" : ""} [${i.method ?? "btree"}]`).join("; ")}`);
    }
    if (e.constraints.length) {
      L.push(`Constraints: ${e.constraints.map((c) => `\`${c.name}\` ${c.kind} (${c.columns.join(", ")})`).join("; ")}`);
    }
    L.push(``);
  }
  L.push(`## Relationships`);
  if (!model.relationships.length) L.push(`_None detected._`);
  for (const r of model.relationships) {
    L.push(`- ${r.fromEntity} (${r.fromColumns.join(", ")}) → ${r.toEntity} (${r.toColumns.join(", ")}) · ${r.cardinality} · ${r.provenance}`);
  }
  L.push(``);
  L.push(`## Findings (${findings.length})`);
  for (const f of findings) {
    L.push(`### [${f.severity.toUpperCase()}] ${f.title} — ${f.object}`);
    L.push(`- Rule: \`${f.ruleId}\` · evidence: ${f.evidenceLevel} · confidence: ${f.confidence}%${f.requiresWorkload ? " · needs workload validation" : ""}`);
    L.push(`- Explanation: ${f.explanation}`);
    L.push(`- Recommendation: ${f.recommendation}`);
    if (f.tradeoff) L.push(`- Trade-off: ${f.tradeoff}`);
    if (f.limitations.length) L.push(`- Limitations: ${f.limitations.join("; ")}`);
    L.push(``);
  }
  return L.join("\n");
}

export function buildHtmlReport(
  project: string,
  model: SchemaModel,
  findings: Finding[],
  summary: AnalysisSummary,
  scanMeta: { id: string; createdAt: string; engine: string },
  svg: string,
  diff?: SchemaDiff | null
): string {
  const st = modelStats(model);
  const sevColor = (s: string) =>
    ({ critical: "#dc2626", high: "#ea580c", medium: "#ca8a04", low: "#0284c7", info: "#64748b" })[s] ?? "#64748b";
  const findingsHtml = findings
    .map(
      (f) => `<article style="border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin:10px 0;background:#fff">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span style="background:${sevColor(f.severity)};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;text-transform:uppercase">${f.severity}</span>
        <strong>${escapeHtml(f.title)}</strong>
        <code style="font-size:11px;color:#64748b">${f.ruleId}</code>
      </div>
      <div style="font-size:12px;color:#475569;margin-top:4px">${escapeHtml(f.object)} · evidence: ${f.evidenceLevel} · confidence ${f.confidence}%${f.requiresWorkload ? " · needs workload validation" : ""}</div>
      <p style="font-size:13px;margin:8px 0 4px"><b>Why:</b> ${escapeHtml(f.explanation)}</p>
      <p style="font-size:13px;margin:4px 0"><b>Do:</b> ${escapeHtml(f.recommendation)}</p>
      ${f.tradeoff ? `<p style="font-size:12px;color:#64748b"><b>Trade-off:</b> ${escapeHtml(f.tradeoff)}</p>` : ""}
      ${f.limitations.length ? `<p style="font-size:12px;color:#64748b"><b>Limits:</b> ${escapeHtml(f.limitations.join("; "))}</p>` : ""}
      <details style="font-size:12px"><summary>Evidence (JSON)</summary><pre>${escapeHtml(JSON.stringify(f.evidence, null, 2))}</pre></details>
    </article>`
    )
    .join("\n");
  const entitiesHtml = model.entities
    .map(
      (e) => `<section style="border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin:10px 0;background:#fff">
      <h3 style="margin:0 0 6px;font-size:14px">${escapeHtml(e.name)} <span style="color:#64748b;font-weight:400">(${e.kind} · ${e.fields.length} fields)</span></h3>
      <table style="width:100%;font-size:12px;border-collapse:collapse">
        <tr style="text-align:left;color:#64748b"><th>Field</th><th>Type</th><th>Null</th><th>Default</th><th>Notes</th></tr>
        ${e.fields.map((f) => `<tr style="border-top:1px solid #f1f5f9"><td><code>${escapeHtml(f.name)}</code></td><td>${escapeHtml(f.type)}</td><td>${f.nullable ? "yes" : "no"}</td><td>${escapeHtml(String(f.defaultValue ?? "—"))}</td><td>${[f.isPrimaryKey ? "PK" : "", f.isUnique ? "UQ" : "", f.presence !== undefined ? Math.round((f.presence ?? 0) * 100) + "%" : ""].filter(Boolean).join(" ")}</td></tr>`).join("")}
      </table>
      ${e.indexes.length ? `<div style="font-size:12px;margin-top:6px"><b>Indexes:</b> ${e.indexes.map((i) => `<code>${escapeHtml(i.name)}</code> (${i.columns.map(escapeHtml).join(", ")})`).join("; ")}</div>` : ""}
    </section>`
    )
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>DB Architect Report — ${escapeHtml(project)}</title></head>
  <body style="font-family:Inter,system-ui,sans-serif;background:#f8fafc;color:#0f172a;margin:0">
  <header style="background:#0f172a;color:#fff;padding:28px 32px">
    <div style="font-size:12px;letter-spacing:.12em;color:#93c5fd">DB ARCHITECT · DATABASE ARCHITECTURE INTELLIGENCE</div>
    <h1 style="margin:8px 0 4px;font-size:26px">${escapeHtml(project)} — schema report</h1>
    <div style="font-size:13px;color:#cbd5e1">${escapeHtml(model.database)} (${model.engine}${model.version ? " " + escapeHtml(model.version) : ""}) · scan ${escapeHtml(scanMeta.id)} · ${escapeHtml(scanMeta.createdAt)}</div>
    <div style="display:flex;gap:16px;margin-top:12px;font-size:13px">
      <span>Entities <b>${st.entities}</b></span><span>Fields <b>${st.fields}</b></span><span>Indexes <b>${st.indexes}</b></span><span>Relationships <b>${st.relationships}</b></span><span>Design score (heuristic) <b>${summary.designScore}/100</b></span>
    </div>
  </header>
  <main style="max-width:1020px;margin:0 auto;padding:24px">
    <h2>Diagram</h2><div style="border:1px solid #e2e8f0;border-radius:12px;overflow:auto;background:#fff">${svg}</div>
    <h2 style="margin-top:28px">Findings (${findings.length})</h2>
    <p style="font-size:13px;color:#475569">Every recommendation carries evidence level + limitations. Schema guesses are never presented as measured performance facts.</p>
    ${findingsHtml || "<p>No findings — clean schema.</p>"}
    <h2 style="margin-top:28px">Entities</h2>${entitiesHtml}
    ${diff ? `<h2>Schema diff</h2><p style="font-size:13px">+${diff.added} added · −${diff.removed} removed · ~${diff.modified} modified</p>` : ""}
    <footer style="font-size:12px;color:#64748b;margin:32px 0">Generated by DB Architect · limitations: ${summary.limitations.map(escapeHtml).join("; ")}</footer>
  </main></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
