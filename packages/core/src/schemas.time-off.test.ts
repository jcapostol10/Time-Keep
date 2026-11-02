import { describe, expect, it } from "vitest";

import {
  adjustmentSchema,
  capacityFromInput,
  capacitySchema,
  holidayImportSchema,
  holidaySchema,
  reviewTimeOffSchema,
  targetRuleSchema,
  timeOffPolicySchema,
  timeOffRequestSchema,
} from "./schemas";
import { parseCenti } from "./time-off";

describe("parseCenti", () => {
  it("reads amounts with at most two decimals", () => {
    expect(parseCenti("1.5")).toBe(150);
    expect(parseCenti("15")).toBe(1500);
    expect(parseCenti("0.25")).toBe(25);
    expect(parseCenti("1.555")).toBeNull();
    expect(parseCenti("abc")).toBeNull();
    expect(parseCenti("")).toBeNull();
  });
  it("reads a signed amount", () => {
    expect(parseCenti("-2")).toBe(-200);
  });
});

describe("timeOffPolicySchema", () => {
  const policy = {
    name: "Vacation",
    unit: "DAYS",
    accrual: "YEARLY",
    allowance: "15",
    allowNegative: false,
    requiresApproval: true,
    everyone: true,
    userIds: [],
    groupIds: [],
  };
  it("accepts a yearly policy", () => {
    expect(timeOffPolicySchema.safeParse(policy).success).toBe(true);
  });
  it("needs an allowance unless the policy grants nothing", () => {
    expect(timeOffPolicySchema.safeParse({ ...policy, allowance: "" }).success).toBe(false);
    expect(timeOffPolicySchema.safeParse({ ...policy, allowance: "-1" }).success).toBe(false);
    expect(
      timeOffPolicySchema.safeParse({ ...policy, accrual: "NONE", allowance: "" }).success,
    ).toBe(true);
  });
});

describe("timeOffRequestSchema", () => {
  it("accepts a day and reads hours as a duration", () => {
    const r = timeOffRequestSchema.safeParse({
      policyId: "p1",
      start: "2026-11-03",
      end: "2026-11-03",
      hours: "1.5",
    });
    expect(r.success && r.data.halfDay).toBe(false);
    expect(
      timeOffRequestSchema.safeParse({ policyId: "p1", start: "2026-11-03", end: "x" }).success,
    ).toBe(false);
    expect(
      timeOffRequestSchema.safeParse({
        policyId: "p1",
        start: "2026-11-03",
        end: "2026-11-03",
        hours: "lots",
      }).success,
    ).toBe(false);
  });
});

describe("reviewTimeOffSchema", () => {
  it("needs a note to reject", () => {
    expect(reviewTimeOffSchema.safeParse({ ids: ["a"], decision: "REJECT" }).success).toBe(false);
    expect(
      reviewTimeOffSchema.safeParse({ ids: ["a"], decision: "REJECT", note: "Busy week" }).success,
    ).toBe(true);
    expect(reviewTimeOffSchema.safeParse({ ids: ["a"], decision: "APPROVE" }).success).toBe(true);
  });
});

describe("adjustmentSchema", () => {
  it("takes a signed, non-zero amount and a note", () => {
    const base = { policyId: "p", userId: "u", amount: "-2", note: "Carried over" };
    expect(adjustmentSchema.safeParse(base).success).toBe(true);
    expect(adjustmentSchema.safeParse({ ...base, amount: "0" }).success).toBe(false);
    expect(adjustmentSchema.safeParse({ ...base, note: "" }).success).toBe(false);
  });
});

describe("holiday schemas", () => {
  it("accepts a holiday and an import", () => {
    expect(
      holidaySchema.safeParse({ date: "2027-12-30", name: "Rizal Day", repeatsYearly: true })
        .success,
    ).toBe(true);
    expect(
      holidayImportSchema.safeParse({
        country: "PH",
        region: null,
        year: 2027,
        rows: [{ date: "2027-12-30", name: "Rizal Day", estimated: false }],
      }).success,
    ).toBe(true);
    expect(
      holidayImportSchema.safeParse({ country: "PHL", region: null, year: 2027, rows: [] }).success,
    ).toBe(false);
  });
});

describe("capacitySchema", () => {
  const capacity = { dailyHours: "8", weeklyHours: "40", workingDays: [1, 2, 3, 4, 5] };
  it("reads hours as minutes", () => {
    const parsed = capacitySchema.parse(capacity);
    expect(capacityFromInput(parsed)).toEqual({
      dailyMinutes: 480,
      weeklyMinutes: 2400,
      workingDays: [1, 2, 3, 4, 5],
    });
  });
  it("refuses more than a day's hours", () => {
    expect(capacitySchema.safeParse({ ...capacity, dailyHours: "25" }).success).toBe(false);
    expect(capacitySchema.safeParse({ ...capacity, weeklyHours: "169" }).success).toBe(false);
    expect(capacitySchema.safeParse({ ...capacity, workingDays: [1, 1] }).success).toBe(false);
  });
});

describe("targetRuleSchema", () => {
  it("needs a positive threshold", () => {
    const rule = {
      kind: "UNDER",
      period: "DAY",
      threshold: "8",
      active: true,
      everyone: true,
      userIds: [],
      groupIds: [],
    };
    expect(targetRuleSchema.safeParse(rule).success).toBe(true);
    expect(targetRuleSchema.safeParse({ ...rule, threshold: "0" }).success).toBe(false);
  });
});
