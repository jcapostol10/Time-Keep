import "server-only";

import {
  addDaysToKey,
  amountFor,
  type Estimate,
  estimatePeriod,
  type Forecast,
  forecast,
  localDateKey,
  type RateRow,
  resolveRate,
  zonedDateTimeToInstant,
} from "@timekeep/core";
import {
  and,
  type DbExecutor,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  or,
  rate,
  sql,
  timeEntry,
} from "@timekeep/db";

import { workspaceZone } from "../time-off/people";
import { publishedPlanDays } from "./plan-days";

/**
 * The Budget tab's forecast (Phase 7 design, decisions 19–21): the estimate's
 * period tracked so far, plus the published plan from tomorrow to the period's
 * end (a month), or to the last scheduled day (capped two years out), against
 * the estimate. Scheduled money is each day's minutes at the billable rate an
 * entry would get that day, in the project's currency.
 */

/** How far ahead a whole-project forecast reads the plan. */
const HORIZON_DAYS = 730;

export async function projectForecast(
  db: DbExecutor,
  workspaceId: string,
  target: { id: string; billable: boolean },
  estimate: Estimate,
  currency: string,
  now: Date,
): Promise<Forecast | null> {
  const value = estimate.kind === "TIME" ? estimate.seconds : estimate.minor;
  if (estimate.kind === "NONE" || !value || value <= 0) return null;
  const kind = estimate.kind;
  const { timezone: tz } = await workspaceZone(db, workspaceId);
  const period = estimatePeriod(estimate.reset, now, tz);

  // Tracked: raw stopped work in the period, per local day of the workspace.
  const localDay = sql<string>`((${timeEntry.start} at time zone ${tz})::date)::text`;
  const tracked = await db
    .select({
      day: localDay,
      seconds: sql<number>`coalesce(sum(${timeEntry.durationSeconds}), 0)::bigint`.mapWith(Number),
      minor:
        sql<number>`coalesce(sum(case when ${timeEntry.billable} and ${timeEntry.rateCurrency} = ${currency} then ${timeEntry.amountMinor} else 0 end), 0)::bigint`.mapWith(
          Number,
        ),
    })
    .from(timeEntry)
    .where(
      and(
        eq(timeEntry.workspaceId, workspaceId),
        eq(timeEntry.projectId, target.id),
        isNull(timeEntry.deletedAt),
        isNotNull(timeEntry.end),
        eq(timeEntry.type, "work"),
        period.from ? gte(timeEntry.start, period.from) : undefined,
        period.to ? lt(timeEntry.start, period.to) : undefined,
      ),
    )
    .groupBy(sql.raw("1"))
    .orderBy(sql.raw("1"));
  let trackedSeconds = 0;
  let trackedMinor = 0;
  let trackedReachedOn: string | null = null;
  for (const d of tracked) {
    trackedSeconds += d.seconds;
    trackedMinor += d.minor;
    const so = kind === "TIME" ? trackedSeconds : trackedMinor;
    if (!trackedReachedOn && so >= value) trackedReachedOn = d.day;
  }

  // Scheduled: the published plan from tomorrow.
  const tomorrow = addDaysToKey(localDateKey(now, tz), 1);
  const end = period.to
    ? localDateKey(new Date(period.to.getTime() - 1), tz)
    : addDaysToKey(tomorrow, HORIZON_DAYS);
  const days =
    tomorrow > end
      ? []
      : await publishedPlanDays(db, workspaceId, {
          from: tomorrow,
          to: end,
          projectIds: [target.id],
        });

  const rates: RateRow[] = target.billable
    ? (
        await db
          .select()
          .from(rate)
          .where(
            and(
              eq(rate.workspaceId, workspaceId),
              eq(rate.kind, "billable"),
              eq(rate.currency, currency),
              or(isNull(rate.projectId), eq(rate.projectId, target.id)),
            ),
          )
      ).map((r) => ({
        kind: r.kind,
        level: r.level,
        userId: r.userId,
        projectId: r.projectId,
        taskId: r.taskId,
        amountMinor: r.amountMinor,
        currency: r.currency,
        effectiveFrom: r.effectiveFrom,
      }))
    : [];

  const byDay = new Map<string, { seconds: number; minor: number }>();
  let unratedSeconds = 0;
  for (const d of days) {
    const seconds = d.minutes * 60;
    const resolved = target.billable
      ? resolveRate(rates, {
          userId: d.userId,
          projectId: target.id,
          taskId: d.taskId,
          start: zonedDateTimeToInstant({ date: d.dateKey, hours: 0, minutes: 0 }, tz),
          currency,
        })
      : null;
    const minor = resolved ? amountFor(resolved.amountMinor, seconds) : 0;
    if (!resolved) unratedSeconds += seconds;
    const cur = byDay.get(d.dateKey) ?? { seconds: 0, minor: 0 };
    byDay.set(d.dateKey, { seconds: cur.seconds + seconds, minor: cur.minor + minor });
  }

  return forecast({
    kind,
    estimate: value,
    trackedSeconds,
    trackedMinor,
    trackedReachedOn,
    scheduled: [...byDay].map(([dateKey, v]) => ({ dateKey, ...v })),
    unratedSeconds,
  });
}
