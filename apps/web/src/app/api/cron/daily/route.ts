import { getDb } from "@timekeep/db";

import { cronAuthorized } from "@/server/cron-auth";
import { runDailyJobs } from "@/server/daily-jobs";
import { env } from "@/server/env";
import { drainOutbox } from "@/server/outbox";

const NO_STORE = { "Cache-Control": "no-store" };

export const maxDuration = 300;

/** Vercel Cron, once a day: reminders, then the outbox. 404 without CRON_SECRET. */
export async function GET(request: Request) {
  if (!cronAuthorized(request, env().CRON_SECRET)) {
    return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }
  const db = getDb();
  const jobs = await runDailyJobs(db);
  const mail = await drainOutbox(db, { limit: 500 });
  return Response.json({ ...jobs, ...mail }, { headers: NO_STORE });
}
