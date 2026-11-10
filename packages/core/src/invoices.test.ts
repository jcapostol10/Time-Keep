import { describe, expect, it } from "vitest";

import {
  balanceMinor,
  formatBps,
  formatInvoiceNumber,
  hoursText,
  invoiceStatus,
  invoiceTotals,
  lastDayOfMonth,
  lineAmount,
  monthStartKey,
  parseBps,
  percentOf,
  recurringDue,
} from "./invoices";

describe("invoiceStatus", () => {
  const sent = { status: "SENT" as const, totalMinor: 10000, paidMinor: 0, dueDate: "2026-03-10" };

  it("is SENT on the due date and OVERDUE the day after", () => {
    expect(invoiceStatus(sent, "2026-03-10")).toBe("SENT");
    expect(invoiceStatus(sent, "2026-03-11")).toBe("OVERDUE");
  });

  it("payments win over the due date", () => {
    const partial = { ...sent, paidMinor: 4000 };
    expect(invoiceStatus(partial, "2026-03-10")).toBe("PARTIALLY_PAID");
    expect(invoiceStatus(partial, "2026-03-11")).toBe("PARTIALLY_PAID");
    expect(invoiceStatus({ ...sent, paidMinor: 10000 }, "2026-03-11")).toBe("PAID");
    expect(invoiceStatus({ ...sent, paidMinor: 12000 }, "2026-03-11")).toBe("PAID");
  });

  it("a zero total is never PAID by itself", () => {
    expect(invoiceStatus({ ...sent, totalMinor: 0 }, "2026-03-01")).toBe("SENT");
    expect(invoiceStatus({ ...sent, totalMinor: 0 }, "2026-03-11")).toBe("OVERDUE");
  });

  it("VOID and DRAFT stay what they are", () => {
    expect(invoiceStatus({ ...sent, status: "VOID", paidMinor: 4000 }, "2026-03-11")).toBe("VOID");
    expect(invoiceStatus({ ...sent, status: "DRAFT" }, "2026-03-11")).toBe("DRAFT");
  });

  it("balanceMinor never goes below zero", () => {
    expect(balanceMinor(10000, 4000)).toBe(6000);
    expect(balanceMinor(10000, 12000)).toBe(0);
  });
});

describe("lineAmount and percentOf", () => {
  it("round half up in integers", () => {
    expect(lineAmount(33, 10000)).toBe(3300);
    expect(lineAmount(1, 1)).toBe(0);
    expect(lineAmount(150, 10000)).toBe(15000);
    expect(lineAmount(1, 50)).toBe(1); // 0.5 → 1
    expect(percentOf(1, 750)).toBe(0);
    expect(percentOf(10001, 500)).toBe(500);
    expect(percentOf(10003, 500)).toBe(500);
    expect(percentOf(10010, 500)).toBe(501);
    expect(percentOf(10000, 10000)).toBe(10000);
  });
});

describe("invoiceTotals", () => {
  const lines = [{ amountMinor: 10001 }, { amountMinor: 5000 }];

  it("takes the discount, then each tax on the discounted subtotal, rounded alone", () => {
    expect(invoiceTotals(lines, { discountBps: 1000, tax1Bps: 1200, tax2Bps: 125 })).toEqual({
      subtotalMinor: 15001,
      discountMinor: 1500,
      tax1Minor: 1620,
      tax2Minor: 169,
      totalMinor: 15290,
    });
  });

  it("a full discount leaves taxes on nothing", () => {
    expect(invoiceTotals(lines, { discountBps: 10000, tax1Bps: 1200, tax2Bps: 125 })).toEqual({
      subtotalMinor: 15001,
      discountMinor: 15001,
      tax1Minor: 0,
      tax2Minor: 0,
      totalMinor: 0,
    });
  });

  it("no taxes, no discount, no lines", () => {
    expect(invoiceTotals(lines, { discountBps: 0, tax1Bps: null, tax2Bps: null })).toEqual({
      subtotalMinor: 15001,
      discountMinor: 0,
      tax1Minor: 0,
      tax2Minor: 0,
      totalMinor: 15001,
    });
    expect(invoiceTotals([], { discountBps: 500, tax1Bps: 1200, tax2Bps: null }).totalMinor).toBe(
      0,
    );
  });
});

describe("parseBps and formatBps", () => {
  it("reads a percent with up to two decimals into hundredths of a percent", () => {
    expect(parseBps("7.5")).toBe(750);
    expect(parseBps("12,25")).toBe(1225);
    expect(parseBps("100")).toBe(10000);
    expect(parseBps("0")).toBe(0);
    expect(parseBps(" 7 ")).toBe(700);
    expect(parseBps("100.01")).toBeNull();
    expect(parseBps("7.555")).toBeNull();
    expect(parseBps("-1")).toBeNull();
    expect(parseBps("")).toBeNull();
    expect(parseBps("abc")).toBeNull();
  });

  it("prints the shortest percent", () => {
    expect(formatBps(750)).toBe("7.5");
    expect(formatBps(1000)).toBe("10");
    expect(formatBps(1)).toBe("0.01");
    expect(formatBps(0)).toBe("0");
    expect(formatBps(1225)).toBe("12.25");
  });
});

describe("formatInvoiceNumber and hoursText", () => {
  it("pads the sequence after the prefix", () => {
    expect(formatInvoiceNumber("INV-", 1, 4)).toBe("INV-0001");
    expect(formatInvoiceNumber("", 12, 0)).toBe("12");
    expect(formatInvoiceNumber("ACME-", 3, 3)).toBe("ACME-003");
    expect(formatInvoiceNumber("INV-", 12345, 4)).toBe("INV-12345");
  });

  it("shows hours to two decimals", () => {
    expect(hoursText(5400)).toBe("1.50");
    expect(hoursText(1200)).toBe("0.33");
    expect(hoursText(0)).toBe("0.00");
  });
});

describe("recurringDue", () => {
  it("month helpers", () => {
    expect(lastDayOfMonth("2026-02-10")).toBe(28);
    expect(lastDayOfMonth("2028-02-01")).toBe(29);
    expect(lastDayOfMonth("2026-04-15")).toBe(30);
    expect(monthStartKey("2026-02-28")).toBe("2026-02-01");
  });

  const monthly31 = {
    kind: "MONTHLY" as const,
    weekday: null,
    dayOfMonth: 31,
    startDate: "2026-01-01",
    endDate: null,
  };

  it("a monthly template on the 31st runs on the month's last day and bills the previous month", () => {
    expect(recurringDue(monthly31, "2026-02-28")).toEqual({
      periodKey: "2026-01-01",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    expect(recurringDue(monthly31, "2026-02-27")).toBeNull();
    expect(recurringDue(monthly31, "2028-02-29")).toEqual({
      periodKey: "2028-01-01",
      periodStart: "2028-01-01",
      periodEnd: "2028-01-31",
    });
    expect(recurringDue(monthly31, "2026-04-30")).toEqual({
      periodKey: "2026-03-01",
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
    });
    expect(recurringDue(monthly31, "2026-05-31")?.periodEnd).toBe("2026-04-30");
    // The period before the start date is not billed.
    expect(recurringDue(monthly31, "2026-01-31")).toBeNull();
    expect(recurringDue({ ...monthly31, dayOfMonth: 1 }, "2026-02-01")?.periodKey).toBe(
      "2026-01-01",
    );
  });

  const weeklyMonday = {
    kind: "WEEKLY" as const,
    weekday: 1,
    dayOfMonth: null,
    startDate: "2026-03-02",
    endDate: null,
  };

  it("a weekly template on Monday bills the previous Monday to Sunday", () => {
    expect(recurringDue(weeklyMonday, "2026-03-09")).toEqual({
      periodKey: "2026-03-02",
      periodStart: "2026-03-02",
      periodEnd: "2026-03-08",
    });
    expect(recurringDue(weeklyMonday, "2026-03-10")).toBeNull();
    expect(recurringDue(weeklyMonday, "2026-03-02")).toBeNull();
    expect(recurringDue({ ...weeklyMonday, startDate: "2026-03-03" }, "2026-03-09")).toBeNull();
  });

  it("stops before the start and after the end", () => {
    expect(recurringDue({ ...weeklyMonday, startDate: "2026-03-10" }, "2026-03-09")).toBeNull();
    expect(recurringDue({ ...weeklyMonday, endDate: "2026-03-08" }, "2026-03-09")).toBeNull();
    expect(recurringDue({ ...weeklyMonday, endDate: "2026-03-09" }, "2026-03-09")).not.toBeNull();
  });
});
