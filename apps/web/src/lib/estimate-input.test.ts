import { describe, expect, it } from "vitest";

import { estimateAmountText, hoursText, parseHours } from "./estimate-input";

// Review fix (Phase 6b, I2): a money estimate must round-trip in every currency's decimals.

describe("estimateAmountText", () => {
  it("prints a money estimate in the currency's decimals", () => {
    expect(estimateAmountText({ kind: "MONEY", minor: 20_000, seconds: null }, "USD")).toBe(
      "200.00",
    );
    expect(estimateAmountText({ kind: "MONEY", minor: 5_000, seconds: null }, "JPY")).toBe("5000");
    expect(estimateAmountText({ kind: "MONEY", minor: 12_345, seconds: null }, "KWD")).toBe(
      "12.345",
    );
    expect(estimateAmountText({ kind: "MONEY", minor: 1_250_50, seconds: null }, "USD")).toBe(
      "1250.50",
    );
  });

  it("prints a time estimate as hours, and nothing for none", () => {
    expect(estimateAmountText({ kind: "TIME", minor: null, seconds: 36_000 }, "USD")).toBe("10");
    expect(estimateAmountText({ kind: "NONE", minor: null, seconds: null }, "USD")).toBe("");
  });
});

describe("hours", () => {
  it("round-trips through h:mm when not whole hours", () => {
    expect(hoursText(4_800)).toBe("1:20");
    expect(hoursText(36_000)).toBe("10");
    expect(hoursText(5_400)).toBe("1:30");
    expect(parseHours(hoursText(4_800)!)).toBe(4_800);
    expect(hoursText(null)).toBe("");
  });

  it("parses durations and plain hours past the duration ceiling", () => {
    expect(parseHours("40")).toBe(144_000);
    expect(parseHours("1:30")).toBe(5_400);
    expect(parseHours("2000")).toBe(7_200_000);
    expect(parseHours("1,5")).toBe(5_400);
    expect(parseHours("0")).toBeNull();
    expect(parseHours("abc")).toBeNull();
    expect(parseHours("")).toBeNull();
  });
});
