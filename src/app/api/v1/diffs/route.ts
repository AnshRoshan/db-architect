import { NextResponse } from "next/server";
import { apiError, requireProject, requireScan, requireUser } from "@/lib/auth";
import { diffModels } from "@/lib/diff-migrate";
import { getScanDetail } from "@/lib/scan";
import { SchemaModel } from "@/lib/schema-model";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await requireUser();
    const body = await req.json();
    const sourceId = String(body.sourceScanId ?? "");
    const targetId = String(body.targetScanId ?? "");
    const [sourceAccess, targetAccess] = await Promise.all([requireScan(sourceId, "read"), requireScan(targetId, "read")]);
    if (sourceAccess.project.id !== targetAccess.project.id) return NextResponse.json({ error: "Scans must belong to the same project" }, { status: 400 });
    const [a, b] = await Promise.all([getScanDetail(sourceId), getScanDetail(targetId)]);
    if (!a?.version || !b?.version) return NextResponse.json({ error: "Both scans need schema versions" }, { status: 404 });
    const diff = diffModels(a.version.model as unknown as SchemaModel, b.version.model as unknown as SchemaModel);
    return NextResponse.json({ diff, source: { id: sourceId, label: a.version.label, version: a.version.version }, target: { id: targetId, label: b.version.label, version: b.version.version } });
  } catch (e) {
    return apiError(e);
  }
}
