import { parseReportQuery, type ViewerPrefs } from "@timekeep/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb } from "../../../test/db";
import { NOW, type ScheduleCast, setUpScheduleCast } from "../../../test/schedule-fixtures";
import { createManualEntry } from "../time-entries";
import { createAssignment } from "./assignments";
import { publishSchedule } from "./publish";
import { buildExport } from "../report-files";
import { assignmentsReport } from "./report";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

const PREFS: ViewerPrefs = {
  timezone: "Asia/Manila",
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
/** This week in Manila: Mon 9 – Sun 15 November 2026. */
const query = (q = "") => parseReportQuery(new URLSearchParams(`preset=this-week${q}`));

let cast: ScheduleCast;

async function track(who: "bob" | "ann", projectId: string, startIso: string, minutes: number) {
  const start = new Date(startIso);
  await createManualEntry(db, await cast.viewer(who), {
    description: "Work",
    projectId,
    taskId: null,
    tagIds: [],
    billable: false,
    start,
    end: new Date(start.getTime() + minutes * 60_000),
  });
}

beforeEach(async () => {
  cast = await setUpScheduleCast(db);
  const olga = await cast.viewer("olga");
  const week = { startDate: "2026-11-09", endDate: "2026-11-10", minutesPerDay: 120 };
  await createAssignment(db, olga, cast.input("bob", cast.projects.website, week));
  await createAssignment(db, olga, cast.input("ann", cast.projects.mobile, week));
  await createAssignment(db, olga, cast.input("bob", cast.projects.secret, week));
  await publishSchedule(db, olga, NOW);
  // Bob tracks 1:30 on Website Monday morning; Ann 1:00 on Mobile.
  await track("bob", cast.projects.website, "2026-11-09T01:00:00Z", 90);
  await track("ann", cast.projects.mobile, "2026-11-09T01:00:00Z", 60);
});

describe("assignmentsReport", () => {
  it("by person and by project: scheduled against tracked, scoped", async () => {
    const olga = await cast.viewer("olga");
    const all = await assignmentsReport(db, olga, query(), PREFS, NOW);
    expect(
      all.rows.map((r) => [r.label, r.scheduledSeconds, r.trackedSeconds, r.varianceSeconds]),
    ).toEqual([
      ["Ann Admin", 14_400, 3_600, -10_800],
      ["Bob Member", 28_800, 5_400, -23_400],
    ]);
    const byProject = await assignmentsReport(
      db,
      olga,
      query("&assignmentsBy=project"),
      PREFS,
      NOW,
    );
    expect(byProject.rows.map((r) => r.label)).toEqual(["Mobile", "Secret", "Website"]);

    // Max manages Bob and Website: Bob's rows (not Secret, which Max cannot see), not Ann's Mobile.
    const max = await cast.viewer("max");
    const mine = await assignmentsReport(db, max, query("&assignmentsBy=project"), PREFS, NOW);
    expect(mine.rows.map((r) => [r.label, r.scheduledSeconds, r.trackedSeconds])).toEqual([
      ["Website", 14_400, 5_400],
    ]);

    // A member sees only their own, even when the workspace shows the team's time.
    await cast.setRules({ membersSeeTeamTime: true });
    const bob = await cast.viewer("bob");
    const own = await assignmentsReport(db, bob, query(), PREFS, NOW);
    expect(own.rows.map((r) => r.label)).toEqual(["Bob Member"]);
    expect(own.totals.scheduledSeconds).toBe(28_800);
  });

  it("a project the viewer cannot see is left out", async () => {
    const max = await cast.viewer("max");
    const r = await assignmentsReport(db, max, query("&assignmentsBy=project"), PREFS, NOW);
    expect(JSON.stringify(r)).not.toContain("Secret");
  });

  it("by day: an entry falls on its owner's local day", async () => {
    const olga = await cast.viewer("olga");
    // 23:30 UTC Sunday 8 Nov is 07:30 Monday 9 Nov in Manila.
    await track("ann", cast.projects.mobile, "2026-11-08T23:30:00Z", 30);
    const r = await assignmentsReport(db, olga, query("&assignmentsBy=day"), PREFS, NOW);
    expect(r.rows.map((x) => [x.key, x.scheduledSeconds, x.trackedSeconds])).toEqual([
      ["2026-11-09", 21_600, 10_800],
      ["2026-11-10", 21_600, 0],
    ]);
  });

  it("the Assignments report exports CSV with its five columns and a total", async () => {
    const olga = await cast.viewer("olga");
    const file = await buildExport(db, olga, {
      report: "assignments",
      format: "csv",
      query: query(),
      prefs: PREFS,
      now: NOW,
    });
    const lines = new TextDecoder()
      .decode(file.body)
      .replace(/^\uFEFF/, "")
      .split("\r\n");
    expect(lines[0]).toBe("Person,Scheduled,Tracked,Variance,Variance %");
    expect(lines[1]).toBe("Ann Admin,4:00:00,1:00:00,\u22123:00:00,-75.0");
    expect(lines[3]).toBe("Total,12:00:00,2:30:00,\u22129:30:00,-79.2");
  });
});
