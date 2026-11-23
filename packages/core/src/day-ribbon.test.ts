import { describe, expect, it } from "vitest";

import { ribbonBlocks, ribbonSummary } from "./day-ribbon";

const NY = "America/New_York";
const MANILA = "Asia/Manila";
const NOW = new Date("2026-06-10T20:00:00Z");
const FORMATS = { durationFormat: "hh:mm", timeFormat: "24h" } as const;

const entry = (id: string, start: string, end: string | null) => ({ id, start, end });

describe("ribbonBlocks", () => {
  it("places an entry by its start and end as a share of the day", () => {
    // 06:00–12:00 in UTC: a quarter in, a quarter wide.
    const [block] = ribbonBlocks(
      [entry("a", "2026-06-10T06:00:00Z", "2026-06-10T12:00:00Z")],
      "2026-06-10",
      "UTC",
      NOW,
    );
    expect(block).toMatchObject({ id: "a", left: 25, width: 25, running: false, seconds: 21_600 });
    expect(block?.clippedStart).toBe(false);
    expect(block?.clippedEnd).toBe(false);
  });

  it("uses the viewer's timezone, not UTC", () => {
    // 01:00–03:00 UTC on the 10th is 09:00–11:00 in Manila, and the evening of the 9th in New York.
    const e = [entry("a", "2026-06-10T01:00:00Z", "2026-06-10T03:00:00Z")];
    expect(ribbonBlocks(e, "2026-06-10", MANILA, NOW)[0]).toMatchObject({
      left: 37.5,
      width: 8.333,
    });
    expect(ribbonBlocks(e, "2026-06-10", NY, NOW)).toEqual([]);
    expect(ribbonBlocks(e, "2026-06-09", NY, NOW)[0]).toMatchObject({ left: 87.5, width: 8.333 });
  });

  it("clips an entry that crosses midnight to each day it touches", () => {
    // 22:00 on the 9th to 03:00 on the 10th, UTC.
    const e = [entry("a", "2026-06-09T22:00:00Z", "2026-06-10T03:00:00Z")];
    const first = ribbonBlocks(e, "2026-06-09", "UTC", NOW)[0];
    expect(first).toMatchObject({ left: 91.667, width: 8.333, clippedEnd: true, seconds: 7_200 });
    expect(first?.clippedStart).toBe(false);
    const second = ribbonBlocks(e, "2026-06-10", "UTC", NOW)[0];
    expect(second).toMatchObject({ left: 0, width: 12.5, clippedStart: true, seconds: 10_800 });
    expect(second?.clippedEnd).toBe(false);
    expect(ribbonBlocks(e, "2026-06-11", "UTC", NOW)).toEqual([]);
  });

  it("fills the day for an entry that covers all of it", () => {
    const e = [entry("a", "2026-06-08T12:00:00Z", "2026-06-10T12:00:00Z")];
    expect(ribbonBlocks(e, "2026-06-09", "UTC", NOW)[0]).toMatchObject({
      left: 0,
      width: 100,
      clippedStart: true,
      clippedEnd: true,
      seconds: 86_400,
    });
  });

  it("keeps the wall clock on the short day when clocks go forward", () => {
    // New York, 8 March 2026: 02:00 does not exist. 01:00–04:00 on the clock is two real hours.
    const [block] = ribbonBlocks(
      [entry("a", "2026-03-08T06:00:00Z", "2026-03-08T08:00:00Z")],
      "2026-03-08",
      NY,
      NOW,
    );
    expect(block).toMatchObject({ left: 4.167, width: 12.5, seconds: 7_200 });
    // An entry over the whole 23-hour day still fills the strip.
    const [whole] = ribbonBlocks(
      [entry("b", "2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z")],
      "2026-03-08",
      NY,
      NOW,
    );
    expect(whole).toMatchObject({ left: 0, width: 100, seconds: 82_800 });
  });

  it("keeps the wall clock on the long day when clocks go back", () => {
    // New York, 1 November 2026: 01:00–02:00 happens twice. 00:30–02:30 on the clock is three real hours.
    const [block] = ribbonBlocks(
      [entry("a", "2026-11-01T04:30:00Z", "2026-11-01T07:30:00Z")],
      "2026-11-01",
      NY,
      NOW,
    );
    expect(block).toMatchObject({ left: 2.083, width: 8.333, seconds: 10_800 });
    const [whole] = ribbonBlocks(
      [entry("b", "2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z")],
      "2026-11-01",
      NY,
      NOW,
    );
    expect(whole).toMatchObject({ left: 0, width: 100, seconds: 90_000 });
  });

  it("draws the running entry up to now, and to midnight on the day it started", () => {
    const running = [entry("r", "2026-06-09T22:00:00Z", null)];
    const now = new Date("2026-06-10T06:00:00Z");
    expect(ribbonBlocks(running, "2026-06-10", "UTC", now)[0]).toMatchObject({
      left: 0,
      width: 25,
      running: true,
      clippedStart: true,
    });
    expect(ribbonBlocks(running, "2026-06-09", "UTC", now)[0]).toMatchObject({
      left: 91.667,
      width: 8.333,
      running: true,
      clippedEnd: true,
    });
    // A minute later it has grown.
    const later = ribbonBlocks(running, "2026-06-10", "UTC", new Date("2026-06-10T06:01:00Z"))[0];
    expect(later?.width).toBeGreaterThan(25);
  });

  it("leaves out an entry that has no length or ends before it starts", () => {
    const e = [
      entry("zero", "2026-06-10T06:00:00Z", "2026-06-10T06:00:00Z"),
      entry("future", "2026-06-10T23:00:00Z", null),
    ];
    expect(ribbonBlocks(e, "2026-06-10", "UTC", NOW)).toEqual([]);
  });

  it("orders blocks by start and keeps overlapping ones", () => {
    const blocks = ribbonBlocks(
      [
        entry("late", "2026-06-10T10:00:00Z", "2026-06-10T12:00:00Z"),
        entry("early", "2026-06-10T08:00:00Z", "2026-06-10T11:00:00Z"),
      ],
      "2026-06-10",
      "UTC",
      NOW,
    );
    expect(blocks.map((b) => b.id)).toEqual(["early", "late"]);
    // They overlap from 10:00 to 11:00; neither is trimmed.
    expect(blocks[0]!.left + blocks[0]!.width).toBeGreaterThan(blocks[1]!.left);
  });
});

describe("ribbonSummary", () => {
  const blocksOf = (entries: ReturnType<typeof entry>[], tz = "UTC", now = NOW) =>
    ribbonBlocks(entries, "2026-06-10", tz, now);

  it("says how many entries, how long and between which times", () => {
    const blocks = blocksOf([
      entry("a", "2026-06-10T08:10:00Z", "2026-06-10T12:10:00Z"),
      entry("b", "2026-06-10T15:10:00Z", "2026-06-10T18:40:00Z"),
    ]);
    expect(ribbonSummary(blocks, "UTC", FORMATS)).toBe(
      "2 entries, 7:30 tracked between 08:10 and 18:40",
    );
  });

  it("uses the viewer's formats and timezone", () => {
    const blocks = blocksOf([entry("a", "2026-06-10T01:00:00Z", "2026-06-10T02:30:00Z")], MANILA);
    expect(ribbonSummary(blocks, MANILA, { durationFormat: "decimal", timeFormat: "12h" })).toBe(
      "1 entry, 1.50 tracked between 9:00 AM and 10:30 AM",
    );
  });

  it("counts only the part of an entry inside the day", () => {
    const blocks = blocksOf([entry("a", "2026-06-09T22:00:00Z", "2026-06-10T03:00:00Z")]);
    expect(ribbonSummary(blocks, "UTC", FORMATS)).toBe(
      "1 entry, 3:00 tracked between 00:00 and 03:00",
    );
  });

  it("says when a timer is running", () => {
    const blocks = blocksOf(
      [entry("r", "2026-06-10T09:00:00Z", null)],
      "UTC",
      new Date("2026-06-10T10:30:00Z"),
    );
    expect(ribbonSummary(blocks, "UTC", FORMATS)).toBe(
      "1 entry, 1:30 tracked between 09:00 and 10:30, timer running",
    );
  });

  it("says so when there is nothing", () => {
    expect(ribbonSummary([], "UTC", FORMATS)).toBe("No entries");
  });
});
