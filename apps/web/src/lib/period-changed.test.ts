import { describe, expect, it } from "vitest";

import { periodChanged } from "./period-changed";

const totals = { workSeconds: 3600, expenseCount: 2, expenseMinor: 5000 };

describe("periodChanged", () => {
  it("is false while the period reads as it was submitted", () => {
    expect(periodChanged(totals, { ...totals })).toBe(false);
  });

  it("notices a change of time", () => {
    expect(periodChanged({ ...totals, workSeconds: 7200 }, totals)).toBe(true);
  });

  it("notices an expense added, removed or re-priced, with the time untouched", () => {
    expect(periodChanged({ ...totals, expenseCount: 3 }, totals)).toBe(true);
    expect(periodChanged({ ...totals, expenseMinor: 4000 }, totals)).toBe(true);
  });
});
