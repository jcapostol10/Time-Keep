import { randomUUID } from "node:crypto";

import { holiday, holidayAssignee } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb } from "../../../test/db";
import { NOW, type ScheduleCast, setUpScheduleCast } from "../../../test/schedule-fixtures";
import { createAssignment } from "./assignments";
import { publishedPlanDays } from "./plan-days";
import { publishSchedule } from "./publish";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

let cast: ScheduleCast;
beforeEach(async () => {
  cast = await setUpScheduleCast(db);
});

describe("publishedPlanDays", () => {
  it("published days only, spread over each person's working days", async () => {
    const olga = await cast.viewer("olga");
    const holidayId = randomUUID();
    await db.insert(holiday).values({
      id: holidayId,
      workspaceId: cast.wsId,
      date: "2026-11-18",
      name: "Cebu Day",
    });
    await db.insert(holidayAssignee).values({ id: randomUUID(), holidayId, groupId: cast.cebuId });
    await createAssignment(db, olga, cast.input("bob", cast.projects.website));
    await createAssignment(db, olga, cast.input("ann", cast.projects.website));
    await publishSchedule(db, olga, NOW);
    await createAssignment(db, olga, cast.input("max", cast.projects.website));
    const days = await publishedPlanDays(db, cast.wsId, { from: "2026-11-16", to: "2026-11-22" });
    const keys = (who: string) =>
      days
        .filter((d) => d.userId === who)
        .map((d) => d.dateKey)
        .sort();
    expect(keys(cast.ids.bob)).toEqual(["2026-11-16", "2026-11-17", "2026-11-19", "2026-11-20"]);
    expect(keys(cast.ids.ann)).toHaveLength(5);
    expect(keys(cast.ids.max)).toEqual([]);
    expect(days.every((d) => d.minutes === 240 && d.projectId === cast.projects.website)).toBe(
      true,
    );
  });

  it("a series' days in the range only", async () => {
    const olga = await cast.viewer("olga");
    await createAssignment(
      db,
      olga,
      cast.input("bob", cast.projects.website, {
        startDate: "2026-11-02",
        endDate: "2026-11-02",
        repeatWeeks: 1,
        repeatUntil: "2026-12-31",
      }),
    );
    await publishSchedule(db, olga, NOW);
    const days = await publishedPlanDays(db, cast.wsId, { from: "2026-11-10", to: "2026-11-24" });
    expect(days.map((d) => d.dateKey).sort()).toEqual(["2026-11-16", "2026-11-23"]);
  });
});
