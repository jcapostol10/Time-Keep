import { describe, expect, it } from "vitest";

import {
  MAX_TIMESHEET_CELL_SECONDS,
  buildTimesheet,
  planCellChange,
  rowKeyString,
  shiftEntriesByDays,
  type TimesheetEntry,
} from "./timesheet";

const TZ = "Asia/Manila";
/** Monday 2026-03-09 00:00 Manila. */
const WEEK_START = new Date("2026-03-08T16:00:00.000Z");

/** An entry starting at `date hh:mm` Manila lasting `minutes`. */
function entryAt(
  id: string,
  date: string,
  hhmm: string,
  minutes: number,
  key: Partial<TimesheetEntry> = {},
): TimesheetEntry {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  // Manila is UTC+8 with no DST, so the offset is fixed.
  const start = new Date(
    `${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+08:00`,
  );
  const end = new Date(start.getTime() + minutes * 60_000);
  return {
    id,
    projectId: null,
    taskId: null,
    description: "",
    start: start.toISOString(),
    end: end.toISOString(),
    durationSeconds: minutes * 60,
    ...key,
  };
}

describe("buildTimesheet", () => {
  it("groups by project, task and description with day, row and grand totals", () => {
    const entries = [
      entryAt("a", "2026-03-09", "09:00", 60, { projectId: "p1", taskId: "t1", description: "x" }),
      entryAt("b", "2026-03-09", "10:00", 30, { projectId: "p1", taskId: "t1", description: "x" }),
      entryAt("c", "2026-03-10", "09:00", 60, { projectId: "p1" }),
      entryAt("d", "2026-03-11", "23:30", 60, { projectId: "p2" }), // crosses midnight
      entryAt("z", "2026-03-16", "09:00", 60, { projectId: "p1" }), // next week: ignored
    ];
    const sheet = buildTimesheet({
      entries,
      weekStart: WEEK_START,
      tz: TZ,
      extraRows: [{ projectId: "p3", taskId: null, description: "" }],
    });

    expect(sheet.days).toEqual([
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
      "2026-03-14",
      "2026-03-15",
    ]);
    expect(sheet.rows.map((r) => r.key)).toEqual(["p1|t1|x", "p1||", "p2||", "p3||"]);
    const first = sheet.rows[0]!;
    expect(first.cells["2026-03-09"]).toEqual({ seconds: 5400, entryIds: ["a", "b"] });
    expect(first.cells["2026-03-10"]).toEqual({ seconds: 0, entryIds: [] });
    expect(first.totalSeconds).toBe(5400);
    // The midnight-crossing entry counts under its start day only.
    expect(sheet.rows[2]!.cells["2026-03-11"]!.seconds).toBe(3600);
    expect(sheet.rows[2]!.cells["2026-03-12"]!.seconds).toBe(0);
    expect(sheet.rows[3]!.totalSeconds).toBe(0);
    expect(sheet.dayTotals).toMatchObject({
      "2026-03-09": 5400,
      "2026-03-10": 3600,
      "2026-03-11": 3600,
    });
    expect(sheet.totalSeconds).toBe(12_600);
  });

  it("builds the row key from the three parts", () => {
    expect(rowKeyString({ projectId: "p", taskId: null, description: "d" })).toBe("p||d");
    expect(rowKeyString({ projectId: null, taskId: null, description: "" })).toBe("||");
  });
});

describe("planCellChange", () => {
  const day = "2026-03-09";
  const plan = (cellEntries: TimesheetEntry[], newSeconds: number, dayEntries = cellEntries) =>
    planCellChange({ cellEntries, dayEntries, newSeconds, dayKey: day, tz: TZ });

  it("creates at 09:00 local on an empty day", () => {
    expect(plan([], 3600, [])).toEqual({
      kind: "create",
      start: new Date("2026-03-09T01:00:00.000Z"),
      end: new Date("2026-03-09T02:00:00.000Z"),
    });
  });

  it("creates after the day's last entry when the day has entries", () => {
    const other = entryAt("o", day, "10:15", 60, { projectId: "px" });
    expect(plan([], 3600, [other])).toEqual({
      kind: "create",
      start: new Date("2026-03-09T03:15:00.000Z"),
      end: new Date("2026-03-09T04:15:00.000Z"),
    });
  });

  it("extends or shrinks a single entry, and deletes it at zero", () => {
    const a = entryAt("a", day, "09:00", 60);
    expect(plan([a], 7200)).toEqual({
      kind: "update",
      entryId: "a",
      end: new Date("2026-03-09T03:00:00.000Z"),
    });
    expect(plan([a], 1800)).toEqual({
      kind: "update",
      entryId: "a",
      end: new Date("2026-03-09T01:30:00.000Z"),
    });
    expect(plan([a], 0)).toEqual({ kind: "delete", entryIds: ["a"] });
  });

  it("adjusts the last of several entries, or asks when it cannot absorb the decrease", () => {
    const a = entryAt("a", day, "09:00", 60);
    const b = entryAt("b", day, "10:30", 30);
    expect(plan([b, a], 7200)).toEqual({
      kind: "update",
      entryId: "b",
      end: new Date("2026-03-09T03:30:00.000Z"), // 11:30 local
    });
    expect(plan([b, a], 4500)).toEqual({
      kind: "update",
      entryId: "b",
      end: new Date("2026-03-09T02:45:00.000Z"), // 10:45 local
    });
    expect(plan([b, a], 3600)).toEqual({ kind: "delete", entryIds: ["b"] });
    expect(plan([b, a], 2700)).toEqual({ kind: "choose", entries: [a, b] });
    expect(plan([b, a], 5400)).toEqual({ kind: "noop" });
  });

  it("shortens a midnight-crossing entry from its end", () => {
    const late = entryAt("late", day, "23:30", 60);
    expect(plan([late], 1800)).toEqual({
      kind: "update",
      entryId: "late",
      end: new Date("2026-03-09T16:00:00.000Z"), // 00:00 local next day
    });
  });

  it("falls back to 09:00 when the day's last entry ends on the next day", () => {
    // "After the last entry" would land on Tuesday; the cell is Monday's.
    const late = entryAt("late", day, "23:30", 60, { projectId: "px" });
    expect(plan([], 3600, [late])).toEqual({
      kind: "create",
      start: new Date("2026-03-09T01:00:00.000Z"),
      end: new Date("2026-03-09T02:00:00.000Z"),
    });
  });

  it("rejects a total over 24 hours (80 typed for 8.0) before writing anything", () => {
    expect(MAX_TIMESHEET_CELL_SECONDS).toBe(24 * 3600);
    const reject = { kind: "reject", message: "A day holds at most 24 hours." };
    expect(plan([], 80 * 3600, [])).toEqual(reject);
    expect(plan([entryAt("a", day, "09:00", 60)], 25 * 3600)).toEqual(reject);
    expect(plan([], 24 * 3600, [])).toMatchObject({ kind: "create" });
  });

  it("ignores a negative or unchanged value on an empty cell", () => {
    expect(plan([], 0, [])).toEqual({ kind: "noop" });
    expect(plan([], -5, [])).toEqual({ kind: "noop" });
  });
});

describe("shiftEntriesByDays", () => {
  it("keeps wall-clock start and duration across a daylight-saving change", () => {
    const entry = {
      start: "2026-03-07T14:00:00.000Z", // 09:00 New York, EST
      end: "2026-03-07T15:00:00.000Z",
      id: "x",
    };
    const [shifted] = shiftEntriesByDays([entry], 7, "America/New_York");
    expect(shifted).toEqual({
      id: "x",
      start: "2026-03-14T13:00:00.000Z", // 09:00 New York, EDT
      end: "2026-03-14T14:00:00.000Z",
    });
  });
});
