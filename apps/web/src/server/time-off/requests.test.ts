import type { TimeOffPolicyInput } from "@timekeep/core";
import { and, emailOutbox, eq, timeOffPolicy, timeOffRequest } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb } from "../../../test/db";
import { setUpTimeOffCast, type TimeOffCast } from "../../../test/time-off-fixtures";
import { listBalances } from "./balances";
import { timeOffCalendar } from "./calendar";
import { saveHoliday } from "./holidays";
import { savePolicy } from "./policies";
import {
  cancelTimeOff,
  listTimeOffRequests,
  previewTimeOff,
  requestTimeOff,
  reviewTimeOff,
  timeOffRange,
  withdrawTimeOff,
} from "./requests";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

// Monday 2 Nov 2026, noon in Manila.
const NOW = new Date("2026-11-02T04:00:00.000Z");
const TODAY = "2026-11-02";

let cast: TimeOffCast;
let vacationId: string;
let sickId: string;

const policy = (extra: Partial<TimeOffPolicyInput>): TimeOffPolicyInput => ({
  name: "Vacation",
  unit: "DAYS",
  accrual: "YEARLY",
  allowance: "15",
  allowNegative: false,
  requiresApproval: true,
  everyone: true,
  userIds: [],
  groupIds: [],
  ...extra,
});

const ask = (start: string, end: string, extra: Record<string, unknown> = {}) => ({
  policyId: vacationId,
  start,
  end,
  halfDay: false,
  note: "",
  ...extra,
});

async function outbox(kind: string) {
  return db
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.workspaceId, cast.wsId), eq(emailOutbox.kind, kind)));
}

async function emailOf(who: keyof TimeOffCast["ids"]) {
  const u = await db.query.user.findFirst({ where: (t, { eq: e }) => e(t.id, cast.ids[who]) });
  return u!.email;
}

beforeEach(async () => {
  cast = await setUpTimeOffCast(db);
  const ann = await cast.viewer("ann");
  vacationId = (await savePolicy(db, ann, policy({}))).id;
  sickId = (
    await savePolicy(
      db,
      ann,
      policy({
        name: "Sick",
        accrual: "NONE",
        allowance: "",
        allowNegative: true,
        requiresApproval: false,
      }),
    )
  ).id;
  await db.update(timeOffPolicy).set({ createdAt: new Date("2025-01-01T00:00:00Z") });
  // A holiday for the Cebu group on Wednesday 11 Nov.
  await saveHoliday(db, ann, {
    date: "2026-11-11",
    name: "Cebu Day",
    repeatsYearly: false,
    userIds: [],
    groupIds: [cast.cebuId],
  });
});

describe("requestTimeOff", () => {
  it("counts working days less the person's holidays and tells the approvers", async () => {
    await cast.setRules({ approvalReviewers: "TEAM_MANAGERS" });
    const r = await requestTimeOff(
      db,
      await cast.viewer("bob"),
      ask("2026-11-09", "2026-11-13"),
      NOW,
    );
    expect(r).toMatchObject({ amountCenti: 400, status: "PENDING", policyName: "Vacation" });
    const to = (await outbox("timeOff.requested")).map((m) => m.toAddress).sort();
    expect(to).toEqual([await emailOf("olga"), await emailOf("ann"), await emailOf("max")].sort());
  });

  it("does not tell a manager when only admins approve", async () => {
    await requestTimeOff(db, await cast.viewer("bob"), ask("2026-11-09", "2026-11-13"), NOW);
    const to = (await outbox("timeOff.requested")).map((m) => m.toAddress);
    expect(to).not.toContain(await emailOf("max"));
    expect(to).toHaveLength(2);
  });

  it("counts a holiday only for the members of its group", async () => {
    const r = await requestTimeOff(
      db,
      await cast.viewer("max"),
      ask("2026-11-09", "2026-11-13"),
      NOW,
    );
    expect(r.amountCenti).toBe(500);
  });

  it("approves a policy without approval on submit, with no email", async () => {
    const r = await requestTimeOff(
      db,
      await cast.viewer("bob"),
      ask("2026-11-16", "2026-11-16", { policyId: sickId }),
      NOW,
    );
    expect(r.status).toBe("APPROVED");
    expect(await outbox("timeOff.requested")).toEqual([]);
  });

  it("refuses an overlap with the person's own time off", async () => {
    const bob = await cast.viewer("bob");
    await requestTimeOff(db, bob, ask("2026-11-09", "2026-11-13"), NOW);
    await expect(requestTimeOff(db, bob, ask("2026-11-13", "2026-11-16"), NOW)).rejects.toThrow(
      "This overlaps your time off on 9 – 13 Nov 2026.",
    );
  });

  it("refuses a request across two years", async () => {
    await expect(
      requestTimeOff(db, await cast.viewer("bob"), ask("2026-12-31", "2027-01-01"), NOW),
    ).rejects.toThrow("Time off cannot span two years: split the request.");
  });

  it("refuses a request that would go below zero", async () => {
    await expect(
      requestTimeOff(db, await cast.viewer("bob"), ask("2026-11-02", "2026-11-27"), NOW),
    ).rejects.toThrow("This would take Vacation below zero.");
  });

  it("refuses a policy the person is not on with 404", async () => {
    const ann = await cast.viewer("ann");
    const cebuOnly = await savePolicy(
      db,
      ann,
      policy({ name: "Cebu leave", everyone: false, groupIds: [cast.cebuId] }),
    );
    await expect(
      requestTimeOff(
        db,
        await cast.viewer("max"),
        ask("2026-11-09", "2026-11-09", { policyId: cebuOnly.id }),
        NOW,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("lets only one of two simultaneous requests spend the last days", async () => {
    await db
      .update(timeOffPolicy)
      .set({ allowanceCenti: 500 })
      .where(eq(timeOffPolicy.id, vacationId));
    const other = connectTestDb();
    try {
      const bob = await cast.viewer("bob");
      const results = await Promise.allSettled([
        requestTimeOff(db, bob, ask("2026-11-16", "2026-11-18"), NOW),
        requestTimeOff(other.db, bob, ask("2026-11-23", "2026-11-25"), NOW),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(String(refused.reason)).toContain("This would take Vacation below zero.");
      const pending = await db
        .select()
        .from(timeOffRequest)
        .where(eq(timeOffRequest.status, "PENDING"));
      expect(pending).toHaveLength(1);
    } finally {
      await other.close();
    }
  });
});

describe("reviewTimeOff", () => {
  it("lets a manager review their people at TEAM_MANAGERS, not at ADMINS", async () => {
    const r = await requestTimeOff(
      db,
      await cast.viewer("bob"),
      ask("2026-11-09", "2026-11-09"),
      NOW,
    );
    await expect(
      reviewTimeOff(db, await cast.viewer("max"), { ids: [r.id], decision: "APPROVE" }),
    ).rejects.toMatchObject({ status: 404 });
    await cast.setRules({ approvalReviewers: "TEAM_MANAGERS" });
    const [done] = await reviewTimeOff(db, await cast.viewer("max"), {
      ids: [r.id],
      decision: "APPROVE",
    });
    expect(done).toMatchObject({ status: "APPROVED", decidedByName: "Max Manager" });
    expect((await outbox("timeOff.decision")).map((m) => m.toAddress)).toEqual([
      await emailOf("bob"),
    ]);
  });

  it("never lets a manager review their own", async () => {
    await cast.setRules({ approvalReviewers: "TEAM_MANAGERS" });
    const max = await cast.viewer("max");
    const r = await requestTimeOff(db, max, ask("2026-11-09", "2026-11-09"), NOW);
    await expect(
      reviewTimeOff(db, max, { ids: [r.id], decision: "APPROVE" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("needs a note to reject, and keeps it", async () => {
    const ann = await cast.viewer("ann");
    const r = await requestTimeOff(
      db,
      await cast.viewer("bob"),
      ask("2026-11-09", "2026-11-09"),
      NOW,
    );
    await expect(reviewTimeOff(db, ann, { ids: [r.id], decision: "REJECT" })).rejects.toThrow();
    const [done] = await reviewTimeOff(db, ann, {
      ids: [r.id],
      decision: "REJECT",
      note: "Release week",
    });
    expect(done).toMatchObject({ status: "REJECTED", decisionNote: "Release week" });
  });

  it("changes nothing when one id is out of reach", async () => {
    await cast.setRules({ approvalReviewers: "TEAM_MANAGERS" });
    const bobs = await requestTimeOff(
      db,
      await cast.viewer("bob"),
      ask("2026-11-09", "2026-11-09"),
      NOW,
    );
    const anns = await requestTimeOff(
      db,
      await cast.viewer("ann"),
      ask("2026-11-09", "2026-11-09"),
      NOW,
    );
    await expect(
      reviewTimeOff(db, await cast.viewer("max"), { ids: [bobs.id, anns.id], decision: "APPROVE" }),
    ).rejects.toMatchObject({ status: 404 });
    const [row] = await db.select().from(timeOffRequest).where(eq(timeOffRequest.id, bobs.id));
    expect(row?.status).toBe("PENDING");
  });
});

describe("cancel and withdraw", () => {
  it("cancels approved time off with a note and gives the days back", async () => {
    const ann = await cast.viewer("ann");
    const bob = await cast.viewer("bob");
    const r = await requestTimeOff(db, bob, ask("2026-11-09", "2026-11-10"), NOW);
    await reviewTimeOff(db, ann, { ids: [r.id], decision: "APPROVE" });
    const before = await listBalances(db, bob, { today: TODAY });
    expect(before.find((b) => b.policyId === vacationId)?.balance.balanceCenti).toBe(1300);
    const cancelled = await cancelTimeOff(db, ann, r.id, "Plans changed");
    expect(cancelled).toMatchObject({ status: "CANCELLED", decisionNote: "Plans changed" });
    const after = await listBalances(db, bob, { today: TODAY });
    expect(after.find((b) => b.policyId === vacationId)?.balance.balanceCenti).toBe(1500);
  });

  it("withdraws one's own pending request, and someone else's is not found", async () => {
    const bob = await cast.viewer("bob");
    const r = await requestTimeOff(db, bob, ask("2026-11-09", "2026-11-09"), NOW);
    await expect(withdrawTimeOff(db, await cast.viewer("max"), r.id)).rejects.toMatchObject({
      status: 404,
    });
    await withdrawTimeOff(db, bob, r.id);
    expect((await listTimeOffRequests(db, bob, { tab: "mine" }))[0]?.status).toBe("CANCELLED");
  });
});

describe("listTimeOffRequests", () => {
  it("shows a reviewer what they may review", async () => {
    await cast.setRules({ approvalReviewers: "TEAM_MANAGERS" });
    await requestTimeOff(db, await cast.viewer("bob"), ask("2026-11-09", "2026-11-09"), NOW);
    await requestTimeOff(db, await cast.viewer("ann"), ask("2026-11-10", "2026-11-10"), NOW);
    const forMax = await listTimeOffRequests(db, await cast.viewer("max"), { tab: "review" });
    expect(forMax.map((r) => r.userName)).toEqual(["Bob Member"]);
    expect(forMax[0]?.canReview).toBe(true);
    const forOlga = await listTimeOffRequests(db, await cast.viewer("olga"), { tab: "review" });
    expect(forOlga).toHaveLength(2);
  });
});

describe("timeOffRange", () => {
  it("gives approved minutes per working day and the person's holidays", async () => {
    const bob = await cast.viewer("bob");
    const r = await requestTimeOff(db, bob, ask("2026-11-09", "2026-11-13"), NOW);
    await reviewTimeOff(db, await cast.viewer("ann"), { ids: [r.id], decision: "APPROVE" });
    const range = await timeOffRange(db, bob, {
      userId: cast.ids.bob,
      from: "2026-11-09",
      to: "2026-11-15",
    });
    expect(range.timeOff.map((d) => [d.dateKey, d.minutes])).toEqual([
      ["2026-11-09", 480],
      ["2026-11-10", 480],
      ["2026-11-12", 480],
      ["2026-11-13", 480],
    ]);
    expect(range.holidays).toEqual([{ dateKey: "2026-11-11", name: "Cebu Day" }]);
  });

  it("is not found for someone outside the viewer's scope", async () => {
    await expect(
      timeOffRange(db, await cast.viewer("bob"), {
        userId: cast.ids.max,
        from: "2026-11-09",
        to: "2026-11-15",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("timeOffCalendar", () => {
  it("shows who is away to those who may see it", async () => {
    const r = await requestTimeOff(
      db,
      await cast.viewer("bob"),
      ask("2026-11-09", "2026-11-10"),
      NOW,
    );
    await reviewTimeOff(db, await cast.viewer("ann"), { ids: [r.id], decision: "APPROVE" });
    await requestTimeOff(db, await cast.viewer("ann"), ask("2026-11-10", "2026-11-10"), NOW);
    const forMax = await timeOffCalendar(db, await cast.viewer("max"), "2026-11");
    expect(forMax.days).toHaveLength(30);
    const tenth = forMax.days.find((d) => d.dateKey === "2026-11-10")!;
    expect(tenth.away).toEqual([
      {
        userId: cast.ids.bob,
        userName: "Bob Member",
        policyName: "Vacation",
        halfDay: false,
        status: "APPROVED",
      },
    ]);
    const forOlga = await timeOffCalendar(db, await cast.viewer("olga"), "2026-11");
    expect(forOlga.days.find((d) => d.dateKey === "2026-11-10")!.away).toHaveLength(2);
  });

  it("lists the holidays that apply to the viewer", async () => {
    const forBob = await timeOffCalendar(db, await cast.viewer("bob"), "2026-11");
    expect(forBob.days.find((d) => d.dateKey === "2026-11-11")!.holidays).toEqual(["Cebu Day"]);
    const forMax = await timeOffCalendar(db, await cast.viewer("max"), "2026-11");
    expect(forMax.days.find((d) => d.dateKey === "2026-11-11")!.holidays).toEqual([]);
  });
});

describe("previewTimeOff", () => {
  it("counts the request and the balance after it, writing nothing", async () => {
    const bob = await cast.viewer("bob");
    await requestTimeOff(db, bob, ask("2026-11-16", "2026-11-16"), NOW);
    const preview = await previewTimeOff(db, bob, ask("2026-11-09", "2026-11-13"), NOW);
    expect(preview).toEqual({
      amountCenti: 400,
      unit: "DAYS",
      balanceCenti: 1400,
      afterCenti: 1000,
      unlimited: false,
    });
    expect(await listTimeOffRequests(db, bob, { tab: "mine" })).toHaveLength(1);
  });

  it("refuses what the request would refuse", async () => {
    await expect(
      previewTimeOff(
        db,
        await cast.viewer("bob"),
        ask("2026-11-03", "2026-11-04", { halfDay: true }),
        NOW,
      ),
    ).rejects.toThrow("A half day is for a one-day request.");
  });
});
