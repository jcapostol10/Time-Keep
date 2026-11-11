import { describe, expect, it } from "vitest";

import { assignmentsRows, type PlanRow } from "./assignments-report";

const labels = new Map([
  ["u1", "Bob"],
  ["u2", "Ann"],
  ["p1", "Website"],
]);
const row = (userId: string, dateKey: string, seconds: number, projectId = "p1"): PlanRow => ({
  userId,
  projectId,
  dateKey,
  seconds,
});

describe("assignmentsRows", () => {
  it("by person: scheduled against tracked with the variance and its percent", () => {
    const { rows, totals } = assignmentsRows(
      [row("u1", "2026-11-16", 7_200)],
      [row("u1", "2026-11-16", 5_400)],
      "user",
      { weekStart: 1, labels },
    );
    expect(rows).toEqual([
      {
        key: "u1",
        label: "Bob",
        scheduledSeconds: 7_200,
        trackedSeconds: 5_400,
        varianceSeconds: -1_800,
        variancePercent: -25,
      },
    ]);
    expect(totals).toMatchObject({
      scheduledSeconds: 7_200,
      trackedSeconds: 5_400,
      varianceSeconds: -1_800,
    });
  });

  it("a day with only tracked time has a row with no percent", () => {
    const { rows } = assignmentsRows(
      [row("u1", "2026-11-16", 3_600)],
      [row("u2", "2026-11-17", 1_800)],
      "day",
      { weekStart: 1, labels },
    );
    expect(
      rows.map((r) => [r.key, r.scheduledSeconds, r.trackedSeconds, r.variancePercent]),
    ).toEqual([
      ["2026-11-16", 3_600, 0, -100],
      ["2026-11-17", 0, 1_800, null],
    ]);
  });

  it("by week groups on the week start", () => {
    const { rows } = assignmentsRows(
      [row("u1", "2026-11-15", 3_600), row("u1", "2026-11-16", 3_600)],
      [],
      "week",
      { weekStart: 1, labels },
    );
    expect(rows.map((r) => [r.key, r.scheduledSeconds])).toEqual([
      ["2026-11-09", 3_600],
      ["2026-11-16", 3_600],
    ]);
    expect(rows[1]!.label).toMatch(/^Week of /);
  });

  it("an unknown person reads (former member); by person sorts by name", () => {
    const { rows } = assignmentsRows(
      [row("u1", "2026-11-16", 60), row("u2", "2026-11-16", 60), row("gone", "2026-11-16", 60)],
      [],
      "user",
      { weekStart: 1, labels },
    );
    expect(rows.map((r) => r.label)).toEqual(["(former member)", "Ann", "Bob"]);
  });
});
