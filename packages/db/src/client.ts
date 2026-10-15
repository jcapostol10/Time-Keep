import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema";
import { SUPABASE_ROOT_CA } from "./supabase-ca";

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: Pool;
  close: () => Promise<void>;
}

/**
 * TLS settings for a connection string: Supabase hosts get verified TLS
 * against Supabase's root CA; anything else (local Docker) is left as is.
 */
export function sslOptionsFor(connectionString: string): PoolConfig["ssl"] {
  let host = "";
  try {
    host = new URL(connectionString).hostname;
  } catch {
    return undefined;
  }
  if (host.endsWith(".supabase.com") || host.endsWith(".supabase.co")) {
    return { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true };
  }
  return undefined;
}

/** Create an independent client, e.g. for tests or scripts. */
export function createDb(connectionString: string, options: { max?: number } = {}): DbHandle {
  const pool = new Pool({
    connectionString,
    max: options.max ?? 10,
    ssl: sslOptionsFor(connectionString),
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

let shared: DbHandle | undefined;

/** Process-wide client for DATABASE_URL; created on first use so imports never connect. */
export function getDb(): Database {
  if (!shared) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    shared = createDb(url);
  }
  return shared.db;
}

/**
 * Convenience alias so call sites can write `db.select()`; resolves the shared
 * client lazily on first property access.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
