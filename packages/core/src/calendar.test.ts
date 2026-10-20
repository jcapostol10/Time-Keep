import { describe, expect, it } from "vitest";

import {
  blockOnDay,
  createdRange,
  layoutColumns,
  movedRange,
  resizedRange,
  slotInstant,
  snapMinutes,
} from "./calendar";

const MANILA = "Asia/Manila";
const NY = "America/New_York";

describe("snapMinutes", () => {
  it("rounds to the nearest slot and clamps to the day", () => {
    expect(snapMinutes(532)).toBe(525);
    expect(snapMinutes(547)).toBe(540);
    expect(snapMinutes(548)).toBe(555);
    expect(snapMinutes(-10)).toBe(0);
    expect(snapMinutes(1500)).toBe(1440);
  });
});

describe("blockOnDay", () => {
  it("places an entry by wall-clock minutes", () => {
    const block = blockOnDay(
      { start: "2026-03-09T01:00:00.000Z", end: "2026-03-09T02:30:00.000Z" }, // 09:00–10:30 Manila
      "2026-03-09",
      MANILA,
    );
    expect(block).toEqual({ top: 540, height: 90, clippedStart: false, clippedEnd: false });
  });

  it("splits an entry that crosses midnight across both days", () => {
    const range = { start: "2026-03-09T15:30:00.000Z", end: "2026-03-09T16:30:00.000Z" }; // 23:30–00:30
    expect(blockOnDay(range, "2026-03-09", MANILA)).toEqual({
      top: 1410,
      height: 30,
      clippedStart: false,
      clippedEnd: true,
    });
    expect(blockOnDay(range, "2026-03-10", MANILA)).toEqual({
      top: 0,
      height: 30,
      clippedStart: true,
      clippedEnd: false,
    });
    expect(blockOnDay(range, "2026-03-11", MANILA)).toBeNull();
  });

  it("ends at the bottom when the entry ends exactly at midnight", () => {
    const range = { start: "2026-03-09T15:00:00.000Z", end: "2026-03-09T16:00:00.000Z" }; // 23:00–24:00
    expect(blockOnDay(range, "2026-03-09", MANILA)).toEqual({
      top: 1380,
      height: 60,
      clippedStart: false,
      clippedEnd: false,
    });
    expect(blockOnDay(range, "2026-03-10", MANILA)).toBeNull();
  });
});

describe("layoutColumns", () => {
  it("gives overlapping blocks side-by-side columns", () => {
    const layout = layoutColumns([
      { id: "a", top: 540, height: 60 },
      { id: "b", top: 570, height: 60 },
      { id: "c", top: 660, height: 60 },
    ]);
    expect(layout.get("a")).toEqual({ column: 0, columns: 2 });
    expect(layout.get("b")).toEqual({ column: 1, columns: 2 });
    expect(layout.get("c")).toEqual({ column: 0, columns: 1 });
  });
});

describe("slotInstant and createdRange", () => {
  it("maps 24:00 to the next day's midnight", () => {
    expect(slotInstant("2026-03-09", 1440, MANILA).toISOString()).toBe("2026-03-09T16:00:00.000Z");
  });

  it("sorts, snaps and enforces one slot", () => {
    expect(createdRange("2026-03-09", 600, 540, MANILA)).toEqual({
      start: new Date("2026-03-09T01:00:00.000Z"),
      end: new Date("2026-03-09T02:00:00.000Z"),
    });
    expect(createdRange("2026-03-09", 540, 545, MANILA)).toEqual({
      start: new Date("2026-03-09T01:00:00.000Z"),
      end: new Date("2026-03-09T01:15:00.000Z"),
    });
    expect(createdRange("2026-03-09", 1380, 1500, MANILA)).toEqual({
      start: new Date("2026-03-09T15:00:00.000Z"),
      end: new Date("2026-03-09T16:00:00.000Z"),
    });
  });
});

describe("movedRange", () => {
  const range = { start: "2026-03-07T14:00:00.000Z", end: "2026-03-07T15:30:00.000Z" }; // 09:00–10:30 EST

  it("keeps the duration across the spring-forward day", () => {
    expect(movedRange(range, "2026-03-08", 90, NY)).toEqual({
      start: new Date("2026-03-08T06:30:00.000Z"), // 01:30 EST
      end: new Date("2026-03-08T08:00:00.000Z"), // 90 minutes later: 03:00 EDT
    });
  });

  it("moves a nonexistent wall time forward", () => {
    expect(movedRange(range, "2026-03-08", 150, NY).start.toISOString()).toBe(
      "2026-03-08T07:30:00.000Z", // 02:30 does not exist; 03:30 EDT
    );
  });

  it("snaps the start and keeps the block inside the day", () => {
    expect(movedRange(range, "2026-03-09", 1430, MANILA)).toEqual({
      start: new Date("2026-03-09T14:30:00.000Z"), // 22:30, so the 90 minutes end at 24:00
      end: new Date("2026-03-09T16:00:00.000Z"),
    });
  });
});

describe("resizedRange", () => {
  const range = { start: "2026-03-09T01:00:00.000Z", end: "2026-03-09T02:00:00.000Z" }; // 09:00–10:00

  it("moves the end, never closer than one slot to the start", () => {
    expect(resizedRange(range, "end", "2026-03-09", 630, MANILA)).toEqual({
      start: new Date("2026-03-09T01:00:00.000Z"),
      end: new Date("2026-03-09T02:30:00.000Z"),
    });
    expect(resizedRange(range, "end", "2026-03-09", 500, MANILA).end.toISOString()).toBe(
      "2026-03-09T01:15:00.000Z",
    );
  });

  it("moves the start, never closer than one slot to the end", () => {
    expect(resizedRange(range, "start", "2026-03-09", 510, MANILA).start.toISOString()).toBe(
      "2026-03-09T00:30:00.000Z",
    );
    expect(resizedRange(range, "start", "2026-03-09", 700, MANILA).start.toISOString()).toBe(
      "2026-03-09T01:45:00.000Z",
    );
  });
});
