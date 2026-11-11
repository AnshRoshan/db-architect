import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    await ensureSchema();
    const tables = await db.execute(
      sql`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name in ('users','sessions','projects','schema_scans','analysis_findings')`
    );
    const ready = Number((tables.rows[0] as { n: number } | undefined)?.n ?? 0);
    return Response.json({ ok: true, schemaReady: ready === 5, tables: ready });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "unknown" }, { status: 500 });
  }
}
