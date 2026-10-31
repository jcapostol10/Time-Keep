import { localDateKey, zonedDateTimeToInstant } from "./time";
import type { WeekStartDay } from "./schemas";

/**
 * Approval periods and lock dates (Phase 5a). Periods are the workspace's: in
 * its timezone and week start (design decision 2). An entry belongs to the
 * period that contains its start. Periods are inclusive date keys
 * (`YYYY-MM-DD`); `periodBounds` turns one into half-open instants.
 */

export const APPROVAL_PERIODS = ["WEEKLY", "SEMI_MONTHLY", "MONTHLY"] as const;
export type ApprovalPeriod = (typeof APPROVAL_PERIODS)[number];

/** Who approves; each level includes the previous one (decision 4). */
export const APPROVAL_REVIEWERS = ["ADMINS", "TEAM_MANAGERS", "PROJECT_MANAGERS"] as const;
export type ApprovalReviewers = (typeof APPROVAL_REVIEWERS)[number];

export const LOCK_MODES = ["OFF", "FIXED", "ROLLING"] as const;
export type LockMode = (typeof LOCK_MODES)[number];

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_ACTIONS = [
  "SUBMIT",
  "WITHDRAW",
  "APPROVE",
  "REJECT",
  "REOPEN",
  "ADMIN_EDIT",
  "AUTO_WITHDRAW",
] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export const APPROVAL_PERIOD_LABELS: Record<ApprovalPeriod, string> = {
  WEEKLY: "Weekly",
  SEMI_MONTHLY: "Twice a month (1–15, 16–end)",
  MONTHLY: "Monthly",
};

export const APPROVAL_REVIEWER_LABELS: Record<ApprovalReviewers, string> = {
  ADMINS: "Owners and admins",
  TEAM_MANAGERS: "Also managers, for the people they manage",
  PROJECT_MANAGERS: "Also project managers, for time all on their projects",
};

export interface PeriodRule {
  period: ApprovalPeriod;
  timezone: string;
  weekStart: WeekStartDay;
}

/** Inclusive local dates. */
export interface Period {
  start: string;
  end: string;
}

function keyToUtc(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date key: ${key}`);
  return new Date(Date.UTC(y, m - 1, d));
}

function utcToKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Calendar arithmetic on a date key (no instant, no zone, so no DST). */
export function addDaysToKey(key: string, days: number): string {
  const d = keyToUtc(key);
  d.setUTCDate(d.getUTCDate() + days);
  return utcToKey(d);
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function periodContaining(dateKey: string, rule: PeriodRule): Period {
  const d = keyToUtc(dateKey);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const monthKey = (dd: number) => utcToKey(new Date(Date.UTC(year, month, dd)));
  switch (rule.period) {
    case "WEEKLY": {
      const back = (d.getUTCDay() - rule.weekStart + 7) % 7;
      const start = addDaysToKey(dateKey, -back);
      return { start, end: addDaysToKey(start, 6) };
    }
    case "SEMI_MONTHLY":
      return day <= 15
        ? { start: monthKey(1), end: monthKey(15) }
        : { start: monthKey(16), end: monthKey(lastDayOfMonth(year, month)) };
    case "MONTHLY":
      return { start: monthKey(1), end: monthKey(lastDayOfMonth(year, month)) };
  }
}

export function periodOf(instant: Date, rule: PeriodRule): Period {
  return periodContaining(localDateKey(instant, rule.timezone), rule);
}

export function nextPeriod(p: Period, rule: PeriodRule): Period {
  return periodContaining(addDaysToKey(p.end, 1), rule);
}

export function previousPeriod(p: Period, rule: PeriodRule): Period {
  return periodContaining(addDaysToKey(p.start, -1), rule);
}

/** `[from, to)`: local midnight of the first day to local midnight after the last. */
export function periodBounds(p: Period, timezone: string): { from: Date; to: Date } {
  return {
    from: zonedDateTimeToInstant({ date: p.start, hours: 0, minutes: 0 }, timezone),
    to: zonedDateTimeToInstant({ date: addDaysToKey(p.end, 1), hours: 0, minutes: 0 }, timezone),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "27 Oct – 2 Nov 2026", "1 – 15 Nov 2026", "28 Dec 2026 – 3 Jan 2027". */
export function formatPeriod(p: Period): string {
  const a = keyToUtc(p.start);
  const b = keyToUtc(p.end);
  const day = (d: Date) => d.getUTCDate();
  const mon = (d: Date) => MONTHS[d.getUTCMonth()]!;
  if (a.getUTCFullYear() !== b.getUTCFullYear()) {
    return `${day(a)} ${mon(a)} ${a.getUTCFullYear()} – ${day(b)} ${mon(b)} ${b.getUTCFullYear()}`;
  }
  if (a.getUTCMonth() !== b.getUTCMonth()) {
    return `${day(a)} ${mon(a)} – ${day(b)} ${mon(b)} ${b.getUTCFullYear()}`;
  }
  return `${day(a)} – ${day(b)} ${mon(b)} ${b.getUTCFullYear()}`;
}

/** "20 Oct 2026", for the lock message. */
export function formatDateKey(key: string): string {
  const d = keyToUtc(key);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!} ${d.getUTCFullYear()}`;
}

export interface LockRule {
  mode: LockMode;
  /** FIXED: entries before this local date are locked */
  date: string | null;
  /** ROLLING: entries before the local day this many days ago are locked */
  days: number | null;
  timezone: string;
}

/** The first local date that is not locked, or null when nothing is. */
export function lockDateKey(rule: LockRule, now: Date): string | null {
  if (rule.mode === "FIXED" && rule.date) return rule.date;
  if (rule.mode === "ROLLING" && rule.days !== null && rule.days >= 0) {
    return addDaysToKey(localDateKey(now, rule.timezone), -rule.days);
  }
  return null;
}

/** Entries starting before this instant are locked (decision 6); null when nothing is. */
export function lockBoundary(rule: LockRule, now: Date): Date | null {
  const key = lockDateKey(rule, now);
  return key ? zonedDateTimeToInstant({ date: key, hours: 0, minutes: 0 }, rule.timezone) : null;
}

type Move = "SUBMIT" | "WITHDRAW" | "APPROVE" | "REJECT" | "REOPEN";

const MOVES: Record<string, ApprovalStatus | "DELETED"> = {
  "null:SUBMIT": "PENDING",
  "REJECTED:SUBMIT": "PENDING",
  "PENDING:WITHDRAW": "DELETED",
  "PENDING:APPROVE": "APPROVED",
  "PENDING:REJECT": "REJECTED",
  // Decision 3: reopening sends an approved period back for correction.
  "APPROVED:REOPEN": "REJECTED",
};

/** The request's next status; throws for a move the state machine does not allow. */
export function transition(
  status: ApprovalStatus | null,
  action: Move,
): ApprovalStatus | "DELETED" {
  const next = MOVES[`${status}:${action}`];
  if (!next) throw new Error("Not allowed");
  return next;
}
