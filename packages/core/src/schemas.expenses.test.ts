import { describe, expect, it } from "vitest";

import {
  expenseCategoryInputSchema,
  expenseCategoryPatchSchema,
  expenseInputSchema,
  expensePatchSchema,
} from "./schemas";

describe("expense category input (Phase 6c)", () => {
  it("a unit category needs a unit name and a price", () => {
    const noUnit = expenseCategoryInputSchema.safeParse({
      name: "Mileage",
      kind: "UNIT",
      unitPriceMinor: 1500,
    });
    expect(noUnit.success).toBe(false);
    expect(JSON.stringify(noUnit.error?.issues)).toContain("Name the unit.");
    const noPrice = expenseCategoryInputSchema.safeParse({
      name: "Mileage",
      kind: "UNIT",
      unitName: "km",
    });
    expect(noPrice.success).toBe(false);
    expect(JSON.stringify(noPrice.error?.issues)).toContain("Enter a price per unit.");
    expect(
      expenseCategoryInputSchema.safeParse({
        name: "Mileage",
        kind: "UNIT",
        unitName: "km",
        unitPriceMinor: 1500,
      }).success,
    ).toBe(true);
  });

  it("a fixed category passes with both null and defaults billable", () => {
    const parsed = expenseCategoryInputSchema.parse({ name: "Travel", kind: "FIXED" });
    expect(parsed).toEqual({
      name: "Travel",
      kind: "FIXED",
      unitName: null,
      unitPriceMinor: null,
      billableDefault: true,
    });
    expect(expenseCategoryPatchSchema.parse({ archived: true })).toEqual({ archived: true });
  });
});

describe("expense input (Phase 6c)", () => {
  const base = {
    projectId: "p1",
    categoryId: "c1",
    date: "2026-11-09",
    billable: true,
  };

  it("refuses a zero amount and accepts a quantity without an amount", () => {
    expect(expenseInputSchema.safeParse({ ...base, amountMinor: 0 }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...base, quantityCenti: 0 }).success).toBe(false);
    const unit = expenseInputSchema.parse({ ...base, quantityCenti: 150 });
    expect(unit.quantityCenti).toBe(150);
    expect(unit.amountMinor).toBeUndefined();
  });

  it("defaults the description and leaves the admin note optional", () => {
    const parsed = expenseInputSchema.parse({ ...base, amountMinor: 12550 });
    expect(parsed.description).toBe("");
    expect(parsed.note).toBeUndefined();
    expect(parsed.userId).toBeUndefined();
    expect(
      expenseInputSchema.parse({ ...base, amountMinor: 1, note: "Receipt arrived late" }).note,
    ).toBe("Receipt arrived late");
    expect(
      expenseInputSchema.safeParse({ ...base, amountMinor: 1, date: "9/11/2026" }).success,
    ).toBe(false);
  });

  it("a patch is every field optional, with no person", () => {
    expect(expensePatchSchema.parse({ amountMinor: 3000 })).toEqual({ amountMinor: 3000 });
    expect(expensePatchSchema.parse({})).toEqual({});
    expect("userId" in expensePatchSchema.shape).toBe(false);
  });
});
