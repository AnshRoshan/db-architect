import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { databaseConnections } from "@/db/schema";
import { apiError, requireProject, requireUser } from "@/lib/auth";
import { getAdapter } from "@/lib/connectors";
import { parseEngine } from "@/lib/engines";
import { sanitizeDbError } from "@/lib/introspection";
import { decryptCredentials } from "@/lib/secrets";
import { audit } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    if (body.connectionId) {
      const id = String(body.connectionId);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Connection id is missing or invalid" }, { status: 400 });
      const rows = await db.select().from(databaseConnections).where(eq(databaseConnections.id, id)).limit(1);
      if (!rows.length) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
      const row = rows[0];
      const access = await requireProject(row.projectId, "admin");
      const adapter = getAdapter(parseEngine(row.engine));
      const result = await adapter.test(decryptCredentials<Record<string, unknown>>(row.secretCiphertext));
      await db.update(databaseConnections).set({ status: result.ok ? "healthy" : "error", lastTestedAt: new Date(), lastTestResult: result }).where(eq(databaseConnections.id, row.id));
      await audit(access.project.id, user.email, "connection.test", "connection", row.id, { ok: result.ok, latencyMs: result.latencyMs });
      return NextResponse.json({ ...result, error: result.error ? sanitizeDbError(result.error) : undefined });
    }
    const adapter = getAdapter(parseEngine(body.engine));
    const valid = adapter.validate(body);
    if (!valid.ok) return NextResponse.json({ ok: false, error: valid.reason, latencyMs: 0 }, { status: 400 });
    const result = await adapter.test(adapter.credentials(body));
    return NextResponse.json({ ...result, error: result.error ? sanitizeDbError(result.error) : undefined });
  } catch (e) {
    return apiError(e);
  }
}
