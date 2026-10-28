import { describe, expect, it } from "vitest";

import {
  manualRange,
  splitPoint,
  withDate,
  withDuration,
  withEndTime,
  withStartTime,
} from "./entry-edit";

const MANILA = "Asia/Manila";
const NEW_YORK = "America/New_York";
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("manualRange", () => {
  it("builds start/end on the given date", () => {
    const r = manualRange(
      { date: "2026-03-09", start: { hours: 9, minutes: 0 }, end: { hours: 10, minutes: 30 } },
      MANILA,
    );
    expect(iso(r.start)).toBe("2026-03-09T01:00:00.000Z");
    expect(iso(r.end)).toBe("2026-03-09T02:30:00.000Z");
    expect(r.durationSeconds).toBe(5400);
  });

  it("rolls an end before the start over to the next day", () => {
    const r = manualRange(
      { date: "2026-03-09", start: { hours: 23, minutes: 30 }, end: { hours: 0, minutes: 30 } },
      MANILA,
    );
    expect(iso(r.end)).toBe("2026-03-09T16:30:00.000Z"); // 00:30 March 10 Manila
    expect(r.durationSeconds).toBe(3600);
  });

  it("treats an equal end as the next day (24h)", () => {
    const r = manualRange(
      { date: "2026-03-09", start: { hours: 9, minutes: 0 }, end: { hours: 9, minutes: 0 } },
      MANILA,
    );
    expect(r.durationSeconds).toBe(24 * 3600);
  });

  it("measures real elapsed time across a DST change", () => {
    const r = manualRange(
      { date: "2026-03-08", start: { hours: 1, minutes: 0 }, end: { hours: 4, minutes: 0 } },
      NEW_YORK,
    );
    expect(r.durationSeconds).toBe(2 * 3600);
  });
});

describe("row edits", () => {
  // 09:00 -> 10:00 Manila on March 9
  const entry = { start: new Date("2026-03-09T01:00:00Z"), end: new Date("2026-03-09T02:00:00Z") };

  it("withStartTime keeps the start date and the end", () => {
    const r = withStartTime(entry, { hours: 8, minutes: 15 }, MANILA);
    expect(iso(r.start)).toBe("2026-03-09T00:15:00.000Z");
    expect(iso(r.end)).toBe("2026-03-09T02:00:00.000Z");
  });

  it("withStartTime after the end pushes the end to the next day", () => {
    const r = withStartTime(entry, { hours: 11, minutes: 0 }, MANILA);
    expect(iso(r.start)).toBe("2026-03-09T03:00:00.000Z");
    expect(iso(r.end)).toBe("2026-03-10T02:00:00.000Z");
  });

  it("withEndTime before the start rolls to the next day", () => {
    expect(iso(withEndTime(entry, { hours: 11, minutes: 0 }, MANILA).end)).toBe(
      "2026-03-09T03:00:00.000Z",
    );
    expect(iso(withEndTime(entry, { hours: 8, minutes: 0 }, MANILA).end)).toBe(
      "2026-03-10T00:00:00.000Z",
    );
  });

  it("withDate moves the entry and keeps its duration and local start time", () => {
    const r = withDate(entry, "2026-03-12", MANILA);
    expect(iso(r.start)).toBe("2026-03-12T01:00:00.000Z");
    expect(iso(r.end)).toBe("2026-03-12T02:00:00.000Z");
  });

  it("withDuration keeps the start and moves the end", () => {
    expect(iso(withDuration(entry, 5400).end)).toBe("2026-03-09T02:30:00.000Z");
  });
});

describe("splitPoint", () => {
  it("is the midpoint rounded down to the minute", () => {
    const start = new Date("2026-03-09T10:00:00.000Z");
    expect(splitPoint({ start, end: new Date("2026-03-09T11:01:00.000Z") }).toISOString()).toBe(
      "2026-03-09T10:30:00.000Z",
    );
  });

  it("is the exact midpoint when the rounded one would be the start", () => {
    const start = new Date("2026-03-09T10:00:00.000Z");
    expect(splitPoint({ start, end: new Date("2026-03-09T10:01:00.000Z") }).toISOString()).toBe(
      "2026-03-09T10:00:30.000Z",
    );
  });
});
