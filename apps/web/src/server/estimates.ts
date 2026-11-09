import "server-only";

import {
  entryCurrency,
  type Estimate,
  type EstimatePeriod,
  estimatePeriod,
  type Progress,
  progressVisible,
  projectProgress,
} from "@timekeep/core";
import {
  and,
  client,
  type DbExecutor,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  project,
  sql,
  timeEntry,
  workspaceSettings,
} from "@timekeep/db";
import type { SQL } from "drizzle-orm";

import type { Viewer } from "./catalog/viewer";

/**
 * Estimates, budgets and alerts (Phase 6b). `progressFor` is the one
 * aggregate behind every bar: raw, stopped work entries of the estimate's
 * period, all of them (visibility is the caller's `progressVisible`), never
 * rounded. A time estimate measures every work entry on the project; a
 * money one the billable amounts rated in the project's currency.
 *
 * This module imports nothing from the catalog, so the catalog can import it.
 */

type Reader = Pick<DbExecutor, "select">;

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

/** The workspace's timezone and currency: periods and money estimates follow them. */
export async function workspaceZone(
  db: Reader,
  workspaceId: string,
): Promise<{ timezone: string; currency: string }> {
  const [row] = await db
    .select({ timezone: workspaceSettings.timezone, currency: workspaceSettings.currency })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId));
  return row ?? { timezone: "UTC", currency: "USD" };
}

/** Summed over the projects' stopped work entries in `[from, to)` (no bounds when null). */
async function measure(
  db: Reader,
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
  db: Reader,
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

/** A project as `progressVisible` and `progressFor` need it. */
export interface ProgressSubject extends EstimatedProject {
  visibility: "PUBLIC" | "PRIVATE";
  isMember: boolean;
}

/** The listed projects' estimates, currencies and the viewer's membership, in one query. */
export async function progressSubjects(
  db: Reader,
  viewer: Pick<Viewer, "workspaceId" | "userId">,
  projectIds: string[],
): Promise<{ zone: { timezone: string; currency: string }; subjects: ProgressSubject[] }> {
  const zone = await workspaceZone(db, viewer.workspaceId);
  if (projectIds.length === 0) return { zone, subjects: [] };
  const rows = await db
    .select({
      id: project.id,
      visibility: project.visibility,
      estimateKind: project.estimateKind,
      estimateSeconds: project.estimateSeconds,
      estimateMinor: project.estimateMinor,
      estimateReset: project.estimateReset,
      estimateAlerts: project.estimateAlerts,
      clientCurrency: client.currency,
      isMember: sql<boolean>`exists (select 1 from "project_member" pm where pm."project_id" = ${project.id} and pm."user_id" = ${viewer.userId})`,
    })
    .from(project)
    .leftJoin(client, eq(client.id, project.clientId))
    .where(and(eq(project.workspaceId, viewer.workspaceId), inArray(project.id, projectIds)));
  return {
    zone,
    subjects: rows.map((r) => ({
      id: r.id,
      visibility: r.visibility,
      isMember: r.isMember,
      estimate: estimateOf(r),
      currency: entryCurrency(r.clientCurrency, zone.currency),
    })),
  };
}

/** The progress the viewer may see, by project id: `progressFor` filtered by `progressVisible`. */
export function visibleProgress(
  viewer: Pick<Viewer, "actor">,
  subjects: ProgressSubject[],
  progress: Map<string, Progress>,
): Map<string, Progress> {
  const out = new Map<string, Progress>();
  for (const s of subjects) {
    const p = progress.get(s.id);
    if (p && progressVisible(viewer.actor, s, p.kind)) out.set(s.id, p);
  }
  return out;
}

/** The visible progress of some projects, for the dashboard and the Summary's project rows. */
export async function progressForProjects(
  db: Reader,
  viewer: Pick<Viewer, "workspaceId" | "userId" | "actor">,
  projectIds: string[],
  now: Date,
): Promise<Map<string, Progress>> {
  const { zone, subjects } = await progressSubjects(db, viewer, projectIds);
  if (subjects.every((s) => s.estimate.kind === "NONE")) return new Map();
  const progress = await progressFor(db, viewer.workspaceId, subjects, now, zone.timezone);
  return visibleProgress(viewer, subjects, progress);
}
