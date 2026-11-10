import { describe, expect, it } from "vitest";

import {
  invoiceCreateSchema,
  invoiceImportSchema,
  invoiceLineSchema,
  invoicePatchSchema,
  invoiceSettingsSchema,
  paymentInputSchema,
  recurringInvoiceSchema,
} from "./schemas";

const issues = (r: { error?: { issues: unknown[] } }) => JSON.stringify(r.error?.issues ?? []);

describe("invoice settings (Phase 6d)", () => {
  it("defaults to INV-0001 and 30-day terms", () => {
    expect(invoiceSettingsSchema.parse({})).toEqual({
      companyName: "",
      address: "",
      taxLine: "",
      notes: "",
      paymentTermsDays: 30,
      numberPrefix: "INV-",
      nextNumber: 1,
      numberPadding: 4,
      tax1Name: null,
      tax1Bps: null,
      tax2Name: null,
      tax2Bps: null,
    });
  });

  it("a tax name needs its rate and a rate its name", () => {
    const noRate = invoiceSettingsSchema.safeParse({ tax1Name: "VAT" });
    expect(noRate.success).toBe(false);
    expect(issues(noRate)).toContain("Enter the tax rate.");
    const noName = invoiceSettingsSchema.safeParse({ tax2Bps: 1200 });
    expect(noName.success).toBe(false);
    expect(issues(noName)).toContain("Name the tax.");
    expect(invoiceSettingsSchema.safeParse({ tax1Name: "VAT", tax1Bps: 1200 }).success).toBe(true);
  });

  it("the next number starts at 1 and a percent stops at 100", () => {
    expect(invoiceSettingsSchema.safeParse({ nextNumber: 0 }).success).toBe(false);
    expect(invoiceSettingsSchema.safeParse({ tax1Name: "VAT", tax1Bps: 10001 }).success).toBe(
      false,
    );
    expect(invoiceSettingsSchema.safeParse({ numberPadding: 9 }).success).toBe(false);
  });
});

describe("invoice create and patch", () => {
  it("creates with a client and an issue date", () => {
    expect(invoiceCreateSchema.parse({ clientId: "c1", issueDate: "2026-03-01" })).toEqual({
      clientId: "c1",
      issueDate: "2026-03-01",
    });
    expect(invoiceCreateSchema.safeParse({ clientId: "", issueDate: "2026-03-01" }).success).toBe(
      false,
    );
  });

  it("a due date before the issue date is refused", () => {
    const r = invoicePatchSchema.safeParse({ issueDate: "2026-03-10", dueDate: "2026-03-09" });
    expect(r.success).toBe(false);
    expect(issues(r)).toContain("The due date is before the issue date.");
    expect(
      invoicePatchSchema.safeParse({ issueDate: "2026-03-10", dueDate: "2026-03-10" }).success,
    ).toBe(true);
    expect(invoicePatchSchema.safeParse({ dueDate: "2026-03-09" }).success).toBe(true);
  });

  it("taxes come in named pairs and the number is short", () => {
    const r = invoicePatchSchema.safeParse({ tax1Bps: 500 });
    expect(r.success).toBe(false);
    expect(issues(r)).toContain("Name the tax.");
    expect(invoicePatchSchema.safeParse({ number: "" }).success).toBe(false);
    expect(invoicePatchSchema.safeParse({ discountBps: 10001 }).success).toBe(false);
    expect(invoicePatchSchema.parse({ number: " INV-9 ", notes: "x" })).toEqual({
      number: "INV-9",
      notes: "x",
    });
  });
});

describe("lines, imports and payments", () => {
  it("a line has a description, a positive quantity and a price", () => {
    expect(
      invoiceLineSchema.parse({ description: "Design", quantityCenti: 200, unitPriceMinor: 10000 }),
    ).toEqual({ description: "Design", quantityCenti: 200, unitPriceMinor: 10000 });
    expect(
      invoiceLineSchema.safeParse({ description: "Design", quantityCenti: 0, unitPriceMinor: 1 })
        .success,
    ).toBe(false);
    expect(
      invoiceLineSchema.safeParse({ description: "", quantityCenti: 1, unitPriceMinor: 1 }).success,
    ).toBe(false);
  });

  it("an import range runs forward and defaults to projects with expenses", () => {
    expect(invoiceImportSchema.parse({ from: "2026-03-01", to: "2026-03-31" })).toEqual({
      from: "2026-03-01",
      to: "2026-03-31",
      projectIds: [],
      groupBy: "project",
      expenses: true,
    });
    expect(invoiceImportSchema.safeParse({ from: "2026-03-02", to: "2026-03-01" }).success).toBe(
      false,
    );
  });

  it("a payment is a positive amount on a date", () => {
    expect(paymentInputSchema.parse({ date: "2026-03-01", amountMinor: 5000 })).toEqual({
      date: "2026-03-01",
      amountMinor: 5000,
      note: "",
    });
    expect(paymentInputSchema.safeParse({ date: "2026-03-01", amountMinor: 0 }).success).toBe(
      false,
    );
  });
});

describe("recurring invoice", () => {
  const base = { clientId: "c1", name: "Retainer", startDate: "2026-01-01" };
  const line = { description: "Retainer", quantityCenti: 100, unitPriceMinor: 50000 };

  it("WEEKLY needs a weekday and MONTHLY a day of the month", () => {
    const weekly = recurringInvoiceSchema.safeParse({ ...base, schedule: "WEEKLY", lines: [line] });
    expect(weekly.success).toBe(false);
    expect(issues(weekly)).toContain("Pick a weekday.");
    const monthly = recurringInvoiceSchema.safeParse({
      ...base,
      schedule: "MONTHLY",
      lines: [line],
    });
    expect(monthly.success).toBe(false);
    expect(issues(monthly)).toContain("Pick a day of the month.");
    expect(
      recurringInvoiceSchema.safeParse({
        ...base,
        schedule: "MONTHLY",
        dayOfMonth: 31,
        lines: [line],
      }).success,
    ).toBe(true);
  });

  it("needs a line or the import, and an end after the start", () => {
    const empty = recurringInvoiceSchema.safeParse({ ...base, schedule: "WEEKLY", weekday: 1 });
    expect(empty.success).toBe(false);
    expect(issues(empty)).toContain("Add a line or import the period.");
    expect(
      recurringInvoiceSchema.safeParse({
        ...base,
        schedule: "WEEKLY",
        weekday: 1,
        importPeriod: true,
      }).success,
    ).toBe(true);
    expect(
      recurringInvoiceSchema.safeParse({
        ...base,
        schedule: "WEEKLY",
        weekday: 1,
        lines: [line],
        endDate: "2025-12-31",
      }).success,
    ).toBe(false);
  });

  it("defaults to an active draft template grouped by project", () => {
    expect(
      recurringInvoiceSchema.parse({ ...base, schedule: "MONTHLY", dayOfMonth: 1, lines: [line] }),
    ).toMatchObject({
      weekday: null,
      endDate: null,
      importPeriod: false,
      importGroupBy: "project",
      mode: "DRAFT",
      active: true,
    });
  });
});
