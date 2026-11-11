import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { databaseConnections } from "@/db/schema";
import { apiError, requireProject, requireUser } from "@/lib/auth";
import { validateHost } from "@/lib/introspection";
import { getAdapter } from "@/lib/connectors";
import { parseEngine } from "@/lib/engines";
import { decryptCredentials, encryptCredentials } from "@/lib/secrets";
import { audit } from "@/lib/server";

export const dynamic = "force-dynamic";

function safeConnection(row: typeof databaseConnections.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    engine: row.engine,
    host: row.host,
    port: row.port,
    database: row.database,
    username: row.username,
    maskedConnection: row.maskedConnection,
    sslMode: row.sslMode,
    schemaSelection: row.schemaSelection,
    readOnly: row.readOnly,
    status: row.status,
    lastTestedAt: row.lastTestedAt,
    lastTestResult: row.lastTestResult,
    createdAt: row.createdAt,
    hasCredentials: Boolean(row.secretCiphertext),
  };
}

export async function GET(req: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(req.url);
    const access = await requireProject(searchParams.get("projectId") ?? "", "read");
    const rows = await db.select().from(databaseConnections).where(eq(databaseConnections.projectId, access.project.id)).orderBy(desc(databaseConnections.createdAt)).limit(100);
    return NextResponse.json({ connections: rows.map(safeConnection) });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const access = await requireProject(String(body.projectId ?? ""), "admin");
    const engine = parseEngine(body.engine);
    const adapter = getAdapter(engine);
    const valid = adapter.validate(body);
    if (!valid.ok) return NextResponse.json({ error: valid.reason }, { status: 400 });
    const credentials = adapter.credentials(body);
    const shown = adapter.display(body);
    const encrypted = encryptCredentials(credentials);
    const [row] = await db.insert(databaseConnections).values({
      projectId: access.project.id,
      name: String(body.name ?? `${engine} connection`).slice(0, 200),
      engine,
      host: shown.host,
      port: shown.port,
      database: shown.database,
      username: shown.username,
      ...encrypted,
      maskedConnection: shown.masked,
      sslMode: String(body.sslMode ?? "prefer"),
      schemaSelection: String(body.schemaSelection ?? body.schema ?? "public"),
      readOnly: true,
      status: "created",
    }).returning();
    await audit(access.project.id, user.email, "connection.create", "connection", row.id, { engine, database: row.database });
    return NextResponse.json({ connection: safeConnection(row) }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const connectionId = String(body.connectionId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return NextResponse.json({ error: "Connection id is missing or invalid" }, { status: 400 });
    const rows = await db.select().from(databaseConnections).where(eq(databaseConnections.id, connectionId)).limit(1);
    if (!rows.length) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    const access = await requireProject(rows[0].projectId, "admin");
    const action = String(body.action ?? "rotate");
    if (action === "revoke") {
      const [row] = await db.update(databaseConnections).set({ secretCiphertext: null, status: "revoked", lastTestResult: { ok: false, note: "Credentials revoked" } }).where(eq(databaseConnections.id, rows[0].id)).returning();
      await audit(access.project.id, user.email, "connection.revoke", "connection", row.id, {});
      return NextResponse.json({ connection: safeConnection(row) });
    }
    const existing = decryptCredentials<Record<string, unknown>>(rows[0].secretCiphertext);
    const next = { ...existing };
    if (rows[0].engine === "mongodb") {
      if (body.uri) next.uri = String(body.uri);
    } else {
      if (body.password) next.password = String(body.password);
      if (body.username) next.username = String(body.username);
      if (body.host) {
        const valid = validateHost(String(body.host));
        if (!valid.ok) return NextResponse.json({ error: valid.reason }, { status: 400 });
        next.host = String(body.host);
      }
    }
    const encrypted = encryptCredentials(next);
    const [row] = await db.update(databaseConnections).set({ ...encrypted, name: String(body.name ?? rows[0].name).slice(0, 200), status: "created" }).where(and(eq(databaseConnections.id, rows[0].id), eq(databaseConnections.projectId, access.project.id))).returning();
    await audit(access.project.id, user.email, "connection.rotate", "connection", row.id, {});
    return NextResponse.json({ connection: safeConnection(row) });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get("connectionId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return NextResponse.json({ error: "Connection id is missing or invalid" }, { status: 400 });
    const rows = await db.select().from(databaseConnections).where(eq(databaseConnections.id, connectionId)).limit(1);
    if (!rows.length) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    const access = await requireProject(rows[0].projectId, "admin");
    await db.delete(databaseConnections).where(and(eq(databaseConnections.id, rows[0].id), eq(databaseConnections.projectId, access.project.id)));
    await audit(access.project.id, user.email, "connection.delete", "connection", rows[0].id, {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
