import type { RateKind, RateLevel } from "@timekeep/core";

/** One rate row as the rate dialog's history shows it. */
export interface RateDTO {
  id: string;
  /** Billable (what the client is charged) or cost (what the hour costs the company). */
  kind: RateKind;
  level: RateLevel;
  /** Minor units per hour; null = no rate at this level from this date. */
  amountMinor: number | null;
  currency: string;
  effectiveFrom: string;
  createdByName: string | null;
  createdAt: string;
}

/** The workspace's latest "apply to past entries" job, for the progress banner. */
export interface RateRecalcDTO {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  from: string;
  total: number | null;
  processed: number;
  error: string | null;
}

/** Which rate a dialog edits. */
export interface RateTarget {
  /** Billable when left out. */
  kind?: RateKind;
  level: RateLevel;
  userId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
}
