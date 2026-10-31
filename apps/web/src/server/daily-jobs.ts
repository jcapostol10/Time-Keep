import "server-only";

import type { Database } from "@timekeep/db";

/**
 * The once-a-day jobs (Vercel Cron at 22:00 UTC, 06:00 in Manila). Each
 * workspace is evaluated in its own timezone, for the local day just ended.
 */
export async function runDailyJobs(
  _db: Database,
  _opts: { now?: Date; workspaceIds?: string[] } = {},
): Promise<{ reminders: number }> {
  return { reminders: 0 };
}
