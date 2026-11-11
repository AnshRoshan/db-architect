import { NextResponse } from "next/server";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { analysisFindings } from "@/db/schema";
import { audit } from "@/lib/server";
import { apiError, requireProject, requireScan, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["open", "accepted", "dismissed", "fixed", "needs_review"]);

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const id = String(body.findingId ?? body.id ?? "");
    const status = String(body.status ?? "");
    if (!id || !ALLOWED.has(status)) return NextResponse.json({ error: "findingId + valid status required (open|accepted|dismissed|fixed|needs_review)" }, { status: 400 });
    const existing = await db.select({ scanId: analysisFindings.scanId }).from(analysisFindings).where(eq(analysisFindings.id, id)).limit(1);
    if (!existing.length) return NextResponse.json({ error: "Finding not found" }, { status: 404 });
    const access = await requireScan(existing[0].scanId, "review");
    const rows = await db.update(analysisFindings).set({ status }).where(eq(analysisFindings.id, id)).returning({ id: analysisFindings.id, scanId: analysisFindings.scanId });
    await audit(access.project.id, user.email, "finding.status", "finding", id, { status });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
