import { getDb } from "@timekeep/db";

import { cronAuthorized } from "@/server/cron-auth";
import { runDailyJobs } from "@/server/daily-jobs";
import { env } from "@/server/env";
import { purgeKiosk } from "@/server/kiosk/photos";
import { drainAll } from "@/server/outbox";

const NO_STORE = { "Cache-Control": "no-store" };

export const maxDuration = 300;

/**
 * Vercel Cron, once a day: kiosk photos and attempts past their keep period,
 * reminders, then the outbox. 404 without CRON_SECRET.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request, env().CRON_SECRET)) {
    return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }
  const db = getDb();
  const kiosk = await purgeKiosk(db);
  const jobs = await runDailyJobs(db);
  const mail = await drainAll(db, { budgetMs: 200_000 });
  return Response.json({ ...jobs, kiosk, ...mail }, { headers: NO_STORE });
}
