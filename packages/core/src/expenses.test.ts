import { describe, expect, it } from "vitest";

import {
  addExpenseTotals,
  EMPTY_EXPENSE_TOTALS,
  expenseAmount,
  formatQuantity,
  parseQuantity,
  receiptExtension,
  sniffReceipt,
} from "./expenses";

const bytes = (...values: (number | string)[]) =>
  Uint8Array.from(
    values.flatMap((v) => (typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v])),
  );

describe("sniffReceipt", () => {
  it("reads magic bytes, not names", () => {
    expect(sniffReceipt(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("image/jpeg");
    expect(sniffReceipt(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe("image/png");
    expect(sniffReceipt(bytes("RIFF", 0x10, 0, 0, 0, "WEBPVP8 "))).toBe("image/webp");
    expect(sniffReceipt(bytes("%PDF-1.7\n"))).toBe("application/pdf");
    expect(sniffReceipt(bytes("GIF89a"))).toBeNull();
    expect(sniffReceipt(new Uint8Array())).toBeNull();
    // RIFF without WEBP is not a receipt (a WAV file).
    expect(sniffReceipt(bytes("RIFF", 0x10, 0, 0, 0, "WAVEfmt "))).toBeNull();
  });

  it("names the extension of each type", () => {
    expect(receiptExtension("image/jpeg")).toBe("jpg");
    expect(receiptExtension("image/png")).toBe("png");
    expect(receiptExtension("image/webp")).toBe("webp");
    expect(receiptExtension("application/pdf")).toBe("pdf");
  });
});

describe("expenseAmount", () => {
  it("rounds half up in integers", () => {
    expect(expenseAmount(1250, 1500)).toBe(18750);
    expect(expenseAmount(150, 1)).toBe(2);
    expect(expenseAmount(100, 1)).toBe(1);
    expect(expenseAmount(1, 1)).toBe(0);
  });
});

describe("parseQuantity", () => {
  it("takes up to two decimals, comma or point", () => {
    expect(parseQuantity("12.5")).toBe(1250);
    expect(parseQuantity("1,5")).toBe(150);
    expect(parseQuantity("12")).toBe(1200);
    expect(parseQuantity(" 3.25 ")).toBe(325);
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("0.00")).toBeNull();
    expect(parseQuantity("12.345")).toBeNull();
    expect(parseQuantity("abc")).toBeNull();
    expect(parseQuantity("")).toBeNull();
    expect(parseQuantity("-1")).toBeNull();
  });

  it("formats hundredths back without trailing zeros", () => {
    expect(formatQuantity(1250)).toBe("12.5");
    expect(formatQuantity(1200)).toBe("12");
    expect(formatQuantity(1234)).toBe("12.34");
    expect(formatQuantity(5)).toBe("0.05");
  });
});

describe("addExpenseTotals", () => {
  it("sums the three fields", () => {
    expect(
      addExpenseTotals(
        { count: 1, amountMinor: 1000, billableMinor: 1000 },
        { count: 2, amountMinor: 500, billableMinor: 0 },
      ),
    ).toEqual({ count: 3, amountMinor: 1500, billableMinor: 1000 });
    expect(EMPTY_EXPENSE_TOTALS).toEqual({ count: 0, amountMinor: 0, billableMinor: 0 });
  });
});
