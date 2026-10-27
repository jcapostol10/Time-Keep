import { DEFAULT_REPORT_QUERY, type ReportQuery, type ViewerPrefs } from "@timekeep/core";
import { eq, exportJob } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
  asViewer,
} from "../../test/db";
import type { Viewer } from "./catalog/viewer";
import {
  createExportJob,
  exportDownloadUrl,
  expireExportJobs,
  listExportJobs,
  retryExportJob,
  runExportJob,
} from "./export-jobs";
import { createManualEntry } from "./time-entries";

const handle = connectTestDb();
const db = handle.db;

const PREFS: ViewerPrefs = {
  timezone: "Asia/Manila",
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
const QUERY: ReportQuery = {
  ...DEFAULT_REPORT_QUERY,
  preset: "custom",
  from: "2026-03-08T16:00:00.000Z",
  to: "2026-03-15T16:00:00.000Z",
};
const NOW = new Date("2026-03-11T04:00:00.000Z");

let alice: Viewer;
let bob: Viewer;

describe("export jobs", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const a = await createTestUser(db, "Alice A");
    const b = await createTestUser(db, "Bob B");
    const ws = await createTestWorkspace(db, "Workspace A", a.id);
    await addMember(db, ws.id, b.id, "member");
    alice = asViewer({ workspaceId: ws.id, userId: a.id, role: "owner" });
    bob = asViewer({ workspaceId: ws.id, userId: b.id, role: "member" });
    for (let i = 0; i < 3; i++) {
      await createManualEntry(db, alice, {
        description: `Work ${i}`,
        projectId: null,
        taskId: null,
        tagIds: [],
        billable: false,
        start: new Date(Date.UTC(2026, 2, 9, 1 + i)),
        end: new Date(Date.UTC(2026, 2, 9, 1 + i, 30)),
      });
    }
  });

  it("builds a queued job into a stored file, marks it done and tells its owner", async () => {
    const job = await createExportJob(db, alice, {
      report: "detailed",
      format: "csv",
      query: QUERY,
      prefs: PREFS,
      now: NOW,
    });
    expect(job.status).toBe("queued");
    const notify = vi.fn().mockResolvedValue(undefined);
    await runExportJob(db, job.id, { notify, now: NOW });

    const [done] = await db.select().from(exportJob).where(eq(exportJob.id, job.id));
    expect(done).toMatchObject({ status: "done", rowCount: 3, error: null });
    expect(done!.objectKey).toMatch(new RegExp(`^exports/${alice.workspaceId}/${job.id}\\.csv$`));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: job.id, status: "done" }));

    const url = await exportDownloadUrl(db, alice, job.id, NOW);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Work 2");
    // Only its owner can download it.
    await expect(exportDownloadUrl(db, bob, job.id, NOW)).rejects.toThrow(/not found/i);
  });

  it("records a failure with a message, and a retry runs it again", async () => {
    const job = await createExportJob(db, alice, {
      report: "detailed",
      format: "csv",
      query: QUERY,
      prefs: PREFS,
      now: NOW,
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    await runExportJob(db, job.id, {
      notify,
      now: NOW,
      build: () => Promise.reject(new Error("boom")),
    });
    const [failed] = await db.select().from(exportJob).where(eq(exportJob.id, job.id));
    expect(failed).toMatchObject({ status: "failed", error: "The export could not be built." });

    const retried = await retryExportJob(db, alice, job.id);
    expect(retried.status).toBe("queued");
    await runExportJob(db, job.id, { notify, now: NOW });
    const [done] = await db.select().from(exportJob).where(eq(exportJob.id, job.id));
    expect(done!.status).toBe("done");
  });

  it("lists a person's own jobs, newest first", async () => {
    const first = await createExportJob(db, alice, {
      report: "summary",
      format: "csv",
      query: QUERY,
      prefs: PREFS,
      now: NOW,
    });
    const second = await createExportJob(db, alice, {
      report: "weekly",
      format: "xlsx",
      query: QUERY,
      prefs: PREFS,
      now: new Date(NOW.getTime() + 1000),
    });
    await createExportJob(db, bob, {
      report: "summary",
      format: "csv",
      query: QUERY,
      prefs: PREFS,
      now: NOW,
    });
    expect((await listExportJobs(db, alice)).map((j) => j.id)).toEqual([second.id, first.id]);
  });

  it("expires old files and fails jobs stuck running", async () => {
    const job = await createExportJob(db, alice, {
      report: "detailed",
      format: "csv",
      query: QUERY,
      prefs: PREFS,
      now: NOW,
    });
    await runExportJob(db, job.id, { notify: vi.fn().mockResolvedValue(undefined), now: NOW });
    const stuck = await createExportJob(db, alice, {
      report: "summary",
      format: "csv",
      query: QUERY,
      prefs: PREFS,
      now: NOW,
    });
    await db.update(exportJob).set({ status: "running" }).where(eq(exportJob.id, stuck.id));

    const later = new Date(NOW.getTime() + 8 * 24 * 3_600_000);
    await expireExportJobs(db, later);
    const rows = await db.select().from(exportJob);
    const expired = rows.find((r) => r.id === job.id)!;
    expect(expired.objectKey).toBeNull();
    await expect(exportDownloadUrl(db, alice, job.id, later)).rejects.toThrow(/expired/i);
    expect(rows.find((r) => r.id === stuck.id)).toMatchObject({
      status: "failed",
      error: "The export timed out.",
    });
  });

  it("times out a job by when its build started, so a late retry is not failed mid-build", async () => {
    const job = await createExportJob(db, alice, {
      report: "detailed",
      format: "csv",
      query: QUERY,
      prefs: PREFS,
      now: NOW,
    });
    const retriedAt = new Date(NOW.getTime() + 60 * 60_000);
    let statusMidBuild: string | undefined;
    await runExportJob(db, job.id, {
      now: retriedAt,
      notify: vi.fn().mockResolvedValue(undefined),
      build: async () => {
        // Another export's housekeeping runs while this one builds.
        await expireExportJobs(db, new Date(retriedAt.getTime() + 60_000));
        const [row] = await db.select().from(exportJob).where(eq(exportJob.id, job.id));
        statusMidBuild = row?.status;
        return {
          filename: "x.csv",
          contentType: "text/csv",
          body: new Uint8Array([1]),
          rowCount: 1,
        };
      },
    });
    expect(statusMidBuild).toBe("running");
    const [row] = await db.select().from(exportJob).where(eq(exportJob.id, job.id));
    expect(row?.startedAt?.toISOString()).toBe(retriedAt.toISOString());

    // Still stuck 15 minutes after its start: failed.
    await db.update(exportJob).set({ status: "running" }).where(eq(exportJob.id, job.id));
    await expireExportJobs(db, new Date(retriedAt.getTime() + 16 * 60_000));
    const [stuck] = await db.select().from(exportJob).where(eq(exportJob.id, job.id));
    expect(stuck).toMatchObject({ status: "failed", error: "The export timed out." });
  });
});
