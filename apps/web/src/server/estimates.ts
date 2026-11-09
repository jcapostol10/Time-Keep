import "server-only";

import {
  type Estimate,
  type EstimatePeriod,
  estimatePeriod,
  type Progress,
  projectProgress,
} from "@timekeep/core";
import {
  and,
  type DbExecutor,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
  timeEntry,
} from "@timekeep/db";
import type { SQL } from "drizzle-orm";

/**
 * Estimates, budgets and alerts (Phase 6b). `progressFor` is the one
 * aggregate behind every bar: raw, stopped work entries of the estimate's
 * period, all of them (visibility is the caller's `progressVisible`), never
 * rounded. A time estimate measures every work entry on the project; a
 * money one the billable amounts rated in the project's currency.
 */

type EstimateRow = {
  estimateKind: Estimate["kind"];
  estimateSeconds: number | null;
  estimateMinor: number | null;
  estimateReset: Estimate["reset"];
  estimateAlerts: boolean;
};

export function estimateOf(row: EstimateRow): Estimate {
  return {
    kind: row.estimateKind,
    seconds: row.estimateSeconds,
    minor: row.estimateMinor,
    reset: row.estimateReset,
    alerts: row.estimateAlerts,
  };
}

export interface EstimatedProject {
  id: string;
  estimate: Estimate;
  /** The project's currency (its client's, else the workspace's). */
  currency: string;
}

interface Measured {
  seconds: number;
  amountMinor: number;
}

/** Summed over the projects' stopped work entries in `[from, to)` (no bounds when null). */
async function measure(
  db: Pick<DbExecutor, "select">,
  workspaceId: string,
  projects: EstimatedProject[],
  bounds: { from: Date; to: Date } | null,
): Promise<Map<string, Measured>> {
  if (projects.length === 0) return new Map();
  // Each project's amounts count only in its own currency: no conversion, ever.
  const currencyOf: SQL = sql`case ${timeEntry.projectId} ${sql.join(
    projects.map((p) => sql`when ${p.id} then ${p.currency}`),
    sql` `,
  )} end`;
  const rows = await db
    .select({
      projectId: timeEntry.projectId,
      seconds: sql<number>`coalesce(sum(${timeEntry.durationSeconds}), 0)::bigint`.mapWith(Number),
      amountMinor:
        sql<number>`coalesce(sum(case when ${timeEntry.billable} and ${timeEntry.rateCurrency} = ${currencyOf} then ${timeEntry.amountMinor} else 0 end), 0)::bigint`.mapWith(
          Number,
        ),
    })
    .from(timeEntry)
    .where(
      and(
        eq(timeEntry.workspaceId, workspaceId),
        inArray(
          timeEntry.projectId,
          projects.map((p) => p.id),
        ),
        isNull(timeEntry.deletedAt),
        isNotNull(timeEntry.end),
        eq(timeEntry.type, "work"),
        bounds ? gte(timeEntry.start, bounds.from) : undefined,
        bounds ? lt(timeEntry.start, bounds.to) : undefined,
      ),
    )
    .groupBy(timeEntry.projectId);
  return new Map(
    rows.flatMap((r) =>
      r.projectId ? [[r.projectId, { seconds: r.seconds, amountMinor: r.amountMinor }]] : [],
    ),
  );
}

/**
 * The progress of every listed project that has an estimate, keyed by id:
 * one query for whole-project estimates and one for monthly ones (bounded
 * by the workspace's current local month).
 */
export async function progressFor(
  db: Pick<DbExecutor, "select">,
  workspaceId: string,
  projects: EstimatedProject[],
  now: Date,
  tz: string,
): Promise<Map<string, Progress>> {
  const estimated = projects.filter((p) => p.estimate.kind !== "NONE");
  const whole = estimated.filter((p) => p.estimate.reset === "NONE");
  const monthly = estimated.filter((p) => p.estimate.reset === "MONTHLY");
  const periods: Record<Estimate["reset"], EstimatePeriod> = {
    NONE: estimatePeriod("NONE", now, tz),
    MONTHLY: estimatePeriod("MONTHLY", now, tz),
  };
  const month = periods.MONTHLY;
  const [wholeMeasured, monthlyMeasured] = await Promise.all([
    measure(db, workspaceId, whole, null),
    measure(db, workspaceId, monthly, { from: month.from!, to: month.to! }),
  ]);
  const result = new Map<string, Progress>();
  for (const p of estimated) {
    const measured =
      (p.estimate.reset === "MONTHLY" ? monthlyMeasured : wholeMeasured).get(p.id) ??
      ({ seconds: 0, amountMinor: 0 } satisfies Measured);
    const progress = projectProgress(p.estimate, measured, periods[p.estimate.reset], p.currency);
    if (progress) result.set(p.id, progress);
  }
  return result;
}
