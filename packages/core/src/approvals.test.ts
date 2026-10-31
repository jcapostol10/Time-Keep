import { describe, expect, it } from "vitest";

import {
  APPROVAL_STATUSES,
  formatPeriod,
  lockBoundary,
  nextPeriod,
  periodBounds,
  periodContaining,
  periodOf,
  previousPeriod,
  transition,
  type PeriodRule,
} from "./approvals";

const MANILA_WEEKLY: PeriodRule = { period: "WEEKLY", timezone: "Asia/Manila", weekStart: 1 };
const NY_WEEKLY: PeriodRule = { period: "WEEKLY", timezone: "America/New_York", weekStart: 1 };

describe("periodOf", () => {
  it("puts an entry in the week of its local start", () => {
    // Sunday 25 Oct 23:30 and Monday 26 Oct 00:10 in Manila.
    expect(periodOf(new Date("2026-10-25T15:30:00Z"), MANILA_WEEKLY)).toEqual({
      start: "2026-10-19",
      end: "2026-10-25",
    });
    expect(periodOf(new Date("2026-10-25T16:10:00Z"), MANILA_WEEKLY)).toEqual({
      start: "2026-10-26",
      end: "2026-11-01",
    });
  });

  it("uses the workspace zone, not UTC", () => {
    // 03:00Z Monday is still Sunday evening in New York.
    expect(periodOf(new Date("2026-10-26T03:00:00Z"), NY_WEEKLY)).toEqual({
      start: "2026-10-19",
      end: "2026-10-25",
    });
  });

  it("honours a Sunday week start", () => {
    const rule: PeriodRule = { ...MANILA_WEEKLY, weekStart: 0 };
    expect(periodContaining("2026-10-25", rule)).toEqual({
      start: "2026-10-25",
      end: "2026-10-31",
    });
    expect(periodContaining("2026-10-31", rule)).toEqual({
      start: "2026-10-25",
      end: "2026-10-31",
    });
  });
});

describe("periodContaining", () => {
  const semi: PeriodRule = { ...MANILA_WEEKLY, period: "SEMI_MONTHLY" };
  const monthly: PeriodRule = { ...MANILA_WEEKLY, period: "MONTHLY" };

  it.each([
    ["2027-02-15", semi, "2027-02-01", "2027-02-15"],
    ["2027-02-16", semi, "2027-02-16", "2027-02-28"],
    ["2028-02-16", semi, "2028-02-16", "2028-02-29"],
    ["2026-12-31", semi, "2026-12-16", "2026-12-31"],
    ["2027-01-31", monthly, "2027-01-01", "2027-01-31"],
    ["2027-02-01", monthly, "2027-02-01", "2027-02-28"],
  ])("%s → %s … %s", (key, rule, start, end) => {
    expect(periodContaining(key, rule)).toEqual({ start, end });
  });
});

describe("nextPeriod / previousPeriod", () => {
  it.each([
    MANILA_WEEKLY,
    { ...MANILA_WEEKLY, period: "SEMI_MONTHLY" as const },
    { ...MANILA_WEEKLY, period: "MONTHLY" as const },
  ])("walk a year without gaps ($period)", (rule) => {
    let p = periodContaining("2026-01-01", rule);
    for (let i = 0; i < 60; i++) {
      const next = nextPeriod(p, rule);
      expect(previousPeriod(next, rule)).toEqual(p);
      expect(next.start > p.end).toBe(true);
      p = next;
    }
  });
});

describe("periodBounds", () => {
  it("is half-open local midnights", () => {
    const { from, to } = periodBounds({ start: "2026-10-19", end: "2026-10-25" }, "Asia/Manila");
    expect(from.toISOString()).toBe("2026-10-18T16:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-25T16:00:00.000Z");
  });

  it("gains the hour of a DST end", () => {
    const { from, to } = periodBounds(
      { start: "2026-10-26", end: "2026-11-01" },
      "America/New_York",
    );
    expect((to.getTime() - from.getTime()) / 3_600_000).toBe(7 * 24 + 1);
    const plain = periodBounds({ start: "2026-10-12", end: "2026-10-18" }, "America/New_York");
    expect((plain.to.getTime() - plain.from.getTime()) / 3_600_000).toBe(7 * 24);
  });
});

describe("formatPeriod", () => {
  it.each([
    [{ start: "2026-10-27", end: "2026-11-02" }, "27 Oct – 2 Nov 2026"],
    [{ start: "2026-11-01", end: "2026-11-15" }, "1 – 15 Nov 2026"],
    [{ start: "2026-12-28", end: "2027-01-03" }, "28 Dec 2026 – 3 Jan 2027"],
  ])("%o → %s", (p, text) => {
    expect(formatPeriod(p)).toBe(text);
  });
});

describe("lockBoundary", () => {
  const now = new Date("2026-10-31T01:00:00Z"); // 31 Oct 09:00 in Manila

  it("locks before a fixed local date", () => {
    expect(
      lockBoundary(
        { mode: "FIXED", date: "2026-10-20", days: null, timezone: "Asia/Manila" },
        now,
      )?.toISOString(),
    ).toBe("2026-10-19T16:00:00.000Z");
  });

  it("locks days older than N, from local midnight", () => {
    expect(
      lockBoundary(
        { mode: "ROLLING", date: null, days: 7, timezone: "Asia/Manila" },
        now,
      )?.toISOString(),
    ).toBe("2026-10-23T16:00:00.000Z");
  });

  it("is off when off or incomplete", () => {
    expect(
      lockBoundary({ mode: "OFF", date: "2026-10-20", days: 7, timezone: "UTC" }, now),
    ).toBeNull();
    expect(
      lockBoundary({ mode: "ROLLING", date: null, days: null, timezone: "UTC" }, now),
    ).toBeNull();
    expect(
      lockBoundary({ mode: "FIXED", date: null, days: null, timezone: "UTC" }, now),
    ).toBeNull();
  });
});

describe("transition", () => {
  const ALLOWED: Record<string, string> = {
    "null:SUBMIT": "PENDING",
    "REJECTED:SUBMIT": "PENDING",
    "PENDING:WITHDRAW": "DELETED",
    "PENDING:APPROVE": "APPROVED",
    "PENDING:REJECT": "REJECTED",
    "APPROVED:REOPEN": "REJECTED",
  };
  const statuses = [null, ...APPROVAL_STATUSES];
  const actions = ["SUBMIT", "WITHDRAW", "APPROVE", "REJECT", "REOPEN"] as const;

  for (const status of statuses) {
    for (const action of actions) {
      const key = `${status}:${action}`;
      it(key, () => {
        const expected = ALLOWED[key];
        if (expected) expect(transition(status, action)).toBe(expected);
        else expect(() => transition(status, action)).toThrow("Not allowed");
      });
    }
  }
});
