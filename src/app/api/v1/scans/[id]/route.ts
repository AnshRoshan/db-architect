import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { schemaScans } from "@/db/schema";
import { apiError, requireScan } from "@/lib/auth";
import { getScanDetail } from "@/lib/scan";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await requireScan(id, "read");
    const detail = await getScanDetail(id);
    if (!detail) return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await requireScan(id, "write");
    const body = await req.json();
    if (body.action !== "cancel") return NextResponse.json({ error: "Supported action: cancel" }, { status: 400 });
    const rows = await db.select({ status: schemaScans.status }).from(schemaScans).where(eq(schemaScans.id, id)).limit(1);
    if (!rows.length) return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    if (["completed", "failed", "cancelled"].includes(rows[0].status)) return NextResponse.json({ error: `Cannot cancel a ${rows[0].status} scan` }, { status: 409 });
    await db.update(schemaScans).set({ status: "cancelled", currentStage: "cancelled", error: "Cancelled by user", finishedAt: new Date() }).where(eq(schemaScans.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
