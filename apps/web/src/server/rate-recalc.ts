import "server-only";

import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  type Database,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  rateEntriesSql,
  rateRecalcJob,
  sql,
  timeEntry,
} from "@timekeep/db";

import type { RateRecalcDTO } from "@/lib/rate-types";

import { assertCan } from "./authz";
import { CatalogError } from "./catalog/errors";
import type { Viewer } from "./catalog/viewer";

/**
 * "Apply to past entries": re-rates live entries from a date with the rates
 * in force at their start. One job runs per workspace; a request while one
 * waits, or after one failed, folds it in (the earliest date, started over)
 * instead of adding another. Runs after the response (`after()`), in keyset batches that each commit progress and
 * the cursor, so a killed run resumes where it stopped on Retry. A single
 * call (`runRateRecalcJob`), so it can move to the pg-boss worker with the
 * export jobs.
 */

const BATCH_SIZE = 5_000;
const STUCK_AFTER_MS = 15 * 60_000;

export type { RateRecalcDTO };

export interface RunOptions {
  batchSize?: number;
  now?: Date;
  /** Test hook: called after each committed batch with the number of batches done. */
  afterBatch?: (batchesDone: number) => void | Promise<void>;
}

const lockWorkspace = (workspaceId: string) =>
  sql`select pg_advisory_xact_lock(hashtext(${`rate-recalc:${workspaceId}`}))`;

/**
 * Queues a recalculation from `from`. A job already waiting, and any failed
 * ones, are folded in: one waiting job from the earliest date, started over
 * (entries behind an old cursor were rated before this change).
 */
export async function requestRateRecalc(
  db: Database,
  workspaceId: string,
  userId: string,
  from: Date,
): Promise<{ jobId: string; merged: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(lockWorkspace(workspaceId));
    const pending = await tx
      .select({ id: rateRecalcJob.id, from: rateRecalcJob.from, status: rateRecalcJob.status })
      .from(rateRecalcJob)
      .where(
        and(
          eq(rateRecalcJob.workspaceId, workspaceId),
          inArray(rateRecalcJob.status, ["queued", "failed"]),
        ),
      );
    const queued = pending.find((j) => j.status === "queued");
    const failed = pending.filter((j) => j.status === "failed").map((j) => j.id);
    const earliest = pending.reduce((min, j) => (j.from < min ? j.from : min), from);
    if (failed.length > 0) await tx.delete(rateRecalcJob).where(inArray(rateRecalcJob.id, failed));
    if (queued) {
      await tx
        .update(rateRecalcJob)
        .set({ from: earliest, cursorStart: null, cursorId: null, processed: 0, total: 0 })
        .where(eq(rateRecalcJob.id, queued.id));
      return { jobId: queued.id, merged: true };
    }
    const id = randomUUID();
    await tx.insert(rateRecalcJob).values({ id, workspaceId, createdBy: userId, from: earliest });
    return { jobId: id, merged: failed.length > 0 };
  });
}

/** Jobs running longer than a function may: failed, with the cursor kept for Retry. */
export async function expireRateRecalcJobs(db: Database, now: Date = new Date()): Promise<void> {
  await db
    .update(rateRecalcJob)
    .set({
      status: "failed",
      error: "Timed out; Retry continues where it stopped.",
      finishedAt: now,
    })
    .where(
      and(
        eq(rateRecalcJob.status, "running"),
        lt(rateRecalcJob.startedAt, new Date(now.getTime() - STUCK_AFTER_MS)),
      ),
    );
}

/**
 * For the progress poll: fails jobs killed mid-run, and returns a waiting job
 * nobody is running (its `after()` never ran) for the caller to start.
 */
export async function refreshRateRecalc(
  db: Database,
  workspaceId: string,
  now: Date = new Date(),
): Promise<string | null> {
  await expireRateRecalcJobs(db, now);
  const jobs = await db
    .select({ id: rateRecalcJob.id, status: rateRecalcJob.status })
    .from(rateRecalcJob)
    .where(
      and(
        eq(rateRecalcJob.workspaceId, workspaceId),
        inArray(rateRecalcJob.status, ["queued", "running"]),
      ),
    )
    .orderBy(asc(rateRecalcJob.createdAt));
  if (jobs.some((j) => j.status === "running")) return null;
  return jobs[0]?.id ?? null;
}

/** Takes a queued job if no other job of its workspace is running. */
async function claim(db: Database, jobId: string, now: Date) {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(rateRecalcJob).where(eq(rateRecalcJob.id, jobId));
    if (!job || job.status !== "queued") return null;
    await tx.execute(lockWorkspace(job.workspaceId));
    const [running] = await tx
      .select({ id: rateRecalcJob.id })
      .from(rateRecalcJob)
      .where(
        and(eq(rateRecalcJob.workspaceId, job.workspaceId), eq(rateRecalcJob.status, "running")),
      )
      .limit(1);
    if (running) return null;
    const [{ total } = { total: 0 }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(timeEntry)
      .where(entriesFrom(job.workspaceId, job.from));
    const [claimed] = await tx
      .update(rateRecalcJob)
      .set({
        status: "running",
        startedAt: now,
        total: Math.max(total, job.processed),
        error: null,
      })
      .where(and(eq(rateRecalcJob.id, jobId), eq(rateRecalcJob.status, "queued")))
      .returning();
    return claimed ?? null;
  });
}

function entriesFrom(workspaceId: string, from: Date) {
  return and(
    eq(timeEntry.workspaceId, workspaceId),
    isNull(timeEntry.deletedAt),
    eq(timeEntry.type, "work"),
    gte(timeEntry.start, from),
  );
}

/** Runs a job to the end (and then any job queued for its workspace meanwhile). */
export async function runRateRecalcJob(
  db: Database,
  jobId: string,
  options: RunOptions = {},
): Promise<void> {
  const batchSize = options.batchSize ?? BATCH_SIZE;
  await expireRateRecalcJobs(db, options.now ?? new Date());
  let nextId: string | null = jobId;
  while (nextId) {
    const job = await claim(db, nextId, options.now ?? new Date());
    if (!job) return;
    let batches = 0;
    let cursor =
      job.cursorStart && job.cursorId ? { start: job.cursorStart, id: job.cursorId } : null;
    try {
      for (;;) {
        const rows: { id: string; start: Date }[] = await db
          .select({ id: timeEntry.id, start: timeEntry.start })
          .from(timeEntry)
          .where(
            and(
              entriesFrom(job.workspaceId, job.from),
              cursor
                ? // The cursor entry's own start, read in SQL: a JavaScript Date keeps
                  // milliseconds only, and the column holds microseconds.
                  sql`(${timeEntry.start}, ${timeEntry.id}) > (coalesce((select c."start" from "time_entry" c where c."id" = ${cursor.id}), ${cursor.start}), ${cursor.id})`
                : undefined,
            ),
          )
          .orderBy(asc(timeEntry.start), asc(timeEntry.id))
          .limit(batchSize);
        if (rows.length === 0) break;
        const last = rows[rows.length - 1]!;
        await db.transaction(async (tx) => {
          await tx.execute(
            rateEntriesSql(
              inArray(
                timeEntry.id,
                rows.map((r) => r.id),
              ),
            ),
          );
          await tx
            .update(rateRecalcJob)
            .set({
              processed: sql`${rateRecalcJob.processed} + ${rows.length}`,
              cursorStart: last.start,
              cursorId: last.id,
            })
            .where(eq(rateRecalcJob.id, job.id));
        });
        cursor = { start: last.start, id: last.id };
        batches++;
        await options.afterBatch?.(batches);
      }
      await db
        .update(rateRecalcJob)
        .set({ status: "done", finishedAt: new Date() })
        .where(eq(rateRecalcJob.id, job.id));
    } catch (error) {
      await db
        .update(rateRecalcJob)
        .set({
          status: "failed",
          error: error instanceof Error ? error.message : "The update failed.",
          finishedAt: new Date(),
        })
        .where(eq(rateRecalcJob.id, job.id));
      console.error(`[rates] recalculation ${job.id} failed`, error);
      return;
    }
    const [queued] = await db
      .select({ id: rateRecalcJob.id })
      .from(rateRecalcJob)
      .where(
        and(eq(rateRecalcJob.workspaceId, job.workspaceId), eq(rateRecalcJob.status, "queued")),
      )
      .orderBy(asc(rateRecalcJob.createdAt))
      .limit(1);
    nextId = queued?.id ?? null;
  }
}

/** A failed job back in the queue, keeping its cursor. */
export async function retryRateRecalc(db: Database, viewer: Viewer, jobId: string): Promise<void> {
  assertCan(viewer.actor, "rate.recalculate", { kind: "none" });
  const [row] = await db
    .update(rateRecalcJob)
    .set({ status: "queued", error: null, finishedAt: null, startedAt: null })
    .where(
      and(
        eq(rateRecalcJob.id, jobId),
        eq(rateRecalcJob.workspaceId, viewer.workspaceId),
        eq(rateRecalcJob.status, "failed"),
      ),
    )
    .returning({ id: rateRecalcJob.id });
  if (!row) throw new CatalogError("NOT_FOUND", "Nothing to retry.");
}

/** The workspace's newest job, for the progress banner. */
export async function latestRateRecalc(
  db: Database,
  workspaceId: string,
): Promise<RateRecalcDTO | null> {
  const [job] = await db
    .select()
    .from(rateRecalcJob)
    .where(eq(rateRecalcJob.workspaceId, workspaceId))
    .orderBy(desc(rateRecalcJob.createdAt))
    .limit(1);
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    from: job.from.toISOString(),
    total: job.total,
    processed: job.processed,
    error: job.error,
  };
}
