import { SchemaModel } from "./schema-model";

// ─── ELK-based layout (server) + SVG renderer (shared helpers) ────
// Keeps the ELK foundation: nodes = entities, edges = relationships.
// Server computes positions with elkjs; client renders interactive SVG.

export interface DiagramNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: string;
  fieldCount: number;
}

export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  provenance: string;
  cardinality: string;
}

export interface DiagramLayout {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  width: number;
  height: number;
  engine: string;
}

const ROW_H = 22;
const HEADER_H = 34;
const NODE_W = 230;

export async function layoutDiagram(model: SchemaModel, maxNodes = 120): Promise<DiagramLayout> {
  const entities = model.entities.slice(0, maxNodes);
  const rels = model.relationships.filter(
    (r) => entities.some((e) => e.name === r.fromEntity) && entities.some((e) => e.name === r.toEntity)
  );
  const children = entities.map((e) => ({
    id: e.name,
    width: NODE_W,
    height: HEADER_H + Math.min(e.fields.length, 12) * ROW_H + 8,
  }));
  const edges = rels.slice(0, 300).map((r) => ({
    id: r.id,
    sources: [r.fromEntity],
    targets: [r.toEntity],
  }));
  try {
    const ELK = (await import("elkjs/lib/elk.bundled.js")).default;
    const elk = new ELK();
    const g = await elk.layout({
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.spacing.nodeNode": "40",
        "elk.layered.spacing.nodeNodeBetweenLayers": "90",
        "elk.edgeRouting": "ORTHOGONAL",
      },
      children,
      edges,
    });
    const pos = new Map((g.children ?? []).map((c) => [c.id, c]));
    const nodes: DiagramNode[] = entities.map((e) => {
      const p = pos.get(e.name) as { x?: number; y?: number; width?: number; height?: number } | undefined;
      return {
        id: e.name,
        label: e.shortName,
        x: p?.x ?? 0,
        y: p?.y ?? 0,
        width: p?.width ?? NODE_W,
        height: p?.height ?? HEADER_H + e.fields.length * ROW_H,
        kind: e.kind,
        fieldCount: e.fields.length,
      };
    });
    return {
      nodes,
      edges: rels.slice(0, 300).map((r) => ({
        id: r.id,
        from: r.fromEntity,
        to: r.toEntity,
        label: r.cardinality,
        provenance: r.provenance,
        cardinality: r.cardinality,
      })),
      width: ((g as unknown as { width?: number }).width ?? 1200) + 40,
      height: ((g as unknown as { height?: number }).height ?? 800) + 40,
      engine: model.engine,
    };
  } catch {
    // fallback grid layout (never blocks product on ELK failure)
    const cols = Math.ceil(Math.sqrt(entities.length));
    const nodes: DiagramNode[] = entities.map((e, i) => ({
      id: e.name,
      label: e.shortName,
      x: (i % cols) * (NODE_W + 60),
      y: Math.floor(i / cols) * 320,
      width: NODE_W,
      height: HEADER_H + Math.min(e.fields.length, 12) * ROW_H + 8,
      kind: e.kind,
      fieldCount: e.fields.length,
    }));
    return {
      nodes,
      edges: rels.slice(0, 300).map((r) => ({
        id: r.id,
        from: r.fromEntity,
        to: r.toEntity,
        label: r.cardinality,
        provenance: r.provenance,
        cardinality: r.cardinality,
      })),
      width: cols * (NODE_W + 60),
      height: Math.ceil(entities.length / cols) * 320,
      engine: model.engine,
    };
  }
}

export function renderSvg(model: SchemaModel, layout: DiagramLayout, opts?: { highlight?: string | null }): string {
  const hl = opts?.highlight ?? null;
  const entByName = new Map(model.entities.map((e) => [e.name, e]));
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
  const edgePaths = layout.edges
    .map((e) => {
      const a = nodeById.get(e.from);
      const b = nodeById.get(e.to);
      if (!a || !b) return "";
      const x1 = a.x + a.width;
      const y1 = a.y + a.height / 2;
      const x2 = b.x;
      const y2 = b.y + b.height / 2;
      const mx = (x1 + x2) / 2;
      const dashed = e.provenance !== "explicit" ? ' stroke-dasharray="6 4"' : "";
      const color = e.provenance !== "explicit" ? "#a855f7" : "#2563eb";
      const w = hl && (e.from === hl || e.to === hl) ? 2.5 : 1.5;
      const op = hl && e.from !== hl && e.to !== hl ? 0.25 : 1;
      return `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${w}" opacity="${op}"${dashed}/>`;
    })
    .join("\n");
  const nodeSvg = layout.nodes
    .map((n) => {
      const e = entByName.get(n.id);
      const dim = hl && n.id !== hl ? 0.55 : 1;
      const stroke = hl === n.id ? "#7c3aed" : "#cbd5e1";
      const fields = (e?.fields ?? []).slice(0, 12).map((f, i) => {
        const y = n.y + HEADER_H + i * ROW_H + 15;
        const pk = f.isPrimaryKey ? " 🔑" : "";
        const fk = (e?.constraints ?? []).some((c) => c.kind === "foreign_key" && c.columns.includes(f.name)) ? " 🔗" : "";
        return `<text x="${n.x + 10}" y="${y}" font-size="11" font-family="ui-monospace,monospace" fill="#334155">${esc(f.name)}: ${esc(f.type)}${pk}${fk}</text>`;
      }).join("\n");
      const more = (e?.fields.length ?? 0) > 12 ? `<text x="${n.x + 10}" y="${n.y + n.height - 6}" font-size="10" fill="#94a3b8">+${(e?.fields.length ?? 0) - 12} more</text>` : "";
      return `<g opacity="${dim}">
        <rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="10" fill="#ffffff" stroke="${stroke}" stroke-width="${hl === n.id ? 2.5 : 1.2}"/>
        <rect x="${n.x}" y="${n.y}" width="${n.width}" height="${HEADER_H}" rx="10" fill="${n.kind === "collection" ? "#faf5ff" : "#eff6ff"}"/>
        <text x="${n.x + 10}" y="${n.y + 21}" font-size="12.5" font-weight="700" font-family="Inter,system-ui,sans-serif" fill="#0f172a">${esc(n.label)}</text>
        ${fields}${more}
      </g>`;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">
  <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="none" stroke="#64748b" stroke-width="1.2"/></marker></defs>
  <rect width="100%" height="100%" fill="#f8fafc"/>
  ${edgePaths}
  ${nodeSvg}
</svg>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
