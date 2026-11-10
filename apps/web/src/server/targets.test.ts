import type { TargetRuleInput } from "@timekeep/core";
import { and, emailOutbox, eq, like, timeOffPolicy, userSettings } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb } from "../../test/db";
import { setUpTimeOffCast, type TimeOffCast } from "../../test/time-off-fixtures";
import { runDailyJobs } from "./daily-jobs";
import { deleteTargetRule, listTargetRules, saveTargetRule } from "./targets";
import { createManualEntry } from "./time-entries";
import { saveHoliday } from "./time-off/holidays";
import { savePolicy } from "./time-off/policies";
import { requestTimeOff, reviewTimeOff } from "./time-off/requests";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

// Tuesday 3 Nov 06:00 in Manila: Monday 2 Nov is yesterday. In New York it is
// still Monday 2 Nov 17:00, so its yesterday is a Sunday.
const TUESDAY_MANILA = new Date("2026-11-02T22:00:00.000Z");
// Monday 9 Nov 06:00 in Manila: the week of 2–8 Nov just ended.
const NEXT_MONDAY_MANILA = new Date("2026-11-08T22:00:00.000Z");
const H = 3600;

let cast: TimeOffCast;

const rule = (extra: Partial<TargetRuleInput> = {}): TargetRuleInput => ({
  kind: "UNDER",
  period: "DAY",
  threshold: "8",
  active: true,
  everyone: true,
  userIds: [],
  groupIds: [],
  ...extra,
});

async function work(who: keyof TimeOffCast["ids"], startIso: string, hours: number) {
  const start = new Date(startIso);
  await createManualEntry(
    db,
    await cast.viewer(who),
    {
      description: "Work",
      projectId: null,
      taskId: null,
      tagIds: [],
      billable: false,
      start,
      end: new Date(start.getTime() + hours * H * 1000),
    },
    TUESDAY_MANILA,
  );
}

async function targetMail() {
  const rows = await db
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.workspaceId, cast.wsId), like(emailOutbox.kind, "target:%")));
  return rows;
}

async function emailOf(who: keyof TimeOffCast["ids"]) {
  const u = await db.query.user.findFirst({ where: (t, { eq: e }) => e(t.id, cast.ids[who]) });
  return u!.email;
}

beforeEach(async () => {
  cast = await setUpTimeOffCast(db);
});

describe("target rules", () => {
  it("are managed by owners and admins only", async () => {
    await expect(saveTargetRule(db, await cast.viewer("max"), rule())).rejects.toMatchObject({
      status: 403,
    });
    const ann = await cast.viewer("ann");
    const saved = await saveTargetRule(db, ann, rule({ everyone: false, groupIds: [cast.cebuId] }));
    expect(saved).toMatchObject({ kind: "UNDER", thresholdMinutes: 480, groupIds: [cast.cebuId] });
    const edited = await saveTargetRule(db, ann, rule({ threshold: "7:30" }), saved.id);
    expect(edited).toMatchObject({ thresholdMinutes: 450, everyone: true, groupIds: [] });
    expect(await listTargetRules(db, ann)).toHaveLength(1);
    await deleteTargetRule(db, ann, saved.id);
    expect(await listTargetRules(db, ann)).toEqual([]);
    await expect(listTargetRules(db, await cast.viewer("bob"))).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("the daily job's targets", () => {
  // Monday 2 Nov 09:00 in Manila.
  const MONDAY = "2026-11-02T01:00:00.000Z";

  it("reminds whoever tracked too little yesterday", async () => {
    await saveTargetRule(db, await cast.viewer("ann"), rule());
    await work("bob", MONDAY, 6);
    await work("max", MONDAY, 8);
    await work("olga", MONDAY, 8);
    await work("ann", MONDAY, 8);
    const result = await runDailyJobs(db, { now: TUESDAY_MANILA, workspaceIds: [cast.wsId] });
    expect(result).toEqual({
      reminders: 0,
      targets: 1,
      budgets: 0,
      invoices: { created: 0, sent: 0, overdue: 0 },
    });
    const [mail] = await targetMail();
    expect(mail).toMatchObject({ toAddress: await emailOf("bob") });
    expect(mail?.kind).toMatch(new RegExp(`^target:.+:${cast.ids.bob}:2026-11-02$`));
  });

  it("sends nothing to someone who muted target reminders", async () => {
    await saveTargetRule(
      db,
      await cast.viewer("ann"),
      rule({ everyone: false, userIds: [cast.ids.bob] }),
    );
    await db.insert(userSettings).values({ userId: cast.ids.bob, muteTargetReminders: true });
    await work("bob", MONDAY, 6);
    await runDailyJobs(db, { now: TUESDAY_MANILA, workspaceIds: [cast.wsId] });
    expect(await targetMail()).toEqual([]);
  });

  it("alerts owners, admins and the person's managers about too much", async () => {
    await saveTargetRule(
      db,
      await cast.viewer("ann"),
      rule({ kind: "OVER", threshold: "10", everyone: false, userIds: [cast.ids.bob] }),
    );
    await db.insert(userSettings).values({ userId: cast.ids.bob, muteTargetReminders: true });
    await work("bob", MONDAY, 11);
    await runDailyJobs(db, { now: TUESDAY_MANILA, workspaceIds: [cast.wsId] });
    const to = (await targetMail()).map((m) => m.toAddress).sort();
    expect(to).toEqual([await emailOf("olga"), await emailOf("ann"), await emailOf("max")].sort());
  });

  it("skips a holiday that applies to the person", async () => {
    const ann = await cast.viewer("ann");
    await saveTargetRule(db, ann, rule({ everyone: false, userIds: [cast.ids.bob] }));
    await saveHoliday(db, ann, {
      date: "2026-11-02",
      name: "All Souls",
      repeatsYearly: false,
      userIds: [],
      groupIds: [cast.cebuId],
    });
    await runDailyJobs(db, { now: TUESDAY_MANILA, workspaceIds: [cast.wsId] });
    expect(await targetMail()).toEqual([]);
  });

  it("runs weekly rules on the first day of the week", async () => {
    await saveTargetRule(
      db,
      await cast.viewer("ann"),
      rule({ period: "WEEK", threshold: "40", everyone: false, userIds: [cast.ids.bob] }),
    );
    await work("bob", MONDAY, 6);
    await runDailyJobs(db, { now: TUESDAY_MANILA, workspaceIds: [cast.wsId] });
    expect(await targetMail()).toEqual([]);
    await runDailyJobs(db, { now: NEXT_MONDAY_MANILA, workspaceIds: [cast.wsId] });
    const [mail] = await targetMail();
    expect(mail?.kind).toMatch(/:2026-11-02$/);
  });

  it("sends each reminder once", async () => {
    await saveTargetRule(
      db,
      await cast.viewer("ann"),
      rule({ everyone: false, userIds: [cast.ids.bob] }),
    );
    await work("bob", MONDAY, 6);
    await runDailyJobs(db, { now: TUESDAY_MANILA, workspaceIds: [cast.wsId] });
    const again = await runDailyJobs(db, {
      now: new Date(TUESDAY_MANILA.getTime() + H * 1000),
      workspaceIds: [cast.wsId],
    });
    expect(again.targets).toBe(0);
    expect(await targetMail()).toHaveLength(1);
  });

  it("evaluates a day only once it is over in the workspace's timezone", async () => {
    await cast.setRules({ timezone: "America/New_York" });
    await saveTargetRule(
      db,
      await cast.viewer("ann"),
      rule({ everyone: false, userIds: [cast.ids.bob] }),
    );
    await runDailyJobs(db, { now: TUESDAY_MANILA, workspaceIds: [cast.wsId] });
    expect(await targetMail()).toEqual([]);
    // Tuesday 3 Nov 17:00 in New York: Monday is over.
    await runDailyJobs(db, {
      now: new Date("2026-11-03T22:00:00.000Z"),
      workspaceIds: [cast.wsId],
    });
    expect((await targetMail()).map((m) => m.toAddress)).toEqual([await emailOf("bob")]);
  });

  it("ignores an inactive rule", async () => {
    await saveTargetRule(db, await cast.viewer("ann"), rule({ active: false }));
    expect(await runDailyJobs(db, { now: TUESDAY_MANILA, workspaceIds: [cast.wsId] })).toEqual({
      reminders: 0,
      targets: 0,
      budgets: 0,
      invoices: { created: 0, sent: 0, overdue: 0 },
    });
  });
});

describe("targets around time off and days off (review fixes)", () => {
  async function vacation(start: string, end: string, halfDay = false) {
    const ann = await cast.viewer("ann");
    const policy = await savePolicy(db, ann, {
      name: "Vacation",
      unit: "DAYS",
      accrual: "YEARLY",
      allowance: "15",
      allowNegative: false,
      requiresApproval: true,
      everyone: true,
      userIds: [],
      groupIds: [],
    });
    await db.update(timeOffPolicy).set({ createdAt: new Date("2025-01-01T00:00:00Z") });
    const r = await requestTimeOff(
      db,
      await cast.viewer("bob"),
      { policyId: policy.id, start, end, halfDay, note: "" },
      TUESDAY_MANILA,
    );
    await reviewTimeOff(db, ann, { ids: [r.id], decision: "APPROVE" });
  }

  it("lowers a weekly target by the week's holidays and time off", async () => {
    const ann = await cast.viewer("ann");
    await saveTargetRule(
      db,
      ann,
      rule({ period: "WEEK", threshold: "40", everyone: false, userIds: [cast.ids.bob] }),
    );
    await saveHoliday(db, ann, {
      date: "2026-11-02",
      name: "All Souls",
      repeatsYearly: false,
      userIds: [],
      groupIds: [cast.cebuId],
    });
    await vacation("2026-11-03", "2026-11-03");
    for (const day of ["2026-11-04", "2026-11-05", "2026-11-06"]) {
      await work("bob", `${day}T01:00:00.000Z`, 8);
    }
    await runDailyJobs(db, { now: NEXT_MONDAY_MANILA, workspaceIds: [cast.wsId] });
    expect(await targetMail()).toEqual([]);
  });

  it("lowers a daily target by a half day off", async () => {
    await saveTargetRule(
      db,
      await cast.viewer("ann"),
      rule({ everyone: false, userIds: [cast.ids.bob] }),
    );
    await vacation("2026-11-02", "2026-11-02", true);
    await work("bob", "2026-11-02T01:00:00.000Z", 4);
    await runDailyJobs(db, { now: TUESDAY_MANILA, workspaceIds: [cast.wsId] });
    expect(await targetMail()).toEqual([]);
  });

  it("alerts about too much time on a weekend", async () => {
    await saveTargetRule(
      db,
      await cast.viewer("ann"),
      rule({ kind: "OVER", threshold: "10", everyone: false, userIds: [cast.ids.bob] }),
    );
    // Sunday 1 Nov, 08:00 in Manila; the job runs Monday 06:00.
    await work("bob", "2026-11-01T00:00:00.000Z", 11);
    await runDailyJobs(db, {
      now: new Date("2026-11-01T22:00:00.000Z"),
      workspaceIds: [cast.wsId],
    });
    expect((await targetMail()).length).toBe(3);
  });
});
