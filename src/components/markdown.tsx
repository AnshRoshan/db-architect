"use client";

import { Fragment, type ReactNode } from "react";

// Minimal, safe Markdown → React renderer (no innerHTML). Supports headings,
// paragraphs, bullet/numbered lists, blockquotes, fenced code, hr, **bold**,
// *italic* and `inline code` — the subset the assistant produces.

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) out.push(<code key={`${keyBase}-${i++}`} className="rounded bg-indigo-500/10 px-1 py-0.5 font-mono text-[0.85em] text-indigo-700 dark:text-indigo-300">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("**")) out.push(<strong key={`${keyBase}-${i++}`} className="font-semibold text-ink">{tok.slice(2, -2)}</strong>);
    else out.push(<em key={`${keyBase}-${i++}`}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0; let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim(); const code: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(<div key={k++} className="my-3 overflow-hidden rounded-xl border border-slate-800 bg-slate-950">{lang && <div className="border-b border-white/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-slate-400">{lang}</div>}<pre className="scroll-thin overflow-x-auto p-3 font-mono text-[11.5px] leading-relaxed text-emerald-200">{code.join("\n")}</pre></div>);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const cls = level <= 2 ? "mt-4 text-base font-bold" : level === 3 ? "mt-4 text-[15px] font-bold" : "mt-3 text-sm font-semibold";
      blocks.push(<div key={k++} role="heading" aria-level={level} className={`${cls} text-ink first:mt-0`}>{inline(h[2], `h${k}`)}</div>);
      i++; continue;
    }
    if (/^---+$/.test(line.trim())) { blocks.push(<hr key={k++} className="my-4 border-line" />); i++; continue; }
    if (line.startsWith(">")) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) q.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={k++} className="my-3 rounded-r-xl border-l-4 border-indigo-400 bg-indigo-500/5 px-4 py-2 text-ink-muted">{inline(q.join(" "), `q${k}`)}</blockquote>);
      continue;
    }
    if (/^\s*([*-]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: { depth: number; text: string }[] = [];
      while (i < lines.length && /^\s*([*-]|\d+\.)\s+/.test(lines[i])) {
        const depth = (lines[i].match(/^\s*/)?.[0].length ?? 0) >= 2 ? 1 : 0;
        items.push({ depth, text: lines[i].replace(/^\s*([*-]|\d+\.)\s+/, "") }); i++;
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(<Tag key={k++} className={`my-2 space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"} marker:text-ink-muted`}>{items.map((it, j) => <li key={j} className={it.depth ? "ml-4 list-[circle]" : ""}>{inline(it.text, `l${k}-${j}`)}</li>)}</Tag>);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([*-]|\d+\.)\s|---+$)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++} className="my-2 leading-relaxed">{para.map((p, j) => <Fragment key={j}>{j > 0 && " "}{inline(p, `p${k}-${j}`)}</Fragment>)}</p>);
  }
  return <div className="text-[13px] text-ink-muted [&>*:first-child]:mt-0">{blocks}</div>;
}
