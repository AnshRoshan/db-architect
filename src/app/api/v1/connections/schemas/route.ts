import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { databaseConnections } from "@/db/schema";
import { apiError, requireProject, requireUser } from "@/lib/auth";
import { getAdapter } from "@/lib/connectors";
import { parseEngine } from "@/lib/engines";
import { sanitizeDbError } from "@/lib/introspection";
import { decryptCredentials } from "@/lib/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Discovery: what does this server contain before anything is scanned?
 * PostgreSQL → schemas, MySQL → databases, Redis → logical dbs.
 * Read-only catalog queries; nothing is stored.
 */
export async function POST(req: Request) {
  try {
    await requireUser();
    const body = (await req.json()) as Record<string, unknown>;
    let engine = parseEngine(body.engine);
    let creds: Record<string, unknown>;
    let selection: string | null = null;
    if (body.connectionId) {
      const id = String(body.connectionId);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Connection id is missing or invalid" }, { status: 400 });
      const rows = await db.select().from(databaseConnections).where(eq(databaseConnections.id, id)).limit(1);
      if (!rows.length) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
      await requireProject(rows[0].projectId, "write");
      if (!rows[0].secretCiphertext) return NextResponse.json({ error: "Connection has no stored credentials; rotate them first" }, { status: 400 });
      engine = parseEngine(rows[0].engine);
      creds = decryptCredentials<Record<string, unknown>>(rows[0].secretCiphertext);
      selection = rows[0].schemaSelection;
    } else {
      const adapter = getAdapter(engine);
      const valid = adapter.validate(body);
      if (!valid.ok) return NextResponse.json({ error: valid.reason }, { status: 400 });
      creds = adapter.credentials(body);
    }
    try {
      const found = await getAdapter(engine).discover(creds);
      return NextResponse.json({ engine, selection, ...found });
    } catch (e) {
      return NextResponse.json({ error: sanitizeDbError(e) }, { status: 502 });
    }
  } catch (e) {
    return apiError(e);
  }
}
