import { describe, expect, it } from "vitest";
import {
  countRequestCenti,
  DEFAULT_CAPACITY,
  formatCenti,
  formatTimeOffDates,
  policyBalance,
  timeOffMinutesByDay,
  wouldGoNegative,
  type BalanceInput,
  type Capacity,
  type TimeOffSpan,
} from "./time-off";

const none = new Set<string>();
const span = (start: string, end: string, extra: Partial<TimeOffSpan> = {}): TimeOffSpan => ({
  start,
  end,
  halfDay: false,
  minutes: null,
  ...extra,
});
const sunToThu: Capacity = { ...DEFAULT_CAPACITY, workingDays: [0, 1, 2, 3, 4] };

describe("countRequestCenti", () => {
  it("counts working days and skips a holiday", () => {
    // 2026-11-02 is a Monday.
    expect(
      countRequestCenti(
        "DAYS",
        span("2026-11-02", "2026-11-06"),
        DEFAULT_CAPACITY,
        new Set(["2026-11-04"]),
      ),
    ).toBe(400);
  });

  it("counts nothing for a weekend", () => {
    expect(
      countRequestCenti("DAYS", span("2026-11-07", "2026-11-08"), DEFAULT_CAPACITY, none),
    ).toBe(0);
  });

  it("counts the person's own working week", () => {
    expect(countRequestCenti("DAYS", span("2026-11-01", "2026-11-07"), sunToThu, none)).toBe(500);
  });

  it("counts a half day as 50", () => {
    expect(
      countRequestCenti(
        "DAYS",
        span("2026-11-03", "2026-11-03", { halfDay: true }),
        DEFAULT_CAPACITY,
        none,
      ),
    ).toBe(50);
  });

  it("refuses a half day on a range", () => {
    expect(() =>
      countRequestCenti(
        "DAYS",
        span("2026-11-03", "2026-11-04", { halfDay: true }),
        DEFAULT_CAPACITY,
        none,
      ),
    ).toThrow("A half day is for a one-day request.");
  });

  it("refuses a span across two years", () => {
    expect(() =>
      countRequestCenti("DAYS", span("2026-12-30", "2027-01-02"), DEFAULT_CAPACITY, none),
    ).toThrow("Time off cannot span two years: split the request.");
  });

  it("refuses an end before the start", () => {
    expect(() =>
      countRequestCenti("DAYS", span("2026-11-04", "2026-11-03"), DEFAULT_CAPACITY, none),
    ).toThrow();
  });

  it("counts hours in hundredths", () => {
    expect(
      countRequestCenti(
        "HOURS",
        span("2026-11-03", "2026-11-03", { minutes: 90 }),
        DEFAULT_CAPACITY,
        none,
      ),
    ).toBe(150);
  });
});

describe("timeOffMinutesByDay", () => {
  it("gives half the daily capacity for a half day", () => {
    const m = timeOffMinutesByDay(
      "DAYS",
      span("2026-11-03", "2026-11-03", { halfDay: true }),
      DEFAULT_CAPACITY,
      none,
    );
    expect([...m]).toEqual([["2026-11-03", 240]]);
  });

  it("gives the daily capacity per working day and skips holidays", () => {
    const m = timeOffMinutesByDay(
      "DAYS",
      span("2026-11-02", "2026-11-08"),
      DEFAULT_CAPACITY,
      new Set(["2026-11-04"]),
    );
    expect([...m.keys()]).toEqual(["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06"]);
    expect(m.get("2026-11-02")).toBe(480);
  });

  it("spreads a total of hours over the working days", () => {
    const m = timeOffMinutesByDay(
      "HOURS",
      span("2026-11-02", "2026-11-04", { minutes: 600 }),
      DEFAULT_CAPACITY,
      none,
    );
    expect([...m.values()]).toEqual([200, 200, 200]);
  });

  it("puts the remainder minutes on the first days", () => {
    const m = timeOffMinutesByDay(
      "HOURS",
      span("2026-11-02", "2026-11-04", { minutes: 601 }),
      DEFAULT_CAPACITY,
      none,
    );
    expect([...m.values()]).toEqual([201, 200, 200]);
  });
});

const base: BalanceInput = {
  accrual: "YEARLY",
  allowanceCenti: 1500,
  allowNegative: false,
  year: 2026,
  startedOn: "2025-01-01",
  today: "2026-11-02",
  adjustmentsCenti: 0,
  approvedCenti: 0,
  pendingCenti: 0,
};

describe("policyBalance", () => {
  it("grants a yearly allowance and subtracts approved time", () => {
    const b = policyBalance({ ...base, approvedCenti: 300, pendingCenti: 100 });
    expect(b).toEqual({
      grantedCenti: 1500,
      adjustmentsCenti: 0,
      usedCenti: 300,
      pendingCenti: 100,
      balanceCenti: 1200,
      unlimited: false,
    });
  });

  it("grants monthly from the first of the month after the start", () => {
    const b = policyBalance({
      ...base,
      accrual: "MONTHLY",
      startedOn: "2026-10-15",
      today: "2026-12-02",
    });
    expect(b.grantedCenti).toBe(250);
  });

  it("grants twelve months as the whole allowance", () => {
    const b = policyBalance({
      ...base,
      accrual: "MONTHLY",
      startedOn: "2026-01-01",
      today: "2026-12-01",
    });
    expect(b.grantedCenti).toBe(1500);
  });

  it("rounds a monthly grant half up and sums to the allowance", () => {
    const monthly = { ...base, accrual: "MONTHLY" as const, allowanceCenti: 1000 };
    expect(
      policyBalance({ ...monthly, startedOn: "2026-01-01", today: "2026-01-10" }).grantedCenti,
    ).toBe(83);
    expect(
      policyBalance({ ...monthly, startedOn: "2026-01-01", today: "2026-12-31" }).grantedCenti,
    ).toBe(1000);
  });

  it("grants nothing in a year the person had not started", () => {
    expect(policyBalance({ ...base, startedOn: "2027-02-01" }).grantedCenti).toBe(0);
  });

  it("treats NONE with a negative balance allowed as unlimited", () => {
    expect(policyBalance({ ...base, accrual: "NONE", allowNegative: true }).unlimited).toBe(true);
  });

  it("counts adjustments only for NONE", () => {
    const b = policyBalance({ ...base, accrual: "NONE", adjustmentsCenti: 500 });
    expect(b.grantedCenti).toBe(0);
    expect(b.balanceCenti).toBe(500);
    expect(b.unlimited).toBe(false);
  });
});

describe("wouldGoNegative", () => {
  const b = policyBalance({ ...base, approvedCenti: 1000, pendingCenti: 200 });
  it("allows reaching exactly zero", () => {
    expect(wouldGoNegative(b, 300, false)).toBe(false);
  });
  it("refuses one hundredth below zero", () => {
    expect(wouldGoNegative(b, 301, false)).toBe(true);
  });
  it("allows anything when negative is allowed", () => {
    expect(wouldGoNegative(b, 10_000, true)).toBe(false);
  });
});

describe("formatCenti", () => {
  it("formats days and hours", () => {
    expect(formatCenti(150, "DAYS")).toBe("1.5 days");
    expect(formatCenti(100, "DAYS")).toBe("1 day");
    expect(formatCenti(750, "HOURS")).toBe("7.5 hours");
    expect(formatCenti(125, "DAYS")).toBe("1.25 days");
    expect(formatCenti(-200, "DAYS")).toBe("-2 days");
  });
});

describe("formatTimeOffDates", () => {
  it("names one day once and a range by its ends", () => {
    expect(formatTimeOffDates("2026-03-03", "2026-03-03")).toBe("3 Mar 2026");
    expect(formatTimeOffDates("2026-03-03", "2026-03-05")).toBe("3 – 5 Mar 2026");
  });
});
