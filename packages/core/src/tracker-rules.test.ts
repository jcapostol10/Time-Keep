import { describe, expect, it } from "vitest";

import { heuristicIdleSince, pomodoroState, shouldRemind } from "./tracker-rules";

describe("pomodoroState", () => {
  // 25 min focus, 5 min break: boundaries at 25, 30, 55, 60 ... minutes
  const at = (min: number) => pomodoroState(min * 60, 25, 5);

  it("starts in focus with no boundary passed", () => {
    expect(at(0)).toEqual({ phase: "focus", boundaries: 0 });
    expect(at(24.99)).toEqual({ phase: "focus", boundaries: 0 });
  });

  it("switches to break at the end of focus and back after the break", () => {
    expect(at(25)).toEqual({ phase: "break", boundaries: 1 });
    expect(at(29)).toEqual({ phase: "break", boundaries: 1 });
    expect(at(30)).toEqual({ phase: "focus", boundaries: 2 });
    expect(at(55)).toEqual({ phase: "break", boundaries: 3 });
    expect(at(61)).toEqual({ phase: "focus", boundaries: 4 });
  });
});

describe("shouldRemind (Mon–Fri 09:00–17:00, Asia/Manila)", () => {
  const base = {
    tz: "Asia/Manila",
    days: [1, 2, 3, 4, 5],
    startMinutes: 540,
    endMinutes: 1020,
    lastRemindedAt: null as Date | null,
    throttleMs: 60 * 60_000,
  };
  // Wednesday 2026-03-11 10:00 Manila = 02:00Z
  const wed10 = new Date("2026-03-11T02:00:00Z");

  it("reminds inside working hours on a working day", () => {
    expect(shouldRemind({ ...base, now: wed10 })).toBe(true);
  });

  it("stays quiet outside the window or on other days", () => {
    expect(shouldRemind({ ...base, now: new Date("2026-03-11T00:59:00Z") })).toBe(false); // 08:59
    expect(shouldRemind({ ...base, now: new Date("2026-03-11T09:00:00Z") })).toBe(false); // 17:00
    expect(shouldRemind({ ...base, now: new Date("2026-03-14T02:00:00Z") })).toBe(false); // Saturday
  });

  it("is throttled by the last reminder", () => {
    expect(
      shouldRemind({
        ...base,
        now: wed10,
        lastRemindedAt: new Date(wed10.getTime() - 30 * 60_000),
      }),
    ).toBe(false);
    expect(
      shouldRemind({
        ...base,
        now: wed10,
        lastRemindedAt: new Date(wed10.getTime() - 61 * 60_000),
      }),
    ).toBe(true);
  });
});

describe("heuristicIdleSince", () => {
  const now = new Date("2026-03-11T02:00:00Z");
  const minutes = (n: number) => new Date(now.getTime() - n * 60_000);
  const threshold = 15 * 60_000;

  it("is null while there was recent input and the clock kept ticking", () => {
    expect(
      heuristicIdleSince({
        now,
        lastInputAt: minutes(5),
        lastTickAt: minutes(0.5),
        thresholdMs: threshold,
      }),
    ).toBeNull();
  });

  it("reports the last input when input stopped for longer than the threshold", () => {
    expect(
      heuristicIdleSince({
        now,
        lastInputAt: minutes(20),
        lastTickAt: minutes(0.5),
        thresholdMs: threshold,
      }),
    ).toEqual(minutes(20));
  });

  it("detects a sleeping machine from a gap between ticks", () => {
    expect(
      heuristicIdleSince({
        now,
        lastInputAt: minutes(2),
        lastTickAt: minutes(30),
        thresholdMs: threshold,
      }),
    ).toEqual(minutes(30));
  });
});
