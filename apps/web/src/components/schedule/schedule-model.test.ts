import type { AssignmentShape } from "@timekeep/core";
import { describe, expect, it } from "vitest";

import { dayIndexAt, dragResult, rangeFor, rowWindow, shiftFrom, startFor } from "./schedule-model";

const A: AssignmentShape = {
  startDate: "2026-11-16",
  endDate: "2026-11-17",
  mode: "PER_DAY",
  minutesPerDay: 120,
  totalMinutes: null,
  includeNonWorking: false,
  repeatWeeks: null,
  repeatUntil: null,
};
const DAYS = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];

describe("ranges", () => {
  it("a week starts on the week start, a month on its first day", () => {
    expect(startFor("2026-11-19", "week", 1)).toBe("2026-11-16");
    expect(startFor("2026-11-19", "2weeks", 0)).toBe("2026-11-15");
    expect(startFor("2026-11-19", "month", 1)).toBe("2026-11-01");
  });

  it("ranges span 7, 14 days or the month, and shift by the same", () => {
    expect(rangeFor("2026-11-16", "week")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(rangeFor("2026-11-16", "2weeks").to).toBe("2026-11-29");
    expect(rangeFor("2026-02-01", "month").to).toBe("2026-02-28");
    expect(shiftFrom("2026-11-16", "week", 1)).toBe("2026-11-23");
    expect(shiftFrom("2026-11-16", "2weeks", -1)).toBe("2026-11-02");
    expect(shiftFrom("2026-01-01", "month", -1)).toBe("2025-12-01");
  });
});

describe("drag", () => {
  it("dayIndexAt maps a pointer to a column, clamped", () => {
    expect(dayIndexAt(150, 100, 500, 5)).toBe(0);
    expect(dayIndexAt(301, 100, 500, 5)).toBe(2);
    expect(dayIndexAt(900, 100, 500, 5)).toBe(4);
    expect(dayIndexAt(0, 100, 500, 5)).toBe(0);
  });

  it("create spans the days dragged over, either direction", () => {
    expect(dragResult("create", 3, 1, null, DAYS)).toMatchObject({
      startDate: "2026-11-17",
      endDate: "2026-11-19",
    });
  });

  it("move shifts the whole span; resizing moves one edge, never past the other", () => {
    expect(dragResult("move", 0, 1, A, DAYS)).toMatchObject({
      startDate: "2026-11-17",
      endDate: "2026-11-18",
    });
    expect(dragResult("resize-end", 1, 4, A, DAYS)).toMatchObject({
      startDate: "2026-11-16",
      endDate: "2026-11-20",
    });
    expect(dragResult("resize-start", 0, 4, A, DAYS)).toMatchObject({
      startDate: "2026-11-17",
      endDate: "2026-11-17",
    });
  });
});

describe("rowWindow", () => {
  it("renders the rows in view plus the overscan, with spacers for the rest", () => {
    const heights = Array.from({ length: 100 }, () => 40);
    const w = rowWindow(heights, 400, 200, 2);
    expect([w.start, w.end]).toEqual([8, 17]);
    expect(w.before).toBe(320);
    expect(w.after).toBe(4000 - 17 * 40);
    expect(rowWindow([40, 40], 0, 500, 5)).toMatchObject({ start: 0, end: 2, before: 0, after: 0 });
  });
});
