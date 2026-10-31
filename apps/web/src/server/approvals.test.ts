import {
  and,
  approvalEvent,
  approvalRequest,
  emailOutbox,
  eq,
  managedUser,
  projectMember,
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
import {
  checkApprovalSettings,
  listApprovals,
  myPeriods,
  periodView,
  reopenRequest,
  reviewRequests,
  submitPeriod,
  withdrawPendingRequests,
  withdrawRequest,
} from "./approvals";
import { loadViewer } from "./authz";
import { createProject } from "./catalog/projects";
import type { Viewer } from "./catalog/viewer";
import { createManualEntry, startTimer, updateEntry } from "./time-entries";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

// Asia/Manila, Monday weeks; "now" is Wednesday 28 Oct 12:00 local.
const NOW = new Date("2026-10-28T04:00:00.000Z");
const LAST_WEEK = "2026-10-19";
const at = (iso: string) => new Date(iso);
const work = { description: "Work", taskId: null, tagIds: [] as string[], billable: false };

let wsId: string;
let ids: Record<string, string>;
let mobileId: string;
let webId: string;
const viewer = (who: string): Promise<Viewer> => loadViewer(db, wsId, ids[who]!);

async function setRules(patch: Partial<typeof workspaceSettings.$inferInsert>) {
  await db.update(workspaceSettings).set(patch).where(eq(workspaceSettings.workspaceId, wsId));
}

async function entry(
  who: string,
  startIso: string,
  minutes: number,
  projectId: string | null = null,
  billable = false,
) {
  const start = at(startIso);
  return createManualEntry(
    db,
    await viewer(who),
    { ...work, projectId, billable, start, end: new Date(start.getTime() + minutes * 60_000) },
    NOW,
  );
}

async function outboxTo(userId: string) {
  const v = await db.query.user.findFirst({ where: (u, { eq: e }) => e(u.id, userId) });
  return db.select().from(emailOutbox).where(eq(emailOutbox.toAddress, v!.email));
}

async function events(action?: typeof approvalEvent.$inferSelect.action) {
  return db
    .select()
    .from(approvalEvent)
    .where(
      and(
        eq(approvalEvent.workspaceId, wsId),
        action ? eq(approvalEvent.action, action) : undefined,
      ),
    );
}

beforeEach(async () => {
  await truncateAll(db);
  const olga = await createTestUser(db, "Olga Owner");
  const ann = await createTestUser(db, "Ann Admin");
  const max = await createTestUser(db, "Max Manager");
  const pat = await createTestUser(db, "Pat Projects");
  const bob = await createTestUser(db, "Bob Member");
  const carol = await createTestUser(db, "Carol Member");
  const ws = await createTestWorkspace(db, "Workspace", olga.id);
  wsId = ws.id;
  ids = { olga: olga.id, ann: ann.id, max: max.id, pat: pat.id, bob: bob.id, carol: carol.id };
  await addMember(db, wsId, ann.id, "admin");
  await addMember(db, wsId, max.id, "manager");
  await addMember(db, wsId, pat.id, "manager");
  await addMember(db, wsId, bob.id, "member");
  await addMember(db, wsId, carol.id, "member");
  await db.insert(managedUser).values({ workspaceId: wsId, managerId: max.id, userId: bob.id });
  const owner = await viewer("olga");
  mobileId = (await createProject(db, owner, { name: "Mobile" })).id;
  webId = (await createProject(db, owner, { name: "Web" })).id;
  await db.insert(projectMember).values({ projectId: mobileId, userId: pat.id, isManager: true });
  await setRules({ timezone: "Asia/Manila", weekStart: 1, approvalEnabled: true });
  // Bob: 1 h billable + 30 min last week. Carol: 2 h on Mobile last week.
  await entry("bob", "2026-10-20T01:00:00.000Z", 60, webId, true);
  await entry("bob", "2026-10-21T01:00:00.000Z", 30);
  await entry("carol", "2026-10-20T01:00:00.000Z", 120, mobileId);
});

describe("submitPeriod", () => {
  it("makes a pending request with the period's totals, logs it and tells the approvers", async () => {
    const request = await submitPeriod(db, await viewer("bob"), LAST_WEEK, NOW);
    expect(request).toMatchObject({
      status: "PENDING",
      periodStart: "2026-10-19",
      periodEnd: "2026-10-25",
      workSeconds: 5400,
      billableSeconds: 3600,
      entryCount: 2,
      userName: "Bob Member",
    });
    expect(await events("SUBMIT")).toHaveLength(1);
    // Approvers are owners and admins by default.
    expect(await outboxTo(ids.olga!)).toHaveLength(1);
    expect(await outboxTo(ids.ann!)).toHaveLength(1);
    expect(await outboxTo(ids.max!)).toHaveLength(0);
    expect((await outboxTo(ids.olga!))[0]?.subject).toBe(
      "Bob Member submitted 19 – 25 Oct 2026 for approval",
    );
  });

  it("refuses while a timer runs in the period", async () => {
    const bob = await viewer("bob");
    await startTimer(db, bob, { ...work, projectId: null }, NOW);
    await expect(submitPeriod(db, bob, "2026-10-26", NOW)).rejects.toThrow(
      "Stop the timer before submitting this period.",
    );
  });

  it("refuses a period that overlaps one already submitted", async () => {
    const bob = await viewer("bob");
    await submitPeriod(db, bob, LAST_WEEK, NOW);
    await expect(submitPeriod(db, bob, LAST_WEEK, NOW)).rejects.toThrow("already submitted");
    // The period type changes to semi-monthly: 16–31 Oct overlaps the submitted week.
    await setRules({ approvalPeriod: "SEMI_MONTHLY" });
    await expect(submitPeriod(db, bob, "2026-10-16", NOW)).rejects.toThrow(
      "This overlaps 19 – 25 Oct 2026, already submitted.",
    );
  });

  it("refuses a day that does not start a period, a period not begun, and approval off", async () => {
    const bob = await viewer("bob");
    await expect(submitPeriod(db, bob, "2026-10-20", NOW)).rejects.toThrow("first day");
    await expect(submitPeriod(db, bob, "2026-11-02", NOW)).rejects.toThrow("has not started");
    await setRules({ approvalEnabled: false });
    await expect(submitPeriod(db, bob, LAST_WEEK, NOW)).rejects.toThrow("Approval is off");
  });

  it("resubmits a rejected period", async () => {
    const bob = await viewer("bob");
    const request = await submitPeriod(db, bob, LAST_WEEK, NOW);
    await reviewRequests(
      db,
      await viewer("ann"),
      { ids: [request.id], decision: "REJECT", note: "Add Friday" },
      NOW,
    );
    // Rejected time is editable again: Bob adds Friday.
    await entry("bob", "2026-10-23T01:00:00.000Z", 15);
    const again = await submitPeriod(db, bob, LAST_WEEK, NOW);
    expect(again).toMatchObject({
      id: request.id,
      status: "PENDING",
      note: null,
      decidedBy: null,
      workSeconds: 5400 + 900,
    });
  });
});

describe("withdrawRequest", () => {
  it("removes a pending request and logs it", async () => {
    const bob = await viewer("bob");
    const request = await submitPeriod(db, bob, LAST_WEEK, NOW);
    await withdrawRequest(db, bob, request.id);
    expect(await db.select().from(approvalRequest)).toEqual([]);
    const [withdrawn] = await events("WITHDRAW");
    expect(withdrawn).toMatchObject({ userId: ids.bob, actorId: ids.bob, requestId: null });
  });

  it("is only for one's own pending request", async () => {
    const request = await submitPeriod(db, await viewer("bob"), LAST_WEEK, NOW);
    await expect(withdrawRequest(db, await viewer("carol"), request.id)).rejects.toMatchObject({
      status: 404,
    });
    await reviewRequests(db, await viewer("ann"), { ids: [request.id], decision: "APPROVE" }, NOW);
    await expect(withdrawRequest(db, await viewer("bob"), request.id)).rejects.toThrow("pending");
  });
});

describe("reviewRequests", () => {
  it("follows the approvers setting", async () => {
    const bobs = await submitPeriod(db, await viewer("bob"), LAST_WEEK, NOW);
    const carols = await submitPeriod(db, await viewer("carol"), LAST_WEEK, NOW);
    const approve = async (who: string, id: string) =>
      reviewRequests(db, await viewer(who), { ids: [id], decision: "APPROVE" }, NOW);

    // Admins only (the default): Max may not review Bob.
    await expect(approve("max", bobs.id)).rejects.toMatchObject({ status: 404 });
    await setRules({ approvalReviewers: "TEAM_MANAGERS" });
    // Pat manages Mobile, not Carol: not at TEAM_MANAGERS.
    await expect(approve("pat", carols.id)).rejects.toMatchObject({ status: 404 });
    await approve("max", bobs.id);
    await setRules({ approvalReviewers: "PROJECT_MANAGERS" });
    await approve("pat", carols.id);
    const rows = await db.select().from(approvalRequest);
    expect(rows.map((r) => r.status)).toEqual(["APPROVED", "APPROVED"]);
    expect(rows.find((r) => r.id === bobs.id)?.decidedBy).toBe(ids.max);
    expect(await outboxTo(ids.bob!)).toHaveLength(1);
  });

  it("never lets a manager approve their own, but lets an admin", async () => {
    await setRules({ approvalReviewers: "TEAM_MANAGERS" });
    await entry("max", "2026-10-20T03:00:00.000Z", 60);
    await entry("ann", "2026-10-20T03:00:00.000Z", 60);
    const maxs = await submitPeriod(db, await viewer("max"), LAST_WEEK, NOW);
    const anns = await submitPeriod(db, await viewer("ann"), LAST_WEEK, NOW);
    await expect(
      reviewRequests(db, await viewer("max"), { ids: [maxs.id], decision: "APPROVE" }, NOW),
    ).rejects.toMatchObject({ status: 404 });
    await reviewRequests(db, await viewer("ann"), { ids: [anns.id], decision: "APPROVE" }, NOW);
  });

  it("rejects with a note the member sees", async () => {
    const request = await submitPeriod(db, await viewer("bob"), LAST_WEEK, NOW);
    await expect(
      reviewRequests(db, await viewer("ann"), { ids: [request.id], decision: "REJECT" }, NOW),
    ).rejects.toThrow("Say what needs fixing");
    await reviewRequests(
      db,
      await viewer("ann"),
      { ids: [request.id], decision: "REJECT", note: "Add Friday" },
      NOW,
    );
    const [mine] = await myPeriods(
      db,
      await viewer("bob"),
      { from: at("2026-10-18T16:00:00.000Z"), to: at("2026-10-25T16:00:00.000Z") },
      NOW,
    );
    expect(mine).toMatchObject({ status: "REJECTED", note: "Add Friday", canSubmit: true });
    expect((await outboxTo(ids.bob!))[0]?.subject).toContain("needs changes");
  });

  it("changes nothing when one of the requests is not the reviewer's", async () => {
    await setRules({ approvalReviewers: "TEAM_MANAGERS" });
    const bobs = await submitPeriod(db, await viewer("bob"), LAST_WEEK, NOW);
    const carols = await submitPeriod(db, await viewer("carol"), LAST_WEEK, NOW);
    await expect(
      reviewRequests(
        db,
        await viewer("max"),
        { ids: [bobs.id, carols.id], decision: "APPROVE" },
        NOW,
      ),
    ).rejects.toMatchObject({ status: 404 });
    const rows = await db.select().from(approvalRequest);
    expect(rows.every((r) => r.status === "PENDING")).toBe(true);
  });

  it("only decides pending requests", async () => {
    const request = await submitPeriod(db, await viewer("bob"), LAST_WEEK, NOW);
    const ann = await viewer("ann");
    await reviewRequests(db, ann, { ids: [request.id], decision: "APPROVE" }, NOW);
    await expect(
      reviewRequests(db, ann, { ids: [request.id], decision: "REJECT", note: "Too late" }, NOW),
    ).rejects.toThrow("pending");
  });
});

describe("reopenRequest", () => {
  it("sends an approved period back for correction", async () => {
    const bob = await viewer("bob");
    const request = await submitPeriod(db, bob, LAST_WEEK, NOW);
    const ann = await viewer("ann");
    await reviewRequests(db, ann, { ids: [request.id], decision: "APPROVE" }, NOW);
    const [inWeek] = await db.query.timeEntry.findMany({
      where: (t, { eq: e }) => e(t.userId, ids.bob!),
    });
    await expect(
      updateEntry(db, bob, inWeek!.id, { description: "Late fix" }, NOW),
    ).rejects.toThrow("This period is approved.");
    await reopenRequest(db, ann, request.id, "The client found a mistake", NOW);
    expect((await db.select().from(approvalRequest))[0]).toMatchObject({
      status: "REJECTED",
      note: "The client found a mistake",
    });
    expect(await events("REOPEN")).toHaveLength(1);
    await expect(
      updateEntry(db, bob, inWeek!.id, { description: "Late fix" }, NOW),
    ).resolves.toBeDefined();
  });

  it("is only for approved requests and reviewers", async () => {
    const request = await submitPeriod(db, await viewer("bob"), LAST_WEEK, NOW);
    await expect(
      reopenRequest(db, await viewer("ann"), request.id, "Not yet", NOW),
    ).rejects.toThrow("approved");
    await reviewRequests(db, await viewer("ann"), { ids: [request.id], decision: "APPROVE" }, NOW);
    // Members never review: a 403 (the request is Bob's own, no secret to keep).
    await expect(
      reopenRequest(db, await viewer("bob"), request.id, "Mine", NOW),
    ).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("listApprovals", () => {
  it("shows each reviewer the requests they may decide", async () => {
    await setRules({ approvalReviewers: "TEAM_MANAGERS" });
    await submitPeriod(db, await viewer("bob"), LAST_WEEK, NOW);
    await submitPeriod(db, await viewer("carol"), LAST_WEEK, NOW);
    const names = async (who: string, tab: "pending" | "archive" | "unsubmitted") =>
      ((await listApprovals(db, await viewer(who), { tab }, NOW)) as { userName: string }[])
        .map((r) => r.userName)
        .sort();
    expect(await names("ann", "pending")).toEqual(["Bob Member", "Carol Member"]);
    expect(await names("max", "pending")).toEqual(["Bob Member"]);
    expect(await names("pat", "pending")).toEqual([]);
    expect(await names("bob", "pending")).toEqual([]);
    await setRules({ approvalReviewers: "PROJECT_MANAGERS" });
    expect(await names("pat", "pending")).toEqual(["Carol Member"]);
  });

  it("archives decided requests", async () => {
    const request = await submitPeriod(db, await viewer("bob"), LAST_WEEK, NOW);
    await reviewRequests(db, await viewer("ann"), { ids: [request.id], decision: "APPROVE" }, NOW);
    const archive = await listApprovals(db, await viewer("olga"), { tab: "archive" }, NOW);
    expect(archive).toHaveLength(1);
    expect(await listApprovals(db, await viewer("olga"), { tab: "pending" }, NOW)).toEqual([]);
  });

  it("lists closed periods with time and no request as unsubmitted", async () => {
    await submitPeriod(db, await viewer("bob"), LAST_WEEK, NOW);
    const rows = (await listApprovals(db, await viewer("ann"), { tab: "unsubmitted" }, NOW)) as {
      userName: string;
      periodStart: string;
      workSeconds: number;
    }[];
    expect(rows).toEqual([
      expect.objectContaining({
        userName: "Carol Member",
        periodStart: "2026-10-19",
        workSeconds: 7200,
      }),
    ]);
  });
});

describe("periodView", () => {
  it("shows the owner and reviewers the period's days and history, and nobody else", async () => {
    const request = await submitPeriod(db, await viewer("bob"), LAST_WEEK, NOW);
    const view = await periodView(db, await viewer("ann"), request.id);
    expect(view.days.map((d) => d.dateKey)).toEqual(["2026-10-20", "2026-10-21"]);
    expect(view.totals).toEqual({ workSeconds: 5400, billableSeconds: 3600, entryCount: 2 });
    expect(view.events.map((e) => e.action)).toEqual(["SUBMIT"]);
    expect(view.canReview).toBe(true);
    expect((await periodView(db, await viewer("bob"), request.id)).canReview).toBe(false);
    await expect(periodView(db, await viewer("carol"), request.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("a submit racing an edit", () => {
  it("never leaves an edit after the totals in a submitted period", async () => {
    const bob = await viewer("bob");
    const [inWeek] = await db.query.timeEntry.findMany({
      where: (t, { eq: e }) => e(t.userId, ids.bob!),
    });
    const other = connectTestDb();
    try {
      const [submitted, edited] = await Promise.allSettled([
        submitPeriod(db, bob, LAST_WEEK, NOW),
        updateEntry(
          other.db,
          bob,
          inWeek!.id,
          { end: new Date(inWeek!.end!.getTime() + 30 * 60_000) },
          NOW,
        ),
      ]);
      expect(submitted.status).toBe("fulfilled");
      const [request] = await db.select().from(approvalRequest);
      if (edited.status === "fulfilled") {
        // The edit went first: the totals include its 30 minutes.
        expect(request?.workSeconds).toBe(5400 + 1800);
      } else {
        expect(String(edited.reason)).toContain("This period is submitted for approval.");
        expect(request?.workSeconds).toBe(5400);
      }
    } finally {
      await other.close();
    }
  });
});

describe("approval settings", () => {
  it("refuses a new period type while a request is pending", async () => {
    await submitPeriod(db, await viewer("bob"), LAST_WEEK, NOW);
    const current = { approvalEnabled: true, approvalPeriod: "WEEKLY" };
    expect(
      await checkApprovalSettings(
        db,
        wsId,
        current,
        { approvalEnabled: true, approvalPeriod: "MONTHLY" },
        false,
      ),
    ).toEqual({ field: "approvalPeriod", message: "Approve or reject the pending periods first." });
    expect(await checkApprovalSettings(db, wsId, current, current, false)).toBeNull();
  });

  it("asks before turning approval off, then withdraws the pending periods and keeps approved ones", async () => {
    const bobs = await submitPeriod(db, await viewer("bob"), LAST_WEEK, NOW);
    const carols = await submitPeriod(db, await viewer("carol"), LAST_WEEK, NOW);
    await reviewRequests(db, await viewer("ann"), { ids: [carols.id], decision: "APPROVE" }, NOW);
    const current = { approvalEnabled: true, approvalPeriod: "WEEKLY" };
    const off = { approvalEnabled: false, approvalPeriod: "WEEKLY" };
    expect(await checkApprovalSettings(db, wsId, current, off, false)).toEqual({
      field: "confirmApprovalOff",
      message: "1 pending period will be withdrawn.",
    });
    expect(await checkApprovalSettings(db, wsId, current, off, true)).toBeNull();

    await db.transaction((tx) => withdrawPendingRequests(tx, wsId, ids.olga!));
    await setRules({ approvalEnabled: false });
    const rows = await db.select().from(approvalRequest);
    expect(rows.map((r) => [r.id, r.status])).toEqual([[carols.id, "APPROVED"]]);
    const [auto] = await events("AUTO_WITHDRAW");
    expect(auto).toMatchObject({ userId: ids.bob, actorId: ids.olga, requestId: null });
    expect(bobs.id).toBeDefined();

    // Approved time stays read-only after approval is off.
    const [carolsEntry] = await db.query.timeEntry.findMany({
      where: (t, { eq: e }) => e(t.userId, ids.carol!),
    });
    await expect(
      updateEntry(db, await viewer("carol"), carolsEntry!.id, { description: "Later" }, NOW),
    ).rejects.toThrow("This period is approved.");
  });
});
