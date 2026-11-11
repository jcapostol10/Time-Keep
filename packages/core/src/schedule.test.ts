import { describe, expect, it } from "vitest";

import {
  type AssignmentShape,
  assignmentDays,
  capacityByDay,
  type DayRules,
  heatOf,
  moveAssignment,
  occurrences,
  resizeAssignment,
  spanLastDay,
  splitAssignment,
  stackLanes,
} from "./schedule";
import { DEFAULT_CAPACITY } from "./time-off";

const WEEKDAYS: DayRules = { workingDays: [1, 2, 3, 4, 5], holidayKeys: new Set() };

function shape(patch: Partial<AssignmentShape>): AssignmentShape {
  return {
    startDate: "2026-11-16",
    endDate: "2026-11-20",
    mode: "PER_DAY",
    minutesPerDay: 480,
    totalMinutes: null,
    includeNonWorking: false,
    repeatWeeks: null,
    repeatUntil: null,
    ...patch,
  };
}

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe("assignmentDays", () => {
  it("PER_DAY falls on working days, skipping weekends and the person's holidays", () => {
    const days = assignmentDays(
      shape({ endDate: "2026-11-22" }),
      { workingDays: [1, 2, 3, 4, 5], holidayKeys: new Set(["2026-11-18"]) },
      { from: "2026-11-01", to: "2026-11-30" },
    );
    expect([...days]).toEqual([
      ["2026-11-16", 480],
      ["2026-11-17", 480],
      ["2026-11-19", 480],
      ["2026-11-20", 480],
    ]);
  });

  it("includeNonWorking puts minutes on every day", () => {
    const days = assignmentDays(
      shape({ endDate: "2026-11-22", includeNonWorking: true, minutesPerDay: 60 }),
      { workingDays: [1, 2, 3, 4, 5], holidayKeys: new Set(["2026-11-18"]) },
      { from: "2026-11-01", to: "2026-11-30" },
    );
    expect(days.size).toBe(7);
    expect(days.get("2026-11-21")).toBe(60);
  });

  it("TOTAL spreads in whole minutes, remainder to the earliest days", () => {
    const range = { from: "2026-11-16", to: "2026-11-20" };
    const even = assignmentDays(
      shape({ mode: "TOTAL", minutesPerDay: null, totalMinutes: 1000 }),
      WEEKDAYS,
      range,
    );
    expect([...even.values()]).toEqual([200, 200, 200, 200, 200]);
    const odd = assignmentDays(
      shape({ mode: "TOTAL", minutesPerDay: null, totalMinutes: 1003 }),
      WEEKDAYS,
      range,
    );
    expect([...odd.values()]).toEqual([201, 201, 201, 200, 200]);
    expect(sum(odd)).toBe(1003);
  });

  it("TOTAL with a holiday spreads over the remaining working days", () => {
    const days = assignmentDays(
      shape({ endDate: "2026-11-23", mode: "TOTAL", minutesPerDay: null, totalMinutes: 1200 }),
      { workingDays: [1, 2, 3, 4, 5], holidayKeys: new Set(["2026-11-18"]) },
      { from: "2026-11-01", to: "2026-11-30" },
    );
    // Mon 16, Tue 17, Thu 19, Fri 20, Mon 23: five working days.
    expect(days.size).toBe(5);
    expect([...days.values()].every((m) => m === 240)).toBe(true);
    expect(days.has("2026-11-18")).toBe(false);
  });

  it("a recurring TOTAL is spread per occurrence and cut to the range", () => {
    const days = assignmentDays(
      shape({
        endDate: "2026-11-17",
        mode: "TOTAL",
        minutesPerDay: null,
        totalMinutes: 600,
        repeatWeeks: 1,
        repeatUntil: "2026-12-31",
      }),
      WEEKDAYS,
      { from: "2026-11-17", to: "2026-11-23" },
    );
    expect([...days]).toEqual([
      ["2026-11-17", 300],
      ["2026-11-23", 300],
    ]);
  });
});

describe("occurrences", () => {
  it("occurrences repeat every N weeks until the date", () => {
    const a = shape({ endDate: "2026-11-17", repeatWeeks: 2, repeatUntil: "2026-12-14" });
    expect(occurrences(a).map((o) => o.startDate)).toEqual([
      "2026-11-16",
      "2026-11-30",
      "2026-12-14",
    ]);
    expect(
      occurrences({ ...a, repeatUntil: "2026-12-13" }).map((o) => [o.startDate, o.endDate]),
    ).toEqual([
      ["2026-11-16", "2026-11-17"],
      ["2026-11-30", "2026-12-01"],
    ]);
    expect(spanLastDay({ ...a, repeatUntil: "2026-12-13" })).toBe("2026-12-01");
    expect(occurrences(shape({}))).toEqual([{ startDate: "2026-11-16", endDate: "2026-11-20" }]);
  });
});

describe("capacityByDay and heatOf", () => {
  it("capacity subtracts holidays and approved time off", () => {
    const cap = capacityByDay(
      { from: "2026-11-16", to: "2026-11-21" },
      DEFAULT_CAPACITY,
      new Set(["2026-11-17"]),
      new Map([["2026-11-18", 240]]),
    );
    expect(cap.get("2026-11-16")).toBe(480);
    expect(cap.get("2026-11-17")).toBe(0);
    expect(cap.get("2026-11-18")).toBe(240);
    expect(cap.get("2026-11-21")).toBe(0);
  });

  it("capacity uses date keys across a DST change", () => {
    const cap = capacityByDay(
      { from: "2026-03-06", to: "2026-03-10" },
      DEFAULT_CAPACITY,
      new Set(),
      new Map(),
    );
    expect([...cap.keys()]).toEqual([
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
    ]);
    expect(cap.get("2026-03-09")).toBe(480);
    expect(cap.get("2026-03-10")).toBe(480);
    expect(cap.get("2026-03-08")).toBe(0);
  });

  it("heatOf: 10 hours against 8 is over", () => {
    expect(heatOf(600, 480)).toBe("over");
    expect(heatOf(480, 480)).toBe("at");
    expect(heatOf(240, 480)).toBe("under");
    expect(heatOf(0, 480)).toBe("under");
    expect(heatOf(60, 0)).toBe("over");
    expect(heatOf(0, 0)).toBeNull();
  });
});

describe("date edits", () => {
  it("moveAssignment keeps the length and shifts the repeat's end", () => {
    const moved = moveAssignment(
      shape({ startDate: "2026-10-30", endDate: "2026-11-02" }),
      "2026-11-27",
    );
    expect([moved.startDate, moved.endDate]).toEqual(["2026-11-27", "2026-11-30"]);
    const series = moveAssignment(
      shape({ repeatWeeks: 1, repeatUntil: "2026-12-14" }),
      "2026-11-18",
    );
    expect(series.repeatUntil).toBe("2026-12-16");
  });

  it("resizeAssignment never lets the end pass the start", () => {
    expect(resizeAssignment(shape({}), "end", "2026-11-25").endDate).toBe("2026-11-25");
    const a = resizeAssignment(shape({}), "end", "2026-11-10");
    expect([a.startDate, a.endDate]).toEqual(["2026-11-16", "2026-11-16"]);
    const b = resizeAssignment(shape({}), "start", "2026-11-30");
    expect([b.startDate, b.endDate]).toEqual(["2026-11-20", "2026-11-20"]);
  });

  it("splitAssignment splits a TOTAL by where its minutes fall", () => {
    const [first, second] = splitAssignment(
      shape({ mode: "TOTAL", minutesPerDay: null, totalMinutes: 1000 }),
      "2026-11-19",
      WEEKDAYS,
    );
    expect([first.startDate, first.endDate, first.totalMinutes]).toEqual([
      "2026-11-16",
      "2026-11-18",
      600,
    ]);
    expect([second.startDate, second.endDate, second.totalMinutes]).toEqual([
      "2026-11-19",
      "2026-11-20",
      400,
    ]);
    expect(() => splitAssignment(shape({}), "2026-11-16", WEEKDAYS)).toThrow(
      "Split inside the assignment.",
    );
    expect(() =>
      splitAssignment(shape({ repeatWeeks: 1, repeatUntil: "2026-12-01" }), "2026-11-18", WEEKDAYS),
    ).toThrow("Split works on a single assignment; edit the series instead.");
  });
});

describe("stackLanes", () => {
  it("stackLanes packs overlapping bars into lanes", () => {
    const lanes = stackLanes([
      { id: "a", startDate: "2026-11-16", endDate: "2026-11-18" },
      { id: "b", startDate: "2026-11-17", endDate: "2026-11-19" },
      { id: "c", startDate: "2026-11-19", endDate: "2026-11-20" },
    ]);
    expect([lanes.get("a"), lanes.get("b"), lanes.get("c")]).toEqual([0, 1, 0]);
  });
});
