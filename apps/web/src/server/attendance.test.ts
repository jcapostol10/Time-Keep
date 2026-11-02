import {
  DEFAULT_REPORT_QUERY,
  type ReportQuery,
  type ViewerPrefs,
  zonedDateTimeToInstant,
} from "@timekeep/core";
import { eq, timeOffPolicy, user } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb } from "../../test/db";
import { setUpTimeOffCast, type TimeOffCast } from "../../test/time-off-fixtures";
import { attendanceReport } from "./attendance";
import { summaryReport } from "./reports";
import { setCapacity } from "./team";
import { createManualEntry, startTimer } from "./time-entries";
import { saveHoliday } from "./time-off/holidays";
import { savePolicy } from "./time-off/policies";
import { requestTimeOff, reviewTimeOff } from "./time-off/requests";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

const TZ = "Asia/Manila";
/** Monday 9 Nov 2026, noon in Manila: the week of 2–8 Nov is over. */
const NOW = new Date("2026-11-09T04:00:00.000Z");
const PREFS: ViewerPrefs = {
  timezone: TZ,
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
const H = 3600;

const at = (date: string, hm: string, tz = TZ) => {
  const [h, m] = hm.split(":").map(Number) as [number, number];
  return zonedDateTimeToInstant({ date, hours: h, minutes: m }, tz);
};
/** Mon 2 Nov 00:00 → Mon 9 Nov 00:00 Manila. */
const week = (over: Partial<ReportQuery> = {}): ReportQuery => ({
  ...DEFAULT_REPORT_QUERY,
  preset: "custom",
  from: at("2026-11-02", "00:00").toISOString(),
  to: at("2026-11-09", "00:00").toISOString(),
  ...over,
});

let cast: TimeOffCast;

async function work(who: keyof TimeOffCast["ids"], date: string, hours: number, type = "work") {
  const start = at(date, "09:00");
  await createManualEntry(
    db,
    await cast.viewer(who),
    {
      description: type === "break" ? "" : "Work",
      projectId: null,
      taskId: null,
      tagIds: [],
      billable: false,
      type: type as "work" | "break",
      start,
      end: new Date(start.getTime() + hours * H * 1000),
    },
    NOW,
  );
}

const personOf = async (who: keyof TimeOffCast["ids"], viewer = who, query = week()) =>
  (await attendanceReport(db, await cast.viewer(viewer), query, PREFS, NOW)).people.find(
    (p) => p.userId === cast.ids[who],
  )!;
const dayOf = async (who: keyof TimeOffCast["ids"], dateKey: string) =>
  (await personOf(who)).days.find((d) => d.dateKey === dateKey);

beforeEach(async () => {
  cast = await setUpTimeOffCast(db);
  await cast.setRules({ allowBreaks: true });
});

describe("attendanceReport", () => {
  it("measures each day against the daily capacity", async () => {
    await work("bob", "2026-11-02", 9);
    await work("bob", "2026-11-03", 6);
    expect(await dayOf("bob", "2026-11-02")).toMatchObject({
      workSeconds: 9 * H,
      capacitySeconds: 8 * H,
      overtimeSeconds: H,
      firstStart: at("2026-11-02", "09:00").toISOString(),
      lastEnd: at("2026-11-02", "18:00").toISOString(),
    });
    expect(await dayOf("bob", "2026-11-03")).toMatchObject({ undertimeSeconds: 2 * H });
    const bob = await personOf("bob");
    expect(bob.weeks).toHaveLength(1);
    expect(bob.totals).toMatchObject({ workSeconds: 15 * H, capacitySeconds: 40 * H });
  });

  it("counts a break as breaks, not work", async () => {
    await work("bob", "2026-11-02", 8);
    await work("bob", "2026-11-02", 1, "break");
    expect(await dayOf("bob", "2026-11-02")).toMatchObject({
      workSeconds: 8 * H,
      breakSeconds: H,
      overtimeSeconds: 0,
    });
  });

  it("leaves a running timer out", async () => {
    await startTimer(
      db,
      await cast.viewer("bob"),
      { description: "Live", projectId: null, taskId: null, tagIds: [], billable: false },
      at("2026-11-04", "09:00"),
    );
    expect((await dayOf("bob", "2026-11-04"))?.workSeconds).toBe(0);
  });

  it("takes approved time off off the capacity", async () => {
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
      { policyId: policy.id, start: "2026-11-04", end: "2026-11-04", halfDay: false, note: "" },
      NOW,
    );
    await reviewTimeOff(db, ann, { ids: [r.id], decision: "APPROVE" });
    expect(await dayOf("bob", "2026-11-04")).toMatchObject({
      timeOffSeconds: 8 * H,
      capacitySeconds: 0,
      undertimeSeconds: 0,
    });
    expect((await personOf("bob")).weeks[0]?.capacitySeconds).toBe(32 * H);
  });

  it("gives a group's holiday to its members only", async () => {
    await saveHoliday(db, await cast.viewer("ann"), {
      date: "2026-11-05",
      name: "Cebu Day",
      repeatsYearly: false,
      userIds: [],
      groupIds: [cast.cebuId],
    });
    expect(await dayOf("bob", "2026-11-05")).toMatchObject({
      capacitySeconds: 0,
      holiday: "Cebu Day",
    });
    expect(await dayOf("max", "2026-11-05")).toMatchObject({
      capacitySeconds: 8 * H,
      holiday: null,
    });
  });

  it("puts an entry on the person's own day, not the workspace's", async () => {
    await cast.setRules({ timezone: "America/New_York" });
    await db.update(user).set({ timezone: TZ }).where(eq(user.id, cast.ids.bob));
    // Monday 07:30 in Manila is Sunday 18:30 in New York.
    const start = at("2026-11-09", "07:30");
    await createManualEntry(
      db,
      await cast.viewer("bob"),
      {
        description: "Early",
        projectId: null,
        taskId: null,
        tagIds: [],
        billable: false,
        start,
        end: new Date(start.getTime() + H * 1000),
      },
      NOW,
    );
    const ny: ViewerPrefs = { ...PREFS, timezone: "America/New_York" };
    const query = week({
      from: at("2026-11-02", "00:00", ny.timezone).toISOString(),
      to: at("2026-11-16", "00:00", ny.timezone).toISOString(),
    });
    const report = await attendanceReport(db, await cast.viewer("olga"), query, ny, NOW);
    const bob = report.people.find((p) => p.userId === cast.ids.bob)!;
    expect(bob.days.find((d) => d.dateKey === "2026-11-09")?.workSeconds).toBe(H);
    expect(bob.days.find((d) => d.dateKey === "2026-11-08")).toBeUndefined();
    expect(bob.weeks.map((w) => w.weekStart)).toEqual(["2026-11-02", "2026-11-09"]);
  });

  it("shows a manager themselves and their people, and a member only themselves", async () => {
    const names = async (who: keyof TimeOffCast["ids"], query = week()) =>
      (await attendanceReport(db, await cast.viewer(who), query, PREFS, NOW)).people
        .map((p) => p.userName)
        .sort();
    expect(await names("max")).toEqual(["Bob Member", "Max Manager"]);
    expect(await names("olga")).toHaveLength(4);
    expect(await names("bob", week({ userIds: [cast.ids.max, cast.ids.ann] }))).toEqual([
      "Bob Member",
    ]);
    expect(await names("max", week({ userIds: [cast.ids.ann, cast.ids.bob] }))).toEqual([
      "Bob Member",
    ]);
  });

  it("totals the same work as the Summary report", async () => {
    await work("bob", "2026-11-02", 9);
    await work("bob", "2026-11-03", 6.5);
    await work("max", "2026-11-04", 7.25);
    await work("bob", "2026-11-05", 1, "break");
    const olga = await cast.viewer("olga");
    const query = week({ userIds: [cast.ids.bob, cast.ids.max], rounding: "off", type: "work" });
    const report = await attendanceReport(db, olga, query, PREFS, NOW);
    const summary = await summaryReport(db, olga, query, PREFS, NOW);
    const total = report.people.reduce((n, p) => n + p.totals.workSeconds, 0);
    expect(total).toBe(summary.totals.durationSeconds);
  });

  it("follows the person's working days", async () => {
    await setCapacity(db, await cast.viewer("ann"), cast.ids.bob, {
      dailyHours: "8",
      weeklyHours: "40",
      workingDays: [0, 1, 2, 3, 4],
    });
    expect(await dayOf("bob", "2026-11-06")).toBeUndefined();
    expect(await dayOf("bob", "2026-11-08")).toMatchObject({ undertimeSeconds: 8 * H });
  });
});

describe("setCapacity", () => {
  it("is refused to a manager with 403", async () => {
    await expect(
      setCapacity(db, await cast.viewer("max"), cast.ids.bob, {
        dailyHours: "6",
        weeklyHours: "30",
        workingDays: [1, 2, 3, 4, 5],
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("is not found for someone outside the workspace", async () => {
    await expect(
      setCapacity(db, await cast.viewer("ann"), "nobody", {
        dailyHours: "6",
        weeklyHours: "30",
        workingDays: [1, 2, 3, 4, 5],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
