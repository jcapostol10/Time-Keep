import { getDb } from "@timekeep/db";

import { cronAuthorized } from "@/server/cron-auth";
import { runDailyJobs } from "@/server/daily-jobs";
import { purgeDeletedReceipts } from "@/server/expense-receipts";
import { env } from "@/server/env";
import { purgeKiosk } from "@/server/kiosk/photos";
import { blankOldBodies, drainAll } from "@/server/outbox";

const NO_STORE = { "Cache-Control": "no-store" };

export const maxDuration = 300;

/**
 * Vercel Cron, every hour: kiosk photos and attempts past their keep period,
 * old email bodies, each workspace's daily jobs (once per local day, from
 * 07:00 in its timezone), then the outbox. 404 without CRON_SECRET.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request, env().CRON_SECRET)) {
    return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }
  const db = getDb();
  const kiosk = await purgeKiosk(db);
  // Housekeeping never stops the jobs or the drain.
  const blanked = await blankOldBodies(db).catch((error: unknown) => {
    console.error("[cron] blanking old email bodies failed", error);
    return 0;
  });
  const receipts = await purgeDeletedReceipts(db).catch((error: unknown) => {
    console.error("[cron] purging deleted receipts failed", error);
    return 0;
  });
  const jobs = await runDailyJobs(db);
  const mail = await drainAll(db, { budgetMs: 200_000 });
  return Response.json({ ...jobs, kiosk, blanked, receipts, ...mail }, { headers: NO_STORE });
}
