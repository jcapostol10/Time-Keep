import { emailOutbox, eq, userSettings, workspaceSettings } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import { submitPeriod } from "./approvals";
import { loadViewer } from "./authz";
import { runDailyJobs } from "./daily-jobs";
import { createManualEntry } from "./time-entries";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

const work = {
  description: "Work",
  projectId: null,
  taskId: null,
  tagIds: [] as string[],
  billable: false,
};
// Monday 26 Oct 06:00 in Manila: the week of 19–25 Oct just ended there. In New
// York it is still Sunday 25 Oct, and its monthly period ends on 31 Oct.
const MONDAY_MANILA = new Date("2026-10-25T22:00:00.000Z");
const LAST_WEEK = {
  start: new Date("2026-10-20T01:00:00.000Z"),
  end: new Date("2026-10-20T03:00:00.000Z"),
};

let manila: string;
let newYork: string;
let ids: Record<string, string>;

async function settings(
  workspaceId: string,
  patch: Partial<typeof workspaceSettings.$inferInsert>,
) {
  await db
    .update(workspaceSettings)
    .set(patch)
    .where(eq(workspaceSettings.workspaceId, workspaceId));
}

async function remindersTo(userId: string) {
  const u = await db.query.user.findFirst({ where: (t, { eq: e }) => e(t.id, userId) });
  return (await db.select().from(emailOutbox).where(eq(emailOutbox.toAddress, u!.email))).filter(
    (r) => r.kind.startsWith("approval.unsubmitted"),
  );
}

beforeEach(async () => {
  await truncateAll(db);
  const owner = await createTestUser(db, "Olga Owner");
  const tom = await createTestUser(db, "Tom Tracked");
  const sue = await createTestUser(db, "Sue Submitted");
  const max = await createTestUser(db, "Max Muted");
  const nia = await createTestUser(db, "Nia NewYork");
  ids = { owner: owner.id, tom: tom.id, sue: sue.id, max: max.id, nia: nia.id };
  manila = (await createTestWorkspace(db, "Manila", owner.id)).id;
  newYork = (await createTestWorkspace(db, "New York", owner.id)).id;
  await settings(manila, { timezone: "Asia/Manila", weekStart: 1, approvalEnabled: true });
  await settings(newYork, {
    timezone: "America/New_York",
    weekStart: 1,
    approvalEnabled: true,
    approvalPeriod: "MONTHLY",
  });
  for (const who of ["tom", "sue", "max"]) await addMember(db, manila, ids[who]!, "member");
  await addMember(db, newYork, nia.id, "member");
  await db.insert(userSettings).values({ userId: max.id, muteTargetReminders: true });
  for (const who of ["tom", "sue", "max"]) {
    await createManualEntry(
      db,
      await loadViewer(db, manila, ids[who]!),
      { ...work, ...LAST_WEEK },
      MONDAY_MANILA,
    );
  }
  await createManualEntry(
    db,
    await loadViewer(db, newYork, nia.id),
    { ...work, ...LAST_WEEK },
    MONDAY_MANILA,
  );
  await submitPeriod(db, await loadViewer(db, manila, sue.id), "2026-10-19", MONDAY_MANILA);
});

describe("runDailyJobs", () => {
  it("reminds whoever has unsubmitted time in a period that just ended, in each workspace's zone", async () => {
    expect(await runDailyJobs(db, { now: MONDAY_MANILA })).toEqual({ reminders: 1 });
    const [reminder] = await remindersTo(ids.tom!);
    expect(reminder).toMatchObject({
      kind: "approval.unsubmitted:2026-10-19",
      subject: "Submit your time for 19 – 25 Oct 2026",
      workspaceId: manila,
    });
    // Sue submitted, Max muted reminders, and New York's month has not ended.
    expect(await remindersTo(ids.sue!)).toEqual([]);
    expect(await remindersTo(ids.max!)).toEqual([]);
    expect(await remindersTo(ids.nia!)).toEqual([]);
  });

  it("sends each reminder once", async () => {
    await runDailyJobs(db, { now: MONDAY_MANILA });
    expect(await runDailyJobs(db, { now: new Date(MONDAY_MANILA.getTime() + 3_600_000) })).toEqual({
      reminders: 0,
    });
    expect(await remindersTo(ids.tom!)).toHaveLength(1);
  });

  it("does nothing on a day that does not follow a period, or with approval off", async () => {
    expect(await runDailyJobs(db, { now: new Date("2026-10-27T22:00:00.000Z") })).toEqual({
      reminders: 0,
    });
    await settings(manila, { approvalEnabled: false });
    expect(await runDailyJobs(db, { now: MONDAY_MANILA })).toEqual({ reminders: 0 });
  });

  it("runs only the workspaces asked for", async () => {
    expect(await runDailyJobs(db, { now: MONDAY_MANILA, workspaceIds: [newYork] })).toEqual({
      reminders: 0,
    });
    expect(await runDailyJobs(db, { now: MONDAY_MANILA, workspaceIds: [manila] })).toEqual({
      reminders: 1,
    });
  });
});
