import { describe, expect, it } from "vitest";

import {
  ROUNDING_MODES,
  ROUNDING_STEPS,
  roundDuration,
  type RoundingMode,
  roundingLabel,
  type RoundingStep,
} from "./rounding";

describe("roundDuration", () => {
  it.each<[RoundingMode, RoundingStep, number, number]>([
    ["off", 1, 61, 61],
    ["up", 1, 61, 120],
    ["up", 15, 900, 900],
    ["down", 15, 899, 0],
    ["nearest", 15, 450, 900],
    ["nearest", 15, 449, 0],
    ["nearest", 15, 1350, 1800],
  ])("%s at %d min: %d → %d", (mode, minutes, input, expected) => {
    expect(roundDuration(input, { mode, minutes })).toBe(expected);
  });

  it("never returns a negative duration", () => {
    for (const mode of ROUNDING_MODES) {
      expect(roundDuration(0, { mode, minutes: 15 })).toBe(0);
      expect(roundDuration(-5, { mode, minutes: 15 })).toBe(0);
    }
  });

  it("leaves a multiple of the step unchanged in every mode", () => {
    for (const minutes of ROUNDING_STEPS) {
      for (const mode of ROUNDING_MODES) {
        expect(roundDuration(minutes * 60 * 3, { mode, minutes })).toBe(minutes * 60 * 3);
      }
    }
  });
});

describe("roundingLabel", () => {
  it("names the mode and the step", () => {
    expect(roundingLabel({ mode: "nearest", minutes: 6 })).toBe("Nearest 6 min");
    expect(roundingLabel({ mode: "up", minutes: 15 })).toBe("Up to 15 min");
    expect(roundingLabel({ mode: "down", minutes: 30 })).toBe("Down to 30 min");
    expect(roundingLabel({ mode: "off", minutes: 15 })).toBe("Off");
    expect(roundingLabel(null)).toBe("Off");
  });
});
