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
