import type { RateLevel } from "@timekeep/core";

/** One rate row as the rate dialog's history shows it. */
export interface RateDTO {
  id: string;
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
  level: RateLevel;
  userId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
}
