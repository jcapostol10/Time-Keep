import { describe, expect, it } from "vitest";

import {
  BUDGET_THRESHOLDS_DEFAULT,
  crossedThresholds,
  cumulative,
  type Estimate,
  estimatePeriod,
  NO_ESTIMATE,
  normalizeThresholds,
  progressVisible,
  projectProgress,
} from "./estimates";
import { type Actor, DEFAULT_PERMISSION_SETTINGS, type PermissionSettings } from "./permissions";
import type { Role } from "./roles";
import { budgetThresholdsOf } from "./workspace-rules";

const ME = "me";
const PROJECT = "p1";

function actor(
  role: Role,
  opts: { manages?: boolean; settings?: Partial<PermissionSettings> } = {},
): Actor {
  return {
    userId: ME,
    role,
    managedUserIds: new Set(),
    managedProjectIds: new Set(opts.manages ? [PROJECT] : []),
    groupIds: new Set(),
    settings: { ...DEFAULT_PERMISSION_SETTINGS, ...opts.settings },
  };
}

const project = { id: PROJECT, visibility: "PUBLIC" as const, isMember: false };
const ALL = { key: "all", from: null, to: null, label: null };
const time = (seconds: number): Estimate => ({
  kind: "TIME",
  seconds,
  minor: null,
  reset: "NONE",
  alerts: true,
});

describe("estimatePeriod", () => {
  it("a monthly period follows the workspace timezone", () => {
    // 00:30 on Dec 1 in Manila, still Nov 30 in UTC.
    const now = new Date("2026-11-30T16:30:00Z");
    const manila = estimatePeriod("MONTHLY", now, "Asia/Manila");
    expect(manila.key).toBe("2026-12");
    expect(manila.from?.toISOString()).toBe("2026-11-30T16:00:00.000Z");
    expect(manila.to?.toISOString()).toBe("2026-12-31T16:00:00.000Z");
    expect(manila.label).toBe("December 2026");
    const utc = estimatePeriod("MONTHLY", now, "UTC");
    expect(utc.key).toBe("2026-11");
    expect(utc.label).toBe("November 2026");
  });

  it("a whole-project period has no bounds", () => {
    expect(estimatePeriod("NONE", new Date("2026-11-08T10:00:00Z"), "Asia/Manila")).toEqual(ALL);
  });
});

describe("projectProgress", () => {
  it("time progress floors the percent and can pass 100", () => {
    const measured = (seconds: number) => ({ seconds, amountMinor: 0 });
    expect(projectProgress(time(36_000), measured(36_000), ALL, "USD")?.percent).toBe(100);
    expect(projectProgress(time(7_200), measured(7_199), ALL, "USD")?.percent).toBe(99);
    const over = projectProgress(time(7_200), measured(10_800), ALL, "USD");
    expect(over).toMatchObject({ kind: "TIME", used: 10_800, estimate: 7_200, percent: 150 });
    expect(over?.currency).toBeNull();
    expect(over?.period).toEqual(ALL);
  });

  it("money progress carries the project currency", () => {
    const money: Estimate = {
      kind: "MONEY",
      seconds: null,
      minor: 20_000,
      reset: "NONE",
      alerts: true,
    };
    expect(projectProgress(money, { seconds: 99, amountMinor: 5_000 }, ALL, "EUR")).toMatchObject({
      kind: "MONEY",
      used: 5_000,
      estimate: 20_000,
      percent: 25,
      currency: "EUR",
    });
  });

  it("no progress without an estimate", () => {
    expect(projectProgress(NO_ESTIMATE, { seconds: 10, amountMinor: 10 }, ALL, "USD")).toBeNull();
    const blank: Estimate = {
      kind: "MONEY",
      seconds: null,
      minor: null,
      reset: "NONE",
      alerts: true,
    };
    expect(projectProgress(blank, { seconds: 10, amountMinor: 10 }, ALL, "USD")).toBeNull();
  });
});

describe("crossedThresholds", () => {
  it("uses integer maths", () => {
    expect(crossedThresholds(3_600, 7_200, [50, 80, 100])).toEqual([50]);
    expect(crossedThresholds(7_200, 7_200, [50, 80, 100])).toEqual([50, 80, 100]);
    // 79.98%: not yet 80.
    expect(crossedThresholds(5_759, 7_200, [50, 80, 100])).toEqual([50]);
    expect(crossedThresholds(5_760, 7_200, [50, 80, 100])).toEqual([50, 80]);
    expect(crossedThresholds(100, 0, [50])).toEqual([]);
  });
});

describe("progressVisible", () => {
  it("owners, admins and the project's managers see both kinds", () => {
    for (const a of [actor("owner"), actor("admin"), actor("manager", { manages: true })]) {
      expect(progressVisible(a, project, "TIME")).toBe(true);
      expect(progressVisible(a, project, "MONEY")).toBe(true);
    }
  });

  it("others see time only when the team's time is shown, and never money", () => {
    for (const role of ["manager", "member"] as const) {
      expect(progressVisible(actor(role), project, "TIME")).toBe(false);
      expect(progressVisible(actor(role), project, "MONEY")).toBe(false);
      const open = actor(role, { settings: { membersSeeTeamTime: true } });
      expect(progressVisible(open, project, "TIME")).toBe(true);
      expect(progressVisible(open, project, "MONEY")).toBe(false);
    }
  });
});

describe("thresholds", () => {
  it("normalizeThresholds keeps whole percents from 1 to 200, sorted, at most five", () => {
    expect(normalizeThresholds([80, 50, 50, 250, 0, 7.5])).toEqual([50, 80]);
    expect(normalizeThresholds([60, 10, 20, 30, 40, 50])).toEqual([10, 20, 30, 40, 50]);
    expect(normalizeThresholds([])).toEqual([]);
    expect(BUDGET_THRESHOLDS_DEFAULT).toEqual([50, 80, 100]);
  });

  it("budgetThresholdsOf reads the column, defaulting when it is absent", () => {
    expect(budgetThresholdsOf({})).toEqual([50, 80, 100]);
    expect(budgetThresholdsOf({ budgetThresholds: [] })).toEqual([]);
    expect(budgetThresholdsOf({ budgetThresholds: [300, 10] })).toEqual([10]);
  });
});

describe("cumulative", () => {
  it("runs the sum in order", () => {
    expect(
      cumulative([
        { key: "a", value: 1 },
        { key: "b", value: 2 },
        { key: "c", value: 3 },
      ]),
    ).toEqual([
      { key: "a", value: 1 },
      { key: "b", value: 3 },
      { key: "c", value: 6 },
    ]);
  });
});
