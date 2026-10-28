import { randomUUID } from "node:crypto";

import { DEFAULT_REPORT_QUERY, type ReportQuery, type ViewerPrefs } from "@timekeep/core";
import { eq, rate, timeEntry, workspaceSettings } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb, createTestUser, createTestWorkspace, truncateAll } from "../../test/db";
import { loadViewer } from "./authz";
import { createProject } from "./catalog/projects";
import { createTag } from "./catalog/tags";
import type { Viewer } from "./catalog/viewer";
import { requestRateRecalc, runRateRecalcJob } from "./rate-recalc";
import { summaryReport } from "./reports";
import { createManualEntry, startTimer, stopTimer, updateEntry } from "./time-entries";

const handle = connectTestDb();
const db = handle.db;

const TZ = "Asia/Manila";
const NOW = new Date("2026-03-11T04:00:00.000Z");
const PREFS: ViewerPrefs = {
  timezone: TZ,
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
/** The week of Mon 2026-03-09 in Manila. */
const q = (over: Partial<ReportQuery> = {}): ReportQuery => ({
  ...DEFAULT_REPORT_QUERY,
  preset: "custom",
  from: "2026-03-08T16:00:00.000Z",
  to: "2026-03-15T16:00:00.000Z",
  ...over,
});
const START = new Date("2026-03-10T01:00:00.000Z");
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

let me: Viewer;
let projectId: string;
let tagId: string;

async function setRules(patch: Partial<typeof workspaceSettings.$inferInsert>) {
  await db
    .update(workspaceSettings)
    .set(patch)
    .where(eq(workspaceSettings.workspaceId, me.workspaceId));
}

const bare = { description: "Work", taskId: null, tagIds: [] as string[], billable: true };

/** Decision 6: a break has no details, no amount, and stays out of reports by default. */
describe("breaks", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    me = await loadViewer(db, ws.id, olga.id);
    await setRules({ allowBreaks: true });
    projectId = (await createProject(db, me, { name: "P" })).id;
    tagId = (await createTag(db, me.workspaceId, { name: "t" })).id;
    await db.insert(rate).values({
      id: randomUUID(),
      workspaceId: me.workspaceId,
      level: "workspace",
      amountMinor: 5000,
      currency: "USD",
      effectiveFrom: new Date(0),
    });
  });

  it("a break is saved without details or amount", async () => {
    const { started } = await startTimer(
      db,
      me,
      { ...bare, description: "Rest", projectId, tagIds: [tagId], type: "break" },
      START,
    );
    expect(started).toMatchObject({ projectId: null, tagIds: [], billable: false, type: "break" });
    const stopped = await stopTimer(db, me, { entryId: started.id }, at(10));
    expect(stopped.durationSeconds).toBe(600);
    const [row] = await db.select().from(timeEntry).where(eq(timeEntry.id, started.id));
    expect(row).toMatchObject({
      type: "break",
      projectId: null,
      billable: false,
      billableRateMinor: null,
      amountMinor: null,
    });
  });

  it("a break cannot take a project, tags or billing later", async () => {
    const brk = await createManualEntry(db, me, {
      ...bare,
      description: "Rest",
      projectId: null,
      billable: false,
      type: "break",
      start: START,
      end: at(30),
    });
    const refused = "A break has no project, tags or billing.";
    await expect(updateEntry(db, me, brk.id, { projectId })).rejects.toThrow(refused);
    await expect(updateEntry(db, me, brk.id, { tagIds: [tagId] })).rejects.toThrow(refused);
    await expect(updateEntry(db, me, brk.id, { billable: true })).rejects.toThrow(refused);
    await expect(updateEntry(db, me, brk.id, { description: "Lunch" })).resolves.toMatchObject({
      description: "Lunch",
      type: "break",
    });
  });

  it("reports count work only unless the Type filter asks", async () => {
    await createManualEntry(db, me, { ...bare, projectId, start: START, end: at(60) });
    await createManualEntry(db, me, {
      ...bare,
      description: "Rest",
      projectId: null,
      billable: false,
      type: "break",
      start: at(60),
      end: at(90),
    });
    const total = async (type: ReportQuery["type"]) =>
      (await summaryReport(db, me, q({ type }), PREFS, NOW)).totals.durationSeconds;
    expect(await total("work")).toBe(3600);
    expect(await summaryReport(db, me, q(), PREFS, NOW)).toMatchObject({
      totals: { durationSeconds: 3600 },
    });
    expect(await total("break")).toBe(1800);
    expect(await total("all")).toBe(5400);
  });

  it("the recalculation job leaves breaks unrated", async () => {
    const work = await createManualEntry(db, me, { ...bare, projectId, start: START, end: at(60) });
    const brk = await createManualEntry(db, me, {
      ...bare,
      description: "Rest",
      projectId: null,
      billable: false,
      type: "break",
      start: at(60),
      end: at(90),
    });
    const { jobId } = await requestRateRecalc(db, me.workspaceId, me.userId, new Date(0));
    await runRateRecalcJob(db, jobId);
    const rows = await db.select().from(timeEntry).where(eq(timeEntry.workspaceId, me.workspaceId));
    expect(rows.find((r) => r.id === work.id)?.billableRateMinor).toBe(5000);
    expect(rows.find((r) => r.id === brk.id)?.billableRateMinor).toBeNull();
  });

  it("a workspace that forbids breaks refuses them", async () => {
    await setRules({ allowBreaks: false });
    await expect(
      startTimer(db, me, { ...bare, projectId: null, billable: false, type: "break" }),
    ).rejects.toThrow("Breaks are not enabled.");
  });
});
