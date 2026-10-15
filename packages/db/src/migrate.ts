import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

/** Apply all pending migrations in ./migrations to the given database. */
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  // Migrations need a session (not transaction-pooled) connection on Supabase.
  const url = process.argv[2] ?? process.env.DATABASE_URL_SESSION ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("Usage: tsx src/migrate.ts [connection-string]  (or set DATABASE_URL)");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.info("[db] migrations applied");
    })
    .catch((error) => {
      console.error("[db] migration failed", error);
      process.exit(1);
    });
}
