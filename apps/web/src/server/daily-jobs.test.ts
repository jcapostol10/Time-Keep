import { randomUUID } from "node:crypto";

import {
  emailOutbox,
  eq,
  invoice,
  like,
  payment,
  user,
  userSettings,
  workspaceSettings,
} from "@timekeep/db";
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
import { createClient } from "./catalog/clients";
import { e2eWorkspaceId, runDailyJobs } from "./daily-jobs";
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
    expect(await runDailyJobs(db, { now: MONDAY_MANILA })).toEqual({
      reminders: 1,
      targets: 0,
      budgets: 0,
      invoices: { created: 0, sent: 0, overdue: 0 },
    });
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
      targets: 0,
      budgets: 0,
      invoices: { created: 0, sent: 0, overdue: 0 },
    });
    expect(await remindersTo(ids.tom!)).toHaveLength(1);
  });

  it("does nothing on a day that does not follow a period, or with approval off", async () => {
    expect(await runDailyJobs(db, { now: new Date("2026-10-27T22:00:00.000Z") })).toEqual({
      reminders: 0,
      targets: 0,
      budgets: 0,
      invoices: { created: 0, sent: 0, overdue: 0 },
    });
    await settings(manila, { approvalEnabled: false });
    expect(await runDailyJobs(db, { now: MONDAY_MANILA })).toEqual({
      reminders: 0,
      targets: 0,
      budgets: 0,
      invoices: { created: 0, sent: 0, overdue: 0 },
    });
  });

  it("runs only the workspaces asked for", async () => {
    expect(await runDailyJobs(db, { now: MONDAY_MANILA, workspaceIds: [newYork] })).toEqual({
      reminders: 0,
      targets: 0,
      budgets: 0,
      invoices: { created: 0, sent: 0, overdue: 0 },
    });
    expect(await runDailyJobs(db, { now: MONDAY_MANILA, workspaceIds: [manila] })).toEqual({
      reminders: 1,
      targets: 0,
      budgets: 0,
      invoices: { created: 0, sent: 0, overdue: 0 },
    });
  });
});

describe("overdue invoices (Phase 6d)", () => {
  const overdueRows = () =>
    db.select().from(emailOutbox).where(like(emailOutbox.kind, "invoice.overdue:%"));

  /** A sent invoice of `total` in `workspaceId`, due 24 Oct (yesterday in Manila on MONDAY_MANILA). */
  async function sentInvoice(workspaceId: string, total: number, dueDate = "2026-10-24") {
    const id = randomUUID();
    const c = await createClient(db, workspaceId, {
      name: `Client ${id.slice(0, 6)}`,
      address: "",
      email: "",
      notes: "",
      currency: null,
    });
    await db.insert(invoice).values({
      id,
      workspaceId,
      clientId: c.id,
      number: `INV-${id.slice(0, 6)}`,
      issueDate: "2026-10-19",
      dueDate,
      currency: "USD",
      status: "SENT",
      subtotalMinor: total,
      totalMinor: total,
    });
    return id;
  }

  it("the overdue email goes once per invoice, to the owners and admins", async () => {
    const due = await sentInvoice(manila, 10000);
    const paid = await sentInvoice(manila, 10000);
    await db
      .insert(payment)
      .values({ id: randomUUID(), invoiceId: paid, date: "2026-10-20", amountMinor: 10000 });
    await sentInvoice(manila, 10000, "2026-10-26"); // not due yet
    expect(await runDailyJobs(db, { now: MONDAY_MANILA, workspaceIds: [manila] })).toMatchObject({
      invoices: { created: 0, sent: 0, overdue: 1 },
    });
    const owner = await db.query.user.findFirst({ where: (t, { eq: e }) => e(t.id, ids.owner!) });
    const rows = await overdueRows();
    expect(rows.map((r) => [r.kind, r.toAddress, r.workspaceId])).toEqual([
      [`invoice.overdue:${due}`, owner!.email, manila],
    ]);
    expect(rows[0]?.subject).toContain(`INV-${due.slice(0, 6)}`);
    expect(
      await runDailyJobs(db, {
        now: new Date(MONDAY_MANILA.getTime() + 3_600_000),
        workspaceIds: [manila],
      }),
    ).toMatchObject({ invoices: { overdue: 0 } });
    expect(await overdueRows()).toHaveLength(1);
  });

  it("a workspace with nothing but a sent invoice is still visited", async () => {
    const quiet = (await createTestWorkspace(db, "Quiet", ids.owner!)).id;
    await settings(quiet, { timezone: "Asia/Manila", approvalEnabled: false });
    const due = await sentInvoice(quiet, 5000);
    expect(await runDailyJobs(db, { now: MONDAY_MANILA })).toEqual({
      reminders: 1,
      targets: 0,
      budgets: 0,
      invoices: { created: 0, sent: 0, overdue: 1 },
    });
    expect((await overdueRows()).map((r) => r.kind)).toEqual([`invoice.overdue:${due}`]);
  });
});

describe("e2eWorkspaceId", () => {
  it("finds a workspace for the e2e hook only when every member is an e2e or demo user", async () => {
    const [e2eUser] = await db
      .insert(user)
      .values({ id: "u-e2e", name: "E2E", email: "fresh.1@e2e.test", emailVerified: true })
      .returning();
    const fenced = await createTestWorkspace(db, "Fenced", e2eUser!.id);
    const slugOf = async (id: string) =>
      (await db.query.workspace.findFirst({ where: (w, { eq: e }) => e(w.id, id) }))!.slug;
    expect(await e2eWorkspaceId(db, await slugOf(fenced.id))).toBe(fenced.id);
    // A customer's workspace (a real member) is never touched by the hook.
    expect(await e2eWorkspaceId(db, await slugOf(manila))).toBeNull();
    expect(await e2eWorkspaceId(db, "no-such-workspace")).toBeNull();
  });
});
