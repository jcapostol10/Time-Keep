import { describe, expect, it } from "vitest";

import {
  computeDurationSeconds,
  formatClock,
  formatDuration,
  MAX_ENTRY_SECONDS,
  parseDuration,
} from "./duration";

describe("parseDuration", () => {
  it.each([
    ["1:30", 5400],
    ["1:30:00", 5400],
    ["0:02:15", 135],
    ["10:00:00", 36000],
    ["1.5", 5400],
    ["1,5", 5400],
    ["2", 7200],
    ["0.25", 900],
    ["90m", 5400],
    ["1h30m", 5400],
    ["1h 30m", 5400],
    ["1h30", 5400],
    ["2h", 7200],
    ["45s", 45],
    ["1h 2m 3s", 3723],
    ["  1:30  ", 5400],
    ["1H30M", 5400],
    ["999h", MAX_ENTRY_SECONDS],
  ])("parses %j as %i seconds", (input, seconds) => {
    expect(parseDuration(input)).toBe(seconds);
  });

  it.each(["", "   ", "abc", "1:75", "1:30:75", "-1", "-1:30", "1000h", "1:2:3:4", "h", "1.5.5"])(
    "rejects %j",
    (input) => {
      expect(parseDuration(input)).toBeNull();
    },
  );
});

describe("formatDuration", () => {
  it("renders every workspace format", () => {
    expect(formatDuration(5400, "hh:mm:ss")).toBe("1:30:00");
    expect(formatDuration(5400, "hh:mm")).toBe("1:30");
    expect(formatDuration(5400, "decimal")).toBe("1.50");
  });

  it("does not pad hours and keeps growing past 99", () => {
    expect(formatDuration(0, "hh:mm:ss")).toBe("0:00:00");
    expect(formatDuration(135, "hh:mm:ss")).toBe("0:02:15");
    expect(formatDuration(3_600_000, "hh:mm:ss")).toBe("1000:00:00");
  });

  it("floors to the minute in hh:mm and rounds to 2 decimals in decimal", () => {
    expect(formatDuration(59, "hh:mm")).toBe("0:00");
    expect(formatDuration(5459, "hh:mm")).toBe("1:30");
    expect(formatDuration(135, "decimal")).toBe("0.04");
  });

  it("clamps negative input to zero", () => {
    expect(formatDuration(-5, "hh:mm:ss")).toBe("0:00:00");
  });
});

describe("formatClock", () => {
  it("always renders h:mm:ss", () => {
    expect(formatClock(0)).toBe("0:00:00");
    expect(formatClock(130)).toBe("0:02:10");
    expect(formatClock(36610)).toBe("10:10:10");
  });
});

describe("computeDurationSeconds", () => {
  it("rounds to whole seconds", () => {
    const start = new Date("2026-03-09T01:00:00.000Z");
    expect(computeDurationSeconds(start, new Date("2026-03-09T01:02:15.400Z"))).toBe(135);
    expect(computeDurationSeconds(start, new Date("2026-03-09T01:02:15.600Z"))).toBe(136);
  });
});
