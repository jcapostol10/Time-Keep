import { describe, expect, it } from "vitest";

import { amountFor, currencyExponent, formatMoney, MAX_RATE_MAJOR, parseMoney } from "./money";

describe("currencyExponent", () => {
  it("knows how many minor units a currency has", () => {
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
  });
});

describe("parseMoney", () => {
  it("reads typed amounts exactly into minor units", () => {
    expect(parseMoney("1,250.50", "USD")).toBe(125050);
    expect(parseMoney("1250.5", "USD")).toBe(125050);
    expect(parseMoney(" 0 ", "USD")).toBe(0);
    expect(parseMoney("0.1", "USD")).toBe(10);
    expect(parseMoney("12.345", "KWD")).toBe(12345);
    expect(parseMoney("1000", "JPY")).toBe(1000);
    expect(parseMoney(String(MAX_RATE_MAJOR), "USD")).toBe(MAX_RATE_MAJOR * 100);
  });

  it("refuses what is not an amount in that currency", () => {
    expect(parseMoney("12.345", "USD")).toBeNull();
    expect(parseMoney("1000.5", "JPY")).toBeNull();
    expect(parseMoney("-5", "USD")).toBeNull();
    expect(parseMoney("", "USD")).toBeNull();
    expect(parseMoney("abc", "USD")).toBeNull();
    expect(parseMoney("1,25", "USD")).toBeNull();
    expect(parseMoney("1e3", "USD")).toBeNull();
    expect(parseMoney("1000000.01", "USD")).toBeNull();
  });
});

describe("amountFor", () => {
  it("rounds half up per entry, in integers", () => {
    // 123.45 an hour for 1.5 hours = 185.175 → 185.18
    expect(amountFor(12345, 5400)).toBe(18518);
    expect(amountFor(1, 1)).toBe(0);
    expect(amountFor(1, 1800)).toBe(1); // 0.5 rounds up
    expect(amountFor(0, 3600)).toBe(0);
  });

  it("stays exact beyond 2^53 intermediate products", () => {
    expect(amountFor(100_000_000, 3_600_000)).toBe(100_000_000_000);
    expect(amountFor(99_999_999_99, 3_596_400)).toBe(9_989_999_999_001);
  });
});

describe("formatMoney", () => {
  it("formats minor units with the currency's symbol and digits", () => {
    expect(formatMoney(125050, "USD")).toBe("$1,250.50");
    expect(formatMoney(1000, "JPY")).toBe("¥1,000");
    expect(formatMoney(0, "USD")).toBe("$0.00");
  });
});
