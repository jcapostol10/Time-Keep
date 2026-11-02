import { describe, expect, it } from "vitest";
import { attendanceDays, attendanceWeeks, type DayWork } from "./attendance";
import { DEFAULT_CAPACITY } from "./time-off";

const H = 3600;
const work = (dateKey: string, hours: number, breakHours = 0): [string, DayWork] => [
  dateKey,
  {
    dateKey,
    firstStart: `${dateKey}T01:00:00.000Z`,
    lastEnd: `${dateKey}T10:00:00.000Z`,
    workSeconds: hours * H,
    breakSeconds: breakHours * H,
  },
];
const days = (
  from: string,
  to: string,
  entries: [string, DayWork][],
  extra: { holidays?: [string, string][]; timeOff?: [string, number][] } = {},
) =>
  attendanceDays({
    from,
    to,
    work: new Map(entries),
    capacity: DEFAULT_CAPACITY,
    holidays: new Map(extra.holidays ?? []),
    timeOffMinutes: new Map(extra.timeOff ?? []),
  });

// 2026-11-02 is a Monday.
describe("attendanceDays", () => {
  it("counts overtime over the daily capacity", () => {
    const [d] = days("2026-11-02", "2026-11-02", [work("2026-11-02", 9)]);
    expect(d).toMatchObject({ capacitySeconds: 8 * H, overtimeSeconds: H, undertimeSeconds: 0 });
  });

  it("counts undertime under the daily capacity", () => {
    const [d] = days("2026-11-02", "2026-11-02", [work("2026-11-02", 6)]);
    expect(d).toMatchObject({ overtimeSeconds: 0, undertimeSeconds: 2 * H });
  });

  it("counts all work on a non-working day as overtime", () => {
    const [d] = days("2026-11-07", "2026-11-07", [work("2026-11-07", 2)]);
    expect(d).toMatchObject({
      capacitySeconds: 0,
      overtimeSeconds: 2 * H,
      undertimeSeconds: 0,
      workingDay: false,
    });
  });

  it("gives a holiday no capacity and names it", () => {
    const [d] = days("2026-11-02", "2026-11-02", [], { holidays: [["2026-11-02", "All Souls"]] });
    expect(d).toMatchObject({ capacitySeconds: 0, holiday: "All Souls", undertimeSeconds: 0 });
  });

  it("takes a half day off from the capacity", () => {
    const [d] = days("2026-11-03", "2026-11-03", [work("2026-11-03", 4)], {
      timeOff: [["2026-11-03", 240]],
    });
    expect(d).toMatchObject({
      timeOffSeconds: 4 * H,
      capacitySeconds: 4 * H,
      overtimeSeconds: 0,
      undertimeSeconds: 0,
    });
  });

  it("keeps a row for every working day and drops an empty weekend", () => {
    const got = days("2026-11-02", "2026-11-08", []);
    expect(got.map((d) => d.dateKey)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
    ]);
    expect(got[0]?.undertimeSeconds).toBe(8 * H);
  });

  it("counts breaks apart from work", () => {
    const [d] = days("2026-11-02", "2026-11-02", [work("2026-11-02", 8, 1)]);
    expect(d).toMatchObject({ workSeconds: 8 * H, breakSeconds: H, overtimeSeconds: 0 });
  });
});

describe("attendanceWeeks", () => {
  const week = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
  const range = { from: "2026-11-02", to: "2026-11-08" };

  it("counts weekly overtime against the weekly capacity", () => {
    const d = days(
      range.from,
      range.to,
      week.map((k) => work(k, 9)),
    );
    const [w] = attendanceWeeks(d, DEFAULT_CAPACITY, 1, range);
    expect(w).toMatchObject({
      weekStart: "2026-11-02",
      workSeconds: 45 * H,
      capacitySeconds: 40 * H,
      overtimeSeconds: 5 * H,
      undertimeSeconds: 0,
    });
  });

  it("takes a holiday's capacity off the week", () => {
    const d = days(
      range.from,
      range.to,
      week.slice(1).map((k) => work(k, 9)),
      { holidays: [["2026-11-02", "Holiday"]] },
    );
    const [w] = attendanceWeeks(d, DEFAULT_CAPACITY, 1, range);
    expect(w).toMatchObject({ capacitySeconds: 115200, overtimeSeconds: 14400 });
  });

  it("uses the days' own capacity for a week cut by the range", () => {
    const cut = { from: "2026-11-04", to: "2026-11-08" };
    const d = days(cut.from, cut.to, []);
    const [w] = attendanceWeeks(d, DEFAULT_CAPACITY, 1, cut);
    expect(w).toMatchObject({ weekStart: "2026-11-02", capacitySeconds: 24 * H });
  });

  it("starts weeks on the workspace's week start", () => {
    const d = days("2026-11-01", "2026-11-07", [work("2026-11-01", 1), work("2026-11-02", 8)]);
    const ws = attendanceWeeks(d, DEFAULT_CAPACITY, 0, { from: "2026-11-01", to: "2026-11-07" });
    expect(ws.map((w) => w.weekStart)).toEqual(["2026-11-01"]);
  });
});
