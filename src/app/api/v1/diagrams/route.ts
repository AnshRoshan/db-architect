import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { diagramLayouts } from "@/db/schema";
import { apiError, requireScan, requireUser } from "@/lib/auth";
import { renderSvg } from "@/lib/diagram";
import { getScanDetail } from "@/lib/scan";
import { DiagramLayout } from "@/lib/diagram";
import { SchemaModel } from "@/lib/schema-model";
import { audit } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const scanId = String(body.scanId ?? "");
    const access = await requireScan(scanId, "write");
    const layout = body.layout as DiagramLayout;
    if (!layout || !Array.isArray(layout.nodes) || layout.nodes.length > 2000) return NextResponse.json({ error: "Invalid diagram layout" }, { status: 400 });
    for (const node of layout.nodes) {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || Math.abs(node.x) > 100000 || Math.abs(node.y) > 100000) return NextResponse.json({ error: "Invalid node position" }, { status: 400 });
    }
    const detail = await getScanDetail(scanId);
    if (!detail?.version) return NextResponse.json({ error: "Schema version missing" }, { status: 404 });
    const model = detail.version.model as unknown as SchemaModel;
    const validNames = new Set(model.entities.map((e) => e.name));
    layout.nodes = layout.nodes.filter((n) => validNames.has(n.id));
    const svg = renderSvg(model, layout);
    const existing = await db.select().from(diagramLayouts).where(and(eq(diagramLayouts.scanId, scanId), eq(diagramLayouts.name, String(body.name ?? "default")))).limit(1);
    let saved;
    if (existing.length) {
      [saved] = await db.update(diagramLayouts).set({ layout: layout as unknown as Record<string, unknown>, svg, updatedAt: new Date() }).where(eq(diagramLayouts.id, existing[0].id)).returning();
    } else {
      [saved] = await db.insert(diagramLayouts).values({ scanId, name: String(body.name ?? "default"), layout: layout as unknown as Record<string, unknown>, svg }).returning();
    }
    await audit(access.project.id, user.email, "diagram.layout_save", "diagram", saved.id, { nodes: layout.nodes.length });
    return NextResponse.json({ layout: saved });
  } catch (e) {
    return apiError(e);
  }
}
