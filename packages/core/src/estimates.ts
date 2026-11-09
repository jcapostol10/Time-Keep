import type { ProjectVisibility } from "./catalog";
import { type Actor, can } from "./permissions";
import { localDateKey, monthBoundsInZone } from "./time";

/**
 * Estimates, budgets and alerts (Phase 6 design, decisions 10–13). A project
 * has one estimate: none, by time (all work on it, billable or not) or by
 * money (its billable amount in the project's currency), for the whole
 * project or reset every calendar month in the workspace timezone. Progress
 * is computed from raw time, never stored, never rounded.
 */

export const ESTIMATE_KINDS = ["NONE", "TIME", "MONEY"] as const;
export type EstimateKind = (typeof ESTIMATE_KINDS)[number];

export const ESTIMATE_RESETS = ["NONE", "MONTHLY"] as const;
export type EstimateReset = (typeof ESTIMATE_RESETS)[number];

export interface Estimate {
  kind: EstimateKind;
  /** TIME: the estimate in seconds. */
  seconds: number | null;
  /** MONEY: the estimate in minor units of the project's currency. */
  minor: number | null;
  reset: EstimateReset;
  /** Whether the daily job emails the thresholds crossed. */
  alerts: boolean;
}

export const NO_ESTIMATE: Estimate = {
  kind: "NONE",
  seconds: null,
  minor: null,
  reset: "NONE",
  alerts: true,
};

/** The stretch of time an estimate measures now: the whole project, or the current local month. */
export interface EstimatePeriod {
  /** `all`, or `YYYY-MM` of the workspace's local month. */
  key: string;
  from: Date | null;
  to: Date | null;
  /** "November 2026" for a month; null for the whole project. */
  label: string | null;
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function estimatePeriod(reset: EstimateReset, now: Date, tz: string): EstimatePeriod {
  if (reset === "NONE") return { key: "all", from: null, to: null, label: null };
  const { monthStart, monthEnd } = monthBoundsInZone(now, tz);
  const key = localDateKey(monthStart, tz).slice(0, 7);
  const [y, m] = key.split("-").map(Number) as [number, number];
  return {
    key,
    from: monthStart,
    to: monthEnd,
    label: MONTH_LABEL.format(new Date(Date.UTC(y, m - 1, 1))),
  };
}

export interface Progress {
  kind: "TIME" | "MONEY";
  /** Seconds, or minor units of `currency`. */
  used: number;
  estimate: number;
  /** Whole percent, floored; past 100 when over the estimate. */
  percent: number;
  /** The project's currency for a money estimate; null for time. */
  currency: string | null;
  period: EstimatePeriod;
}

/** The estimate's progress from what was measured in its period, or null without an estimate. */
export function projectProgress(
  estimate: Estimate,
  measured: { seconds: number; amountMinor: number },
  period: EstimatePeriod,
  currency: string,
): Progress | null {
  if (estimate.kind === "TIME" && estimate.seconds !== null && estimate.seconds > 0) {
    return {
      kind: "TIME",
      used: measured.seconds,
      estimate: estimate.seconds,
      percent: percentOf(measured.seconds, estimate.seconds),
      currency: null,
      period,
    };
  }
  if (estimate.kind === "MONEY" && estimate.minor !== null && estimate.minor > 0) {
    return {
      kind: "MONEY",
      used: measured.amountMinor,
      estimate: estimate.minor,
      percent: percentOf(measured.amountMinor, estimate.minor),
      currency,
      period,
    };
  }
  return null;
}

function percentOf(used: number, estimate: number): number {
  return Math.floor((used * 100) / estimate);
}

/** The thresholds (whole percents) the usage has reached: `used * 100 >= t * estimate`. */
export function crossedThresholds(
  used: number,
  estimate: number,
  thresholds: readonly number[],
): number[] {
  if (estimate <= 0) return [];
  return thresholds.filter((t) => used * 100 >= t * estimate);
}

/**
 * Who sees a project's progress (decision 11): anyone who may edit the
 * project (owners, admins, its managers) sees both kinds; everyone else a
 * time bar only when the workspace shows members the team's time, and a
 * money bar never (it is the project's whole amount).
 */
export function progressVisible(
  actor: Actor,
  project: { id: string; visibility: ProjectVisibility; isMember: boolean },
  kind: "TIME" | "MONEY",
): boolean {
  if (
    can(actor, "project.update", {
      kind: "project",
      projectId: project.id,
      visibility: project.visibility,
      isMember: project.isMember,
    })
  ) {
    return true;
  }
  return kind === "TIME" && actor.settings.membersSeeTeamTime;
}

/** Points with their running sum, in the order given. */
export function cumulative(
  points: readonly { key: string; value: number }[],
): { key: string; value: number }[] {
  let sum = 0;
  return points.map((p) => {
    sum += p.value;
    return { key: p.key, value: sum };
  });
}

export const BUDGET_THRESHOLDS_DEFAULT: readonly number[] = [50, 80, 100];
export const BUDGET_THRESHOLD_MAX = 200;
export const BUDGET_THRESHOLDS_LIMIT = 5;

/** Whole percents from 1 to 200, deduplicated, ascending, at most five. */
export function normalizeThresholds(values: readonly number[]): number[] {
  const kept = new Set(
    values.filter((v) => Number.isInteger(v) && v >= 1 && v <= BUDGET_THRESHOLD_MAX),
  );
  return [...kept].sort((a, b) => a - b).slice(0, BUDGET_THRESHOLDS_LIMIT);
}
