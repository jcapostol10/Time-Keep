import "server-only";

import { randomUUID } from "node:crypto";

import { and, type Database, eq, rateRecalcJob, sql } from "@timekeep/db";

/**
 * "Apply to past entries": re-rates live entries from a date with the rates
 * in force at their start. One job runs per workspace; a request while one
 * waits lowers the waiting job's date instead of adding another.
 */

/** Queues a recalculation from `from`, merging into a job already waiting. */
export async function requestRateRecalc(
  db: Database,
  workspaceId: string,
  userId: string,
  from: Date,
): Promise<{ jobId: string; merged: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rate-recalc:${workspaceId}`}))`);
    const [queued] = await tx
      .select({ id: rateRecalcJob.id, from: rateRecalcJob.from })
      .from(rateRecalcJob)
      .where(and(eq(rateRecalcJob.workspaceId, workspaceId), eq(rateRecalcJob.status, "queued")))
      .limit(1);
    if (queued) {
      if (from < queued.from) {
        await tx.update(rateRecalcJob).set({ from }).where(eq(rateRecalcJob.id, queued.id));
      }
      return { jobId: queued.id, merged: true };
    }
    const id = randomUUID();
    await tx.insert(rateRecalcJob).values({ id, workspaceId, createdBy: userId, from });
    return { jobId: id, merged: false };
  });
}
