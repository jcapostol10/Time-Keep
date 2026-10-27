import { randomUUID } from "node:crypto";

import { and, eq, rate, rateEntriesSql, rateRecalcJob, sql, timeEntry } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb, createTestUser, createTestWorkspace, truncateAll } from "../../test/db";
import { loadViewer } from "./authz";
import type { Viewer } from "./catalog/viewer";
import {
  expireRateRecalcJobs,
  latestRateRecalc,
  refreshRateRecalc,
  requestRateRecalc,
  retryRateRecalc,
  runRateRecalcJob,
} from "./rate-recalc";
import { relabelWorkspaceCurrency, workspaceHasRates } from "./rates";

const handle = connectTestDb();
const db = handle.db;

let me: Viewer;
const BASE = new Date("2026-03-02T01:00:00Z");
const H = 3_600_000;

async function addRate(amountMinor: number, effectiveFrom: Date) {
  await db.insert(rate).values({
    id: randomUUID(),
    workspaceId: me.workspaceId,
    level: "workspace",
    amountMinor,
    currency: "USD",
    effectiveFrom,
  });
}

/** Twelve one-hour entries, a day apart from Mar 2, saved before any rate existed. */
async function entries(n = 12) {
  for (let i = 0; i < n; i++) {
    const start = new Date(BASE.getTime() + i * 24 * H);
    await db.insert(timeEntry).values({
      id: randomUUID(),
      workspaceId: me.workspaceId,
      userId: me.userId,
      billable: true,
      start,
      end: new Date(start.getTime() + H),
      durationSeconds: 3600,
    });
  }
}

const amounts = async () =>
  (
    await db
      .select({ start: timeEntry.start, amount: timeEntry.amountMinor })
      .from(timeEntry)
      .where(eq(timeEntry.workspaceId, me.workspaceId))
      .orderBy(timeEntry.start)
  ).map((r) => r.amount);

afterAll(async () => handle.close());

describe("the apply-to-past-entries job", () => {
  beforeAll(async () => truncateAll(db));

  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    me = await loadViewer(db, ws.id, olga.id);
  });

  it("re-rates every entry from its date in batches and reports progress", async () => {
    await entries();
    await addRate(5000, new Date(0));
    const { jobId } = await requestRateRecalc(db, me.workspaceId, me.userId, new Date(0));
    await runRateRecalcJob(db, jobId, { batchSize: 5 });
    expect(await latestRateRecalc(db, me.workspaceId)).toMatchObject({
      id: jobId,
      status: "done",
      total: 12,
      processed: 12,
      error: null,
    });
    expect(await amounts()).toEqual(Array(12).fill(5000));
  });

  it("finishes over starts with microseconds, which a JavaScript Date cannot hold", async () => {
    // As SQL writes them (now() - an interval): the cursor must not lose precision, or the
    // last batch re-reads its own last entry forever.
    await db.execute(sql`
      insert into time_entry (id, workspace_id, user_id, billable, start, "end", duration_seconds)
      select 'micro-' || g, ${me.workspaceId}, ${me.userId}, true,
             timestamptz '2026-03-02 01:00:00.123456+00' + make_interval(secs => g * 60),
             timestamptz '2026-03-02 02:00:00.123456+00' + make_interval(secs => g * 60), 3600
      from generate_series(1, 12) g`);
    await addRate(5000, new Date(0));
    const { jobId } = await requestRateRecalc(db, me.workspaceId, me.userId, new Date(0));
    let batches = 0;
    await runRateRecalcJob(db, jobId, {
      batchSize: 5,
      afterBatch: () => {
        if (++batches > 10) throw new Error("the job does not end");
      },
    });
    expect(await latestRateRecalc(db, me.workspaceId)).toMatchObject({
      status: "done",
      processed: 12,
    });
    expect(batches).toBe(3);
  });

  it("only touches entries from the job's date", async () => {
    await entries();
    await addRate(5000, new Date(0));
    const from = new Date(BASE.getTime() + 6 * 24 * H);
    const { jobId } = await requestRateRecalc(db, me.workspaceId, me.userId, from);
    await runRateRecalcJob(db, jobId, { batchSize: 5 });
    expect(await amounts()).toEqual([...Array(6).fill(null), ...Array(6).fill(5000)]);
  });

  it("resumes a failed run from its cursor on retry", async () => {
    await entries();
    await addRate(5000, new Date(0));
    const { jobId } = await requestRateRecalc(db, me.workspaceId, me.userId, new Date(0));
    await runRateRecalcJob(db, jobId, {
      batchSize: 5,
      afterBatch: (done) => {
        if (done === 1) throw new Error("killed");
      },
    });
    expect(await latestRateRecalc(db, me.workspaceId)).toMatchObject({
      status: "failed",
      processed: 5,
      error: "killed",
    });

    // A later rate change shows which entries the retry re-rates: only those after the cursor.
    await addRate(7000, new Date(1));
    await retryRateRecalc(db, me, jobId);
    await runRateRecalcJob(db, jobId, { batchSize: 5 });
    expect(await latestRateRecalc(db, me.workspaceId)).toMatchObject({
      status: "done",
      processed: 12,
    });
    expect(await amounts()).toEqual([...Array(5).fill(5000), ...Array(7).fill(7000)]);
  });

  it("starts a waiting job over when a request merges into it after it had a cursor", async () => {
    await entries();
    await addRate(5000, new Date(0));
    const { jobId } = await requestRateRecalc(db, me.workspaceId, me.userId, new Date(0));
    await runRateRecalcJob(db, jobId, {
      batchSize: 5,
      afterBatch: (done) => {
        if (done === 1) throw new Error("killed");
      },
    });
    await retryRateRecalc(db, me, jobId); // waiting again, cursor after 5 entries
    await addRate(7000, new Date(1));
    const merged = await requestRateRecalc(db, me.workspaceId, me.userId, new Date(0));
    expect(merged).toEqual({ jobId, merged: true });
    await runRateRecalcJob(db, jobId, { batchSize: 5 });
    // Every entry takes the new rate: none were skipped behind the old cursor.
    expect(await amounts()).toEqual(Array(12).fill(7000));
  });

  it("folds an earlier failed job into the next request, so its entries are not left behind", async () => {
    await entries();
    await addRate(5000, new Date(0));
    const first = await requestRateRecalc(db, me.workspaceId, me.userId, new Date(0));
    await runRateRecalcJob(db, first.jobId, {
      batchSize: 5,
      afterBatch: (done) => {
        if (done === 1) throw new Error("killed");
      },
    });
    // A later change from a later date, without anyone pressing Retry on the first.
    const later = new Date(BASE.getTime() + 10 * 24 * H);
    const second = await requestRateRecalc(db, me.workspaceId, me.userId, later);
    await runRateRecalcJob(db, second.jobId, { batchSize: 5 });
    expect(await amounts()).toEqual(Array(12).fill(5000));
    const failed = await db
      .select()
      .from(rateRecalcJob)
      .where(and(eq(rateRecalcJob.workspaceId, me.workspaceId), eq(rateRecalcJob.status, "failed")));
    expect(failed).toEqual([]);
  });

  it("surfaces a job killed mid-run and starts a waiting one when polled", async () => {
    const { jobId } = await requestRateRecalc(db, me.workspaceId, me.userId, new Date(0));
    const now = new Date("2026-03-11T04:00:00Z");
    await db
      .update(rateRecalcJob)
      .set({ status: "running", startedAt: new Date(now.getTime() - 16 * 60_000) })
      .where(eq(rateRecalcJob.id, jobId));
    expect(await refreshRateRecalc(db, me.workspaceId, now)).toBeNull();
    expect(await latestRateRecalc(db, me.workspaceId)).toMatchObject({ status: "failed" });

    await retryRateRecalc(db, me, jobId);
    expect(await refreshRateRecalc(db, me.workspaceId, now)).toBe(jobId);
  });

  it("merges a second request into the waiting job, from the earlier date", async () => {
    const first = await requestRateRecalc(
      db,
      me.workspaceId,
      me.userId,
      new Date("2026-03-10T00:00:00Z"),
    );
    const second = await requestRateRecalc(
      db,
      me.workspaceId,
      me.userId,
      new Date("2026-03-01T00:00:00Z"),
    );
    expect(second).toEqual({ jobId: first.jobId, merged: true });
    const jobs = await db
      .select()
      .from(rateRecalcJob)
      .where(eq(rateRecalcJob.workspaceId, me.workspaceId));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.from.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("runs the next waiting job when one finishes", async () => {
    await entries(3);
    await addRate(5000, new Date(0));
    const first = await requestRateRecalc(db, me.workspaceId, me.userId, new Date(0));
    // Claim the first, then queue a second while it "runs".
    await db
      .update(rateRecalcJob)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(rateRecalcJob.id, first.jobId));
    const second = await requestRateRecalc(db, me.workspaceId, me.userId, new Date(0));
    expect(second.merged).toBe(false);
    await db
      .update(rateRecalcJob)
      .set({ status: "queued", startedAt: null })
      .where(eq(rateRecalcJob.id, first.jobId));

    await runRateRecalcJob(db, first.jobId, { batchSize: 2 });
    const statuses = await db
      .select({ id: rateRecalcJob.id, status: rateRecalcJob.status })
      .from(rateRecalcJob)
      .where(eq(rateRecalcJob.workspaceId, me.workspaceId));
    expect(statuses.every((s) => s.status === "done")).toBe(true);
  });

  it("leaves an entry edited during the job with the amount a fresh resolution gives", async () => {
    await entries(6);
    await addRate(5000, new Date(0));
    const { jobId } = await requestRateRecalc(db, me.workspaceId, me.userId, new Date(0));
    const last = (
      await db
        .select()
        .from(timeEntry)
        .where(eq(timeEntry.workspaceId, me.workspaceId))
        .orderBy(timeEntry.start)
    ).at(-1)!;
    await runRateRecalcJob(db, jobId, {
      batchSize: 3,
      afterBatch: async (done) => {
        if (done !== 1) return;
        // Someone lengthens the last entry between batches.
        await db
          .update(timeEntry)
          .set({ end: new Date(last.start.getTime() + 2 * H), durationSeconds: 7200 })
          .where(eq(timeEntry.id, last.id));
      },
    });
    const after = await db.select().from(timeEntry).where(eq(timeEntry.id, last.id));
    await db.execute(rateEntriesSql(eq(timeEntry.id, last.id)));
    const fresh = await db.select().from(timeEntry).where(eq(timeEntry.id, last.id));
    expect(after[0]?.amountMinor).toBe(fresh[0]?.amountMinor);
    expect(fresh[0]?.amountMinor).toBe(10000);
  });

  it("marks a job running for over 15 minutes as failed", async () => {
    const { jobId } = await requestRateRecalc(db, me.workspaceId, me.userId, new Date(0));
    const now = new Date("2026-03-11T04:00:00Z");
    await db
      .update(rateRecalcJob)
      .set({ status: "running", startedAt: new Date(now.getTime() - 16 * 60_000) })
      .where(eq(rateRecalcJob.id, jobId));
    await expireRateRecalcJobs(db, now);
    expect(await latestRateRecalc(db, me.workspaceId)).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/Retry/),
    });
  });
});

describe("changing the workspace currency", () => {
  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    me = await loadViewer(db, ws.id, olga.id);
  });

  it("relabels every rate and rated entry without converting the amounts", async () => {
    expect(await workspaceHasRates(db, me.workspaceId)).toBe(false);
    await entries(2);
    await addRate(5000, new Date(0));
    expect(await workspaceHasRates(db, me.workspaceId)).toBe(true);
    await db.execute(rateEntriesSql(eq(timeEntry.workspaceId, me.workspaceId)));

    await db.transaction((tx) => relabelWorkspaceCurrency(tx, me.workspaceId, "PHP"));
    const rates = await db.select().from(rate).where(eq(rate.workspaceId, me.workspaceId));
    expect(rates.map((r) => [r.currency, r.amountMinor])).toEqual([["PHP", 5000]]);
    const rated = await db
      .select({ currency: timeEntry.rateCurrency, amount: timeEntry.amountMinor })
      .from(timeEntry)
      .where(and(eq(timeEntry.workspaceId, me.workspaceId)));
    expect(rated).toEqual([
      { currency: "PHP", amount: 5000 },
      { currency: "PHP", amount: 5000 },
    ]);
  });
});
