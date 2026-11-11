import { describe, expect, it } from "vitest";

import { forecast, proportion } from "./forecast";

const MON = "2026-11-16";
const TUE = "2026-11-17";

describe("forecast", () => {
  it("a time estimate's completion is the day the plan reaches it, and the overrun is what the plan adds past it", () => {
    const f = forecast({
      kind: "TIME",
      estimate: 36_000,
      trackedSeconds: 14_400,
      trackedMinor: 400_000,
      trackedReachedOn: null,
      scheduled: [
        { dateKey: MON, seconds: 28_800, minor: 800_000 },
        { dateKey: TUE, seconds: 28_800, minor: 800_000 },
      ],
      unratedSeconds: 0,
    });
    expect(f.completionDate).toBe(MON);
    expect(f.reachedOn).toBeNull();
    expect([f.projectedSeconds, f.projectedMinor]).toEqual([72_000, 2_000_000]);
    expect([f.scheduledSeconds, f.scheduledMinor]).toEqual([57_600, 1_600_000]);
    expect([f.overrunSeconds, f.overrunMinor]).toEqual([36_000, 1_000_000]);
    expect(f.series.map((p) => p.value)).toEqual([14_400, 43_200, 72_000]);
  });

  it("already past the estimate: reached on the tracked day, everything scheduled overruns", () => {
    const f = forecast({
      kind: "TIME",
      estimate: 3_600,
      trackedSeconds: 7_200,
      trackedMinor: 0,
      trackedReachedOn: "2026-11-10",
      scheduled: [{ dateKey: MON, seconds: 3_600, minor: 0 }],
      unratedSeconds: 3_600,
    });
    expect([f.reachedOn, f.completionDate]).toEqual(["2026-11-10", null]);
    expect(f.overrunSeconds).toBe(7_200);
    expect(f.overrunMinor).toBe(0);
    expect(f.unratedSeconds).toBe(3_600);
  });

  it("never reached: no completion, no overrun", () => {
    const f = forecast({
      kind: "TIME",
      estimate: 100_000,
      trackedSeconds: 3_600,
      trackedMinor: 100,
      trackedReachedOn: null,
      scheduled: [{ dateKey: MON, seconds: 3_600, minor: 100 }],
      unratedSeconds: 0,
    });
    expect([f.completionDate, f.reachedOn, f.overrunSeconds, f.overrunMinor]).toEqual([
      null,
      null,
      0,
      0,
    ]);
  });

  it("a money estimate's overrun converts to time by share", () => {
    const f = forecast({
      kind: "MONEY",
      estimate: 1_000_000,
      trackedSeconds: 18_000,
      trackedMinor: 500_000,
      trackedReachedOn: null,
      scheduled: [{ dateKey: MON, seconds: 36_000, minor: 1_000_000 }],
      unratedSeconds: 0,
    });
    expect(f.completionDate).toBe(MON);
    expect([f.overrunMinor, f.overrunSeconds]).toEqual([500_000, 18_000]);
    expect(f.series.map((p) => p.value)).toEqual([500_000, 1_500_000]);
  });
});

describe("proportion", () => {
  it("proportion rounds half up in integers", () => {
    expect(proportion(5, 1, 2)).toBe(3);
    expect(proportion(0, 1, 2)).toBe(0);
    expect(proportion(7, 0, 0)).toBe(0);
    expect(proportion(2_000_000, 36_000, 72_000)).toBe(1_000_000);
  });
});
