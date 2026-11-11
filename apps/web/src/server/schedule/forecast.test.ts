import { randomUUID } from "node:crypto";

import { NO_ESTIMATE, type Estimate } from "@timekeep/core";
import { rate } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb } from "../../../test/db";
import { NOW, type ScheduleCast, setUpScheduleCast } from "../../../test/schedule-fixtures";
import { createManualEntry } from "../time-entries";
import { createAssignment } from "./assignments";
import { projectForecast } from "./forecast";
import { publishSchedule } from "./publish";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

let cast: ScheduleCast;
const TEN_HOURS: Estimate = { ...NO_ESTIMATE, kind: "TIME", seconds: 36_000 };

beforeEach(async () => {
  cast = await setUpScheduleCast(db);
  await cast.setRules({ currency: "PHP" });
  await db.insert(rate).values({
    id: randomUUID(),
    workspaceId: cast.wsId,
    level: "member",
    userId: cast.ids.bob,
    amountMinor: 100_000,
    currency: "PHP",
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  });
  // Four hours tracked this morning (Manila), billable, rated by the member rate.
  await createManualEntry(db, await cast.viewer("bob"), {
    description: "Work",
    projectId: cast.projects.website,
    taskId: null,
    tagIds: [],
    billable: true,
    start: new Date("2026-11-11T00:00:00Z"),
    end: new Date("2026-11-11T04:00:00Z"),
  });
});

const website = () => ({ id: cast.projects.website, billable: true });

describe("projectForecast", () => {
  it("tracked plus the published plan from tomorrow, rated by the hierarchy", async () => {
    const olga = await cast.viewer("olga");
    await createAssignment(
      db,
      olga,
      cast.input("bob", cast.projects.website, {
        endDate: "2026-11-17",
        minutesPerDay: 480,
      }),
    );
    await publishSchedule(db, olga, NOW);
    // A draft is not the plan of record.
    await createAssignment(
      db,
      olga,
      cast.input("bob", cast.projects.website, { startDate: "2026-11-19", endDate: "2026-11-19" }),
    );
    const f = (await projectForecast(db, cast.wsId, website(), TEN_HOURS, "PHP", NOW))!;
    expect([f.trackedSeconds, f.trackedMinor]).toEqual([14_400, 400_000]);
    expect([f.scheduledSeconds, f.scheduledMinor]).toEqual([57_600, 1_600_000]);
    expect(f.completionDate).toBe("2026-11-16");
    expect([f.overrunSeconds, f.overrunMinor]).toEqual([36_000, 1_000_000]);
    expect(f.unratedSeconds).toBe(0);
  });

  it("a day without a rate is unrated, and a non-billable project schedules no money", async () => {
    const olga = await cast.viewer("olga");
    await createAssignment(
      db,
      olga,
      cast.input("max", cast.projects.website, { startDate: "2026-11-16", endDate: "2026-11-16" }),
    );
    await publishSchedule(db, olga, NOW);
    const f = (await projectForecast(db, cast.wsId, website(), TEN_HOURS, "PHP", NOW))!;
    expect([f.scheduledSeconds, f.scheduledMinor, f.unratedSeconds]).toEqual([14_400, 0, 14_400]);
    const nb = (await projectForecast(
      db,
      cast.wsId,
      { id: cast.projects.website, billable: false },
      TEN_HOURS,
      "PHP",
      NOW,
    ))!;
    expect([nb.scheduledMinor, nb.unratedSeconds]).toEqual([0, 14_400]);
  });

  it("a monthly estimate stops at the month's end; none is null", async () => {
    const olga = await cast.viewer("olga");
    await createAssignment(
      db,
      olga,
      cast.input("bob", cast.projects.website, { startDate: "2026-11-30", endDate: "2026-12-01" }),
    );
    await publishSchedule(db, olga, NOW);
    const monthly = { ...TEN_HOURS, reset: "MONTHLY" as const };
    const f = (await projectForecast(db, cast.wsId, website(), monthly, "PHP", NOW))!;
    expect(f.scheduledSeconds).toBe(14_400);
    const whole = (await projectForecast(db, cast.wsId, website(), TEN_HOURS, "PHP", NOW))!;
    expect(whole.scheduledSeconds).toBe(28_800);
    expect(await projectForecast(db, cast.wsId, website(), NO_ESTIMATE, "PHP", NOW)).toBeNull();
  });

  it("tracked past the estimate is reached on its day", async () => {
    const f = (await projectForecast(
      db,
      cast.wsId,
      website(),
      { ...TEN_HOURS, seconds: 3_600 },
      "PHP",
      NOW,
    ))!;
    expect([f.reachedOn, f.completionDate, f.overrunSeconds]).toEqual(["2026-11-11", null, 10_800]);
  });
});
