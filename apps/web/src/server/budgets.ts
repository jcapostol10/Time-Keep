import "server-only";

import {
  addDaysToKey,
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
  or,
  project,
  rate,
  sql,
  timeEntry,
  workspaceSettings,
} from "@timekeep/db";

import type { BudgetDTO, ProjectDetail } from "@/lib/catalog-types";

import { assertCan } from "./authz";
import { getProject, requireVisibleProject } from "./catalog/projects";
import { listTasks } from "./catalog/tasks";
import type { Viewer } from "./catalog/viewer";
import { estimateOf, progressFor, workspaceZone } from "./estimates";
import { projectCurrency } from "./rates";
import { projectForecast } from "./schedule/forecast";

/**
 * The Budget tab (Phase 6b, decision 12): a project's estimate, its bar,
 * the cumulative chart over the period and the tasks with estimates. Set by
 * owners, admins and the project's managers (`project.update`).
 */

/** Past this many days the chart samples weekly points. */
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

/** A billable rate in force for the project in its currency: the project's own, or a member's or the workspace's. */
async function hasBillableRate(
  db: Database,
  workspaceId: string,
  projectId: string,
  currency: string,
  now: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: rate.id })
    .from(rate)
    .where(
      and(
        eq(rate.workspaceId, workspaceId),
        eq(rate.kind, "billable"),
        eq(rate.currency, currency),
        isNotNull(rate.amountMinor),
        sql`${rate.effectiveFrom} <= ${now}`,
        or(eq(rate.projectId, projectId), isNull(rate.projectId)),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** The measure per local day of the workspace, over `[from, to)`: seconds, or billable amounts in `currency`. */
async function dailyMeasure(
  db: Database,
  workspaceId: string,
  projectId: string,
  kind: "TIME" | "MONEY",
  currency: string,
  tz: string,
  bounds: { from: Date | null; to: Date },
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
        lt(timeEntry.start, bounds.to),
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
): Promise<BudgetDTO> {
  const row = await requireVisibleProject(db, viewer, projectId);
  assertCan(viewer.actor, "project.update", {
    kind: "project",
    projectId,
    visibility: row.visibility,
    isMember: row.members.some((m) => m.userId === viewer.userId),
  });
  const estimate = estimateOf(row);
  const [zone, currency, settings, tasks] = await Promise.all([
    workspaceZone(db, viewer.workspaceId),
    projectCurrency(db, viewer.workspaceId, projectId),
    db
      .select({ budgetThresholds: workspaceSettings.budgetThresholds })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, viewer.workspaceId)),
    listTasks(db, viewer, projectId),
  ]);
  const tz = zone.timezone;
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
    const tomorrow = zonedDateTimeToInstant(
      { date: addDaysToKey(today, 1), hours: 0, minutes: 0 },
      tz,
    );
    const daily = await dailyMeasure(
      db,
      viewer.workspaceId,
      projectId,
      progress.kind,
      currency,
      tz,
      {
        from: period.from ?? zonedDateTimeToInstant({ date: fromKey, hours: 0, minutes: 0 }, tz),
        to: tomorrow,
      },
    );
    const keys = dateKeysBetween(fromKey, today);
    const points = cumulative(keys.map((key) => ({ key, value: daily.get(key) ?? 0 })));
    const sampled =
      points.length > DAILY_LIMIT
        ? points.filter((_, i) => i % 7 === 6 || i === points.length - 1)
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
  );

  return {
    estimate,
    currency,
    forecast,
    thresholds: budgetThresholdsOf({ budgetThresholds: settings[0]?.budgetThresholds }),
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
