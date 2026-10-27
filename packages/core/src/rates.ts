import { startOfDayInZone, zonedDateTimeToInstant } from "./time";

/**
 * Billable (and, from Phase 6, cost) rates: a hierarchy of levels, each with
 * a history of rows by effective date. The most specific level with a rate in
 * force at an entry's start wins.
 */

export const RATE_KINDS = ["billable", "cost"] as const;
export type RateKind = (typeof RATE_KINDS)[number];

/** Most specific first: the order resolution tries them in. */
export const RATE_LEVELS = ["task", "project_member", "project", "member", "workspace"] as const;
export type RateLevel = (typeof RATE_LEVELS)[number];

export const RATE_RECALC_STATUSES = ["queued", "running", "done", "failed"] as const;
export type RateRecalcStatus = (typeof RATE_RECALC_STATUSES)[number];

export interface RateRow {
  level: RateLevel;
  userId: string | null;
  projectId: string | null;
  taskId: string | null;
  /** Minor units per hour; null = no rate at this level from this date. */
  amountMinor: number | null;
  currency: string;
  effectiveFrom: Date;
}

/** What an entry is rated by: who, on what, and when it started. */
export interface RateTarget {
  userId: string;
  projectId: string | null;
  taskId: string | null;
  start: Date;
}

export interface ResolvedRate {
  amountMinor: number;
  currency: string;
  level: RateLevel;
}

function matches(row: RateRow, t: RateTarget): boolean {
  switch (row.level) {
    case "task":
      return row.taskId !== null && row.taskId === t.taskId && row.projectId === t.projectId;
    case "project_member":
      return row.projectId !== null && row.projectId === t.projectId && row.userId === t.userId;
    case "project":
      return row.projectId !== null && row.projectId === t.projectId;
    case "member":
      return row.userId === t.userId;
    case "workspace":
      return true;
  }
}

/**
 * The rate for an entry: at each level, most specific first, the latest
 * matching row in force at the entry's start; a null row falls through.
 * The SQL twin is packages/db/src/rates-sql.ts (tested to agree).
 */
export function resolveRate(rates: readonly RateRow[], target: RateTarget): ResolvedRate | null {
  for (const level of RATE_LEVELS) {
    let latest: RateRow | null = null;
    for (const row of rates) {
      if (row.level !== level || row.effectiveFrom > target.start || !matches(row, target))
        continue;
      if (!latest || row.effectiveFrom > latest.effectiveFrom) latest = row;
    }
    if (latest && latest.amountMinor !== null) {
      return { amountMinor: latest.amountMinor, currency: latest.currency, level };
    }
  }
  return null;
}

/** The fields of an entry that decide its rate. */
export interface RateInputs {
  userId: string;
  projectId: string | null;
  taskId: string | null;
  billable: boolean;
}

/**
 * Whether an edit re-rates the entry (decision 3 of the Phase 4 design): a
 * new person, project or task, or billable switched on. Anything else keeps
 * the rate the entry was saved with and only recomputes its amount.
 */
export function needsRerate(before: RateInputs, after: RateInputs): boolean {
  return (
    before.userId !== after.userId ||
    before.projectId !== after.projectId ||
    before.taskId !== after.taskId ||
    (!before.billable && after.billable)
  );
}

/** "New entries only", "Entries from a date", "All entries, past and future". */
export const RATE_APPLY = ["new", "from", "all"] as const;
export type RateApply = (typeof RATE_APPLY)[number];

/** Where a new rate row starts for each choice, in the workspace's timezone. */
export function rateEffectiveFrom(
  apply: RateApply,
  options: { date?: string; timezone: string; now: Date },
): Date {
  if (apply === "all") return new Date(0);
  if (apply === "new") return startOfDayInZone(options.now, options.timezone);
  if (!options.date) throw new Error("rateEffectiveFrom: a date is required for 'from'");
  return zonedDateTimeToInstant({ date: options.date, hours: 0, minutes: 0 }, options.timezone);
}
