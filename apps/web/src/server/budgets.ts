import "server-only";

import {
  budgetThresholdsOf,
  cumulative,
  dateKeysBetween,
  type EstimateInput,
  estimatePeriod,
  formatDateKey,
  localDateKey,
  zonedDateTimeToInstant,
} from "@timekeep/core";
import {
  and,
  type Database,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  project,
  sql,
  timeEntry,
  type WorkspaceSettings,
} from "@timekeep/db";

import type { BudgetDTO, ProjectDetail } from "@/lib/catalog-types";

import { assertCan } from "./authz";
import { getProject, requireVisibleProject } from "./catalog/projects";
import { listTasks } from "./catalog/tasks";
import type { Viewer } from "./catalog/viewer";
import { estimateOf, hasBillableRate, progressFor } from "./estimates";
import { projectCurrency } from "./rates";
import { projectForecast } from "./schedule/forecast";

/**
 * The Budget tab (Phase 6b, decision 12): a project's estimate, its bar,
 * the cumulative chart over the period and the tasks with estimates. Set by
 * owners, admins and the project's managers (`project.update`).
 */

/** Past this many days the chart keeps one point per week (its last day) and today. */
const DAILY_LIMIT = 62;

export async function setProjectEstimate(
  db: Database,
  viewer: Viewer,
  projectId: string,
  input: EstimateInput,
): Promise<ProjectDetail> {
  const row = await requireVisibleProject(db, viewer, projectId);
  assertCan(viewer.actor, "project.update", {
    kind: "project",
    projectId,
    visibility: row.visibility,
    isMember: row.members.some((m) => m.userId === viewer.userId),
  });
  await db
    .update(project)
    .set({
      estimateKind: input.kind,
      estimateSeconds: input.kind === "TIME" ? input.seconds : null,
      estimateMinor: input.kind === "MONEY" ? input.minor : null,
      estimateReset: input.kind === "NONE" ? "NONE" : input.reset,
      estimateAlerts: input.alerts,
    })
    .where(and(eq(project.id, projectId), eq(project.workspaceId, viewer.workspaceId)));
  return getProject(db, viewer, projectId);
}

/** The measure per local day of the workspace, over `[from, to)`: seconds, or billable amounts in `currency`. */
async function dailyMeasure(
  db: Database,
  workspaceId: string,
  projectId: string,
  kind: "TIME" | "MONEY",
  currency: string,
  tz: string,
  bounds: { from: Date | null; to: Date | null },
): Promise<Map<string, number>> {
  const localDay = sql<string>`((${timeEntry.start} at time zone ${tz})::date)::text`;
  const value =
    kind === "TIME"
      ? sql<number>`coalesce(sum(${timeEntry.durationSeconds}), 0)::bigint`
      : sql<number>`coalesce(sum(case when ${timeEntry.billable} and ${timeEntry.rateCurrency} = ${currency} then ${timeEntry.amountMinor} else 0 end), 0)::bigint`;
  const rows = await db
    .select({ day: localDay, value: value.mapWith(Number) })
    .from(timeEntry)
    .where(
      and(
        eq(timeEntry.workspaceId, workspaceId),
        eq(timeEntry.projectId, projectId),
        isNull(timeEntry.deletedAt),
        isNotNull(timeEntry.end),
        eq(timeEntry.type, "work"),
        bounds.from ? gte(timeEntry.start, bounds.from) : undefined,
        bounds.to ? lt(timeEntry.start, bounds.to) : undefined,
      ),
    )
    .groupBy(sql.raw("1"));
  return new Map(rows.map((r) => [r.day, r.value]));
}

export async function getProjectBudget(
  db: Database,
  viewer: Viewer,
  projectId: string,
  now: Date,
  /** The workspace's settings row, which the page already holds. */
  settings: Pick<WorkspaceSettings, "timezone" | "budgetThresholds" | "weekStart">,
): Promise<BudgetDTO> {
  const row = await requireVisibleProject(db, viewer, projectId);
  assertCan(viewer.actor, "project.update", {
    kind: "project",
    projectId,
    visibility: row.visibility,
    isMember: row.members.some((m) => m.userId === viewer.userId),
  });
  const estimate = estimateOf(row);
  const [currency, tasks] = await Promise.all([
    projectCurrency(db, viewer.workspaceId, projectId),
    listTasks(db, viewer, projectId),
  ]);
  const tz = settings.timezone;
  const progress =
    (
      await progressFor(db, viewer.workspaceId, [{ id: projectId, estimate, currency }], now, tz)
    ).get(projectId) ?? null;

  // The chart: the period's days to today (monthly), or the first entry's day to today.
  let series: BudgetDTO["series"] = [];
  if (progress) {
    const period = estimatePeriod(estimate.reset, now, tz);
    const today = localDateKey(now, tz);
    let fromKey: string | null = period.from ? localDateKey(period.from, tz) : null;
    if (!fromKey) {
      const [first] = await db
        .select({ start: sql<Date>`min(${timeEntry.start})`.mapWith(timeEntry.start) })
        .from(timeEntry)
        .where(
          and(
            eq(timeEntry.workspaceId, viewer.workspaceId),
            eq(timeEntry.projectId, projectId),
            isNull(timeEntry.deletedAt),
            isNotNull(timeEntry.end),
            eq(timeEntry.type, "work"),
          ),
        );
      fromKey = first?.start ? localDateKey(first.start, tz) : today;
    }
    if (fromKey > today) fromKey = today;
    // Measured over what the bar counts (to the period's end, or without a bound for a
    // whole-project estimate); a day after today is folded into today's point, so the
    // chart ends on the bar's number.
    const daily = await dailyMeasure(
      db,
      viewer.workspaceId,
      projectId,
      progress.kind,
      currency,
      tz,
      {
        from: period.from ?? zonedDateTimeToInstant({ date: fromKey, hours: 0, minutes: 0 }, tz),
        to: period.to,
      },
    );
    let ahead = 0;
    for (const [day, value] of daily) if (day > today) ahead += value;
    const keys = dateKeysBetween(fromKey, today);
    const points = cumulative(
      keys.map((key) => ({
        key,
        value: (daily.get(key) ?? 0) + (key === today ? ahead : 0),
      })),
    );
    // A long chart keeps the last day of each of the workspace's weeks, and today.
    const weekEnd = (settings.weekStart + 6) % 7;
    const sampled =
      points.length > DAILY_LIMIT
        ? points.filter(
            (p, i) =>
              i === points.length - 1 || new Date(`${p.key}T00:00:00Z`).getUTCDay() === weekEnd,
          )
        : points;
    series = sampled.map((p) => ({ key: p.key, label: formatDateKey(p.key), value: p.value }));
  }

  const forecast = await projectForecast(
    db,
    viewer.workspaceId,
    { id: projectId, billable: row.billable },
    estimate,
    currency,
    now,
    tz,
  );

  return {
    estimate,
    currency,
    forecast,
    thresholds: budgetThresholdsOf({ budgetThresholds: settings.budgetThresholds }),
    progress,
    hasRates: await hasBillableRate(db, viewer.workspaceId, projectId, currency, now),
    series,
    tasks: tasks
      .filter((t) => t.estimateSeconds !== null)
      .map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        estimateSeconds: t.estimateSeconds!,
        trackedSeconds: t.trackedSeconds,
      })),
  };
}
