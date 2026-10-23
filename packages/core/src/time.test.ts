import { describe, expect, it } from "vitest";

import {
  addDaysInZone,
  monthBoundsInZone,
  formatDayHeading,
  formatTimeOfDay,
  formatWeekRange,
  localDateKey,
  localTimeParts,
  localWeekday,
  minutesSinceMidnight,
  parseTimeOfDay,
  startOfDayInZone,
  startOfWeekInZone,
  weekBounds,
  zonedDateTimeToInstant,
  daysBetweenInZone,
} from "./time";

const MANILA = "Asia/Manila";
const NEW_YORK = "America/New_York";
const iso = (d: Date) => d.toISOString();

describe("Asia/Manila (UTC+8, no DST)", () => {
  // 17:30Z on March 8 is 01:30 on March 9 in Manila.
  const instant = new Date("2026-03-08T17:30:00Z");

  it("localDateKey uses the zone's calendar date", () => {
    expect(localDateKey(instant, MANILA)).toBe("2026-03-09");
    expect(localDateKey(instant, "UTC")).toBe("2026-03-08");
  });

  it("localTimeParts / minutesSinceMidnight / localWeekday", () => {
    expect(localTimeParts(instant, MANILA)).toEqual({ hours: 1, minutes: 30, seconds: 0 });
    expect(minutesSinceMidnight(instant, MANILA)).toBe(90);
    expect(localWeekday(instant, MANILA)).toBe(1); // Monday March 9
    expect(localWeekday(instant, "UTC")).toBe(0); // Sunday March 8
  });

  it("zonedDateTimeToInstant converts wall time to UTC", () => {
    expect(iso(zonedDateTimeToInstant({ date: "2026-03-09", hours: 9, minutes: 0 }, MANILA))).toBe(
      "2026-03-09T01:00:00.000Z",
    );
    expect(
      iso(
        zonedDateTimeToInstant({ date: "2026-03-09", hours: 0, minutes: 30, seconds: 15 }, MANILA),
      ),
    ).toBe("2026-03-08T16:30:15.000Z");
  });

  it("startOfWeekInZone with Monday start", () => {
    expect(iso(startOfWeekInZone(instant, MANILA, 1))).toBe("2026-03-08T16:00:00.000Z");
  });
});

describe("America/New_York spring forward (2026-03-08 02:00 EST -> 03:00 EDT)", () => {
  it("wall times before and after the gap map to EST and EDT offsets", () => {
    expect(
      iso(zonedDateTimeToInstant({ date: "2026-03-08", hours: 1, minutes: 30 }, NEW_YORK)),
    ).toBe("2026-03-08T06:30:00.000Z");
    expect(
      iso(zonedDateTimeToInstant({ date: "2026-03-08", hours: 3, minutes: 30 }, NEW_YORK)),
    ).toBe("2026-03-08T07:30:00.000Z");
  });

  it("a wall time inside the gap resolves to the instant one hour later", () => {
    expect(
      iso(zonedDateTimeToInstant({ date: "2026-03-08", hours: 2, minutes: 30 }, NEW_YORK)),
    ).toBe("2026-03-08T07:30:00.000Z");
  });

  it("startOfWeekInZone uses the offset in force at the week start", () => {
    // Wednesday March 11 (EDT): week starts Monday March 9 00:00 EDT.
    expect(iso(startOfWeekInZone(new Date("2026-03-11T12:00:00Z"), NEW_YORK, 1))).toBe(
      "2026-03-09T04:00:00.000Z",
    );
    // Wednesday March 4 (EST): week starts Monday March 2 00:00 EST.
    expect(iso(startOfWeekInZone(new Date("2026-03-04T12:00:00Z"), NEW_YORK, 1))).toBe(
      "2026-03-02T05:00:00.000Z",
    );
    // Sunday start.
    expect(iso(startOfWeekInZone(new Date("2026-03-11T12:00:00Z"), NEW_YORK, 0))).toBe(
      "2026-03-08T05:00:00.000Z",
    );
  });

  it("weekBounds spans the DST change (a 167-hour week)", () => {
    const { weekStart, weekEnd } = weekBounds(new Date("2026-03-04T12:00:00Z"), NEW_YORK, 1);
    expect(iso(weekStart)).toBe("2026-03-02T05:00:00.000Z");
    expect(iso(weekEnd)).toBe("2026-03-09T04:00:00.000Z");
  });

  it("addDaysInZone keeps the wall-clock time across the change", () => {
    const midnightMar7 = new Date("2026-03-07T05:00:00Z"); // 00:00 EST
    expect(iso(addDaysInZone(midnightMar7, 1, NEW_YORK))).toBe("2026-03-08T05:00:00.000Z");
    expect(iso(addDaysInZone(midnightMar7, 2, NEW_YORK))).toBe("2026-03-09T04:00:00.000Z");
    expect(iso(addDaysInZone(new Date("2026-03-09T04:00:00Z"), -2, NEW_YORK))).toBe(
      "2026-03-07T05:00:00.000Z",
    );
  });

  it("startOfDayInZone", () => {
    expect(iso(startOfDayInZone(new Date("2026-03-08T23:30:00Z"), NEW_YORK))).toBe(
      "2026-03-08T05:00:00.000Z",
    );
  });
});

describe("America/New_York fall back (2026-11-01 02:00 EDT -> 01:00 EST)", () => {
  it("addDaysInZone across the change", () => {
    const midnightOct31 = new Date("2026-10-31T04:00:00Z"); // 00:00 EDT
    expect(iso(addDaysInZone(midnightOct31, 2, NEW_YORK))).toBe("2026-11-02T05:00:00.000Z");
  });

  it("startOfDayInZone on the change day", () => {
    expect(iso(startOfDayInZone(new Date("2026-11-01T12:00:00Z"), NEW_YORK))).toBe(
      "2026-11-01T04:00:00.000Z",
    );
  });

  it("localDateKey after the change", () => {
    expect(localDateKey(new Date("2026-11-02T04:30:00Z"), NEW_YORK)).toBe("2026-11-01"); // 23:30 EST
  });
});

describe("formatDayHeading", () => {
  const today = "2026-03-09";
  it("labels today and yesterday", () => {
    expect(formatDayHeading("2026-03-09", today)).toBe("Today");
    expect(formatDayHeading("2026-03-08", today)).toBe("Yesterday");
  });
  it("formats other days, adding the year when it differs", () => {
    expect(formatDayHeading("2026-03-05", today)).toBe("Thu, Mar 5");
    expect(formatDayHeading("2025-12-31", today)).toBe("Wed, Dec 31, 2025");
  });
});

describe("formatWeekRange", () => {
  it("renders the 7-day range in the zone", () => {
    expect(formatWeekRange(new Date("2026-03-09T04:00:00Z"), NEW_YORK)).toBe("Mar 9 – Mar 15");
    expect(formatWeekRange(new Date("2026-03-29T16:00:00Z"), MANILA)).toBe("Mar 30 – Apr 5");
  });
});

describe("formatTimeOfDay", () => {
  const instant = new Date("2026-03-08T17:30:00Z");
  it("12h and 24h", () => {
    expect(formatTimeOfDay(instant, MANILA, "12h")).toBe("1:30 AM");
    expect(formatTimeOfDay(instant, MANILA, "24h")).toBe("01:30");
    expect(formatTimeOfDay(instant, NEW_YORK, "12h")).toBe("1:30 PM");
    expect(formatTimeOfDay(instant, NEW_YORK, "24h")).toBe("13:30");
    expect(formatTimeOfDay(new Date("2026-03-09T00:05:00Z"), "UTC", "12h")).toBe("12:05 AM");
  });
});

describe("parseTimeOfDay", () => {
  it.each([
    ["9", { hours: 9, minutes: 0 }],
    ["9:30", { hours: 9, minutes: 30 }],
    ["930", { hours: 9, minutes: 30 }],
    ["0930", { hours: 9, minutes: 30 }],
    ["130", { hours: 1, minutes: 30 }],
    ["1330", { hours: 13, minutes: 30 }],
    ["9:30pm", { hours: 21, minutes: 30 }],
    ["9pm", { hours: 21, minutes: 0 }],
    ["9 PM", { hours: 21, minutes: 0 }],
    ["9:30 a.m.", { hours: 9, minutes: 30 }],
    ["21:30", { hours: 21, minutes: 30 }],
    ["12am", { hours: 0, minutes: 0 }],
    ["12pm", { hours: 12, minutes: 0 }],
    ["12:30am", { hours: 0, minutes: 30 }],
    ["00:00", { hours: 0, minutes: 0 }],
    ["23:59", { hours: 23, minutes: 59 }],
  ])("parses %j", (input, expected) => {
    expect(parseTimeOfDay(input)).toEqual(expected);
  });

  it.each(["", "24:00", "9:60", "13pm", "abc", "25", "9:3"])("rejects %j", (input) => {
    expect(parseTimeOfDay(input)).toBeNull();
  });
});

describe("monthBoundsInZone", () => {
  it("returns the local month as [start, next month start) instants", () => {
    const { monthStart, monthEnd } = monthBoundsInZone(
      new Date("2026-03-31T20:00:00.000Z"),
      "Asia/Manila",
    );
    // 2026-04-01 04:00 Manila → April
    expect(monthStart.toISOString()).toBe("2026-03-31T16:00:00.000Z");
    expect(monthEnd.toISOString()).toBe("2026-04-30T16:00:00.000Z");
  });

  it("keeps midnight across a daylight-saving change", () => {
    const { monthStart, monthEnd } = monthBoundsInZone(
      new Date("2026-03-15T12:00:00.000Z"),
      "America/New_York",
    );
    expect(monthStart.toISOString()).toBe("2026-03-01T05:00:00.000Z"); // EST
    expect(monthEnd.toISOString()).toBe("2026-04-01T04:00:00.000Z"); // EDT
  });
});

describe("daysBetweenInZone", () => {
  it("counts local calendar days, unchanged by a daylight-saving change", () => {
    // New York springs forward on 2026-03-08: Sat 00:00 EST to Mon 00:00 EDT is 47 hours.
    const sat = new Date("2026-03-07T05:00:00.000Z");
    const mon = new Date("2026-03-09T04:00:00.000Z");
    expect(daysBetweenInZone(sat, mon, "America/New_York")).toBe(2);
    expect(daysBetweenInZone(mon, sat, "America/New_York")).toBe(-2);
    const week = new Date("2026-03-08T16:00:00.000Z");
    expect(daysBetweenInZone(week, new Date("2026-03-15T16:00:00.000Z"), "Asia/Manila")).toBe(7);
    expect(daysBetweenInZone(week, week, "Asia/Manila")).toBe(0);
  });
});
