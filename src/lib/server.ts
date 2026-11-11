import { db } from "@/db";
import { sql } from "drizzle-orm";
import { createHash, randomUUID } from "crypto";
import { auditLogs } from "@/db/schema";

let ensured = false;

export async function ensureAppSchema() {
  if (ensured) return;
  ensured = true;
  // drizzle-kit push handles DDL; this is a safety net for preview boot
  await db.execute(sql`select 1`).catch(() => undefined);
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function newId(): string {
  return randomUUID();
}

export async function audit(projectId: string | null, actor: string, action: string, entityType?: string, entityId?: string, detail: Record<string, unknown> = {}) {
  try {
    await db.insert(auditLogs).values({
      projectId: projectId as string | null,
      actor,
      action,
      entityType,
      entityId,
      detail,
    });
  } catch {
    // never fail product on audit
  }
}

export function safeError(e: unknown): string {
  let m = e instanceof Error ? e.message : String(e);
  m = m.replace(/\/\/[^@/\s]+:[^@/\s]+@/g, "//***:***@");
  return m.slice(0, 600);
}
