import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sql } from "drizzle-orm";

import type { Database } from "./client";

/** One entry of drizzle-kit's migrations/meta/_journal.json. */
export interface JournalEntry {
  tag: string;
  /** Milliseconds; drizzle's migrator applies entries newer than the last applied one. */
  when: number;
}

const journalPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations/meta/_journal.json",
);

export function readJournal(): JournalEntry[] {
  const parsed = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: JournalEntry[] };
  return parsed.entries.map(({ tag, when }) => ({ tag, when }));
}

function isUndefinedTable(error: unknown): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  return typeof cause === "object" && cause !== null && (cause as { code?: string }).code === "42P01";
}

/**
 * Tags of the journal's migrations the database has not applied, by the
 * migrator's own rule: a journal `when` newer than the newest `created_at` in
 * drizzle.__drizzle_migrations is pending (no table means nothing applied).
 * The shared Supabase database only migrates on a production build, so a
 * preview of a schema-changing branch runs ahead of it.
 */
export async function listPendingMigrations(
  db: Pick<Database, "execute">,
  journal: JournalEntry[] = readJournal(),
): Promise<string[]> {
  let latest = -1;
  try {
    const result = await db.execute<{ latest: string | number | null }>(
      sql`select max(created_at) as latest from drizzle.__drizzle_migrations`,
    );
    const value = result.rows[0]?.latest;
    if (value !== null && value !== undefined) latest = Number(value);
  } catch (error) {
    if (!isUndefinedTable(error)) throw error;
  }
  return journal.filter((m) => m.when > latest).map((m) => m.tag);
}
