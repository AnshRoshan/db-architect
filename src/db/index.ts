import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

type Db = ReturnType<typeof drizzle>;

let cachedDb: Db | undefined;
let cachedPool: Pool | undefined;

function createPool(): Pool {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  if (!cachedPool) {
    cachedPool =
      globalForDb.__arenaNextJsPostgresqlPool ??
      new Pool({
        connectionString: databaseUrl,
      });
    if (process.env.NODE_ENV !== "production") {
      globalForDb.__arenaNextJsPostgresqlPool = cachedPool;
    }
  }
  return cachedPool;
}

function getDb(): Db {
  if (!cachedDb) cachedDb = drizzle(createPool());
  return cachedDb;
}

export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const instance = getDb();
    const value = (instance as unknown as Record<PropertyKey, unknown>)[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
  },
}) as Db;

export const pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const instance = createPool();
    const value = (instance as unknown as Record<PropertyKey, unknown>)[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
  },
}) as Pool;
