import "server-only";

import {
  addDaysInZone,
  attendanceDays,
  attendanceWeeks,
  can,
  type DayWork,
  holidayApplies,
  holidayKeysFor,
  holidaysInRange,
  localDateKey,
  type ReportQuery,
  resolveReportRange,
  sumAttendanceWeeks,
  timeOffMinutesByDay,
  type ViewerPrefs,
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
  lte,
  sql,
  timeEntry,
  timeOffPolicy,
  timeOffRequest,
  user,
} from "@timekeep/db";

import type { AttendancePerson, AttendanceReport } from "@/lib/report-types";

import type { Viewer } from "./catalog/viewer";
import { holidayRules } from "./time-off/holidays";
import { type PersonContext, peopleContext, workspaceZone } from "./time-off/people";

/**
 * The Attendance report (Phase 5b, decision 13). A day is the person's own
 * (`user.timezone`, else the workspace's); work and breaks are raw seconds of
 * stopped, live entries (rounding never applies); capacity comes from the
 * member's working pattern less holidays and approved time off. Weeks start on
 * the workspace's week start. People in scope (ruling R4): owners and admins
 * everyone, a manager themselves and the people they manage, a member
 * themselves.
 */

/** The people the report covers: the query's users and groups, narrowed to `attendance.read`. */
function peopleFor(viewer: Viewer, query: ReportQuery, all: PersonContext[]): PersonContext[] {
  const readsOthers = viewer.role !== "member";
  return all
    .filter((p) => !readsOthers || query.userIds.length === 0 || query.userIds.includes(p.userId))
    .filter(
      (p) =>
        !readsOthers ||
        query.groupIds.length === 0 ||
        query.groupIds.some((g) => p.groupIds.has(g)),
    )
    .filter((p) => can(viewer.actor, "attendance.read", { kind: "person", userId: p.userId }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** One row per (person, their local day): first start, last end, work and break seconds. */
export async function workByPersonDay(
  db: DbExecutor,
  workspaceId: string,
  workspaceTz: string,
  userIds: string[],
  bounds: { from: Date; to: Date },
) {
  const localDay = sql<string>`((${timeEntry.start} at time zone coalesce(${user.timezone}, ${workspaceTz}))::date)::text`;
  return db
    .select({
      userId: timeEntry.userId,
      dateKey: localDay,
      firstStart: sql<Date>`min(${timeEntry.start})`.mapWith(timeEntry.start),
      lastEnd: sql<Date>`max(${timeEntry.end})`.mapWith(timeEntry.end),
      workSeconds:
        sql<number>`coalesce(sum(${timeEntry.durationSeconds}) filter (where ${timeEntry.type} = 'work'), 0)::bigint`.mapWith(
          Number,
        ),
      breakSeconds:
        sql<number>`coalesce(sum(${timeEntry.durationSeconds}) filter (where ${timeEntry.type} = 'break'), 0)::bigint`.mapWith(
          Number,
        ),
    })
    .from(timeEntry)
    .innerJoin(user, eq(user.id, timeEntry.userId))
    .where(
      and(
        eq(timeEntry.workspaceId, workspaceId),
        isNull(timeEntry.deletedAt),
        isNotNull(timeEntry.end),
        inArray(timeEntry.userId, userIds),
        gte(timeEntry.start, bounds.from),
        lt(timeEntry.start, bounds.to),
      ),
    )
    .groupBy(sql.raw("1"), sql.raw("2"));
}

export async function attendanceReport(
  db: DbExecutor,
  viewer: Viewer,
  query: ReportQuery,
  prefs: ViewerPrefs,
  now: Date = new Date(),
): Promise<AttendanceReport> {
  const range = resolveReportRange(query, prefs, now);
  const from = localDateKey(range.from, prefs.timezone);
  const to = localDateKey(new Date(range.to.getTime() - 1), prefs.timezone);
  const zone = await workspaceZone(db, viewer.workspaceId);
  // Deactivated members stay in the scope here: the time they tracked still counts (payroll).
  const candidates = peopleFor(viewer, query, [
    ...(await peopleContext(db, zone, undefined, { includeDeactivated: true })).values(),
  ]);
  if (candidates.length === 0) return { from, to, label: range.label, people: [] };
  const candidateIds = candidates.map((p) => p.userId);

  // Everyone's days lie within a day of the viewer's range, whatever their timezone.
  const bounds = {
    from: addDaysInZone(range.from, -1, prefs.timezone),
    to: addDaysInZone(range.to, 1, prefs.timezone),
  };
  const [work, approvedAll] = await Promise.all([
    workByPersonDay(db, viewer.workspaceId, zone.timezone, candidateIds, bounds),
    db
      .select({
        userId: timeOffRequest.userId,
        unit: timeOffPolicy.unit,
        start: timeOffRequest.startDate,
        end: timeOffRequest.endDate,
        halfDay: timeOffRequest.halfDay,
        minutes: timeOffRequest.minutes,
      })
      .from(timeOffRequest)
      .innerJoin(timeOffPolicy, eq(timeOffPolicy.id, timeOffRequest.policyId))
      .where(
        and(
          eq(timeOffRequest.workspaceId, viewer.workspaceId),
          inArray(timeOffRequest.userId, candidateIds),
          eq(timeOffRequest.status, "APPROVED"),
          lte(timeOffRequest.startDate, to),
          gte(timeOffRequest.endDate, from),
        ),
      ),
  ]);
  // A deactivated member is listed only for the days they tracked.
  const people = candidates.filter(
    (p) =>
      p.active || work.some((w) => w.userId === p.userId && w.dateKey >= from && w.dateKey <= to),
  );
  const approved = approvedAll.filter((r) => people.some((p) => p.userId === r.userId));
  // A request is counted over its whole span, so its holidays are needed beyond the range.
  const rulesFrom = approved.reduce((m, r) => (r.start < m ? r.start : m), from);
  const rulesTo = approved.reduce((m, r) => (r.end > m ? r.end : m), to);
  const rules = await holidayRules(db, zone.id, rulesFrom, rulesTo);

  const out: AttendancePerson[] = people.map((person) => {
    const mine = rules.filter((h) => holidayApplies(h, person));
    const holidays = new Map<string, string>();
    for (const h of holidaysInRange(mine, from, to)) {
      const before = holidays.get(h.dateKey);
      holidays.set(h.dateKey, before ? `${before}, ${h.holiday.name}` : h.holiday.name);
    }
    const timeOffMinutes = new Map<string, number>();
    for (const r of approved.filter((a) => a.userId === person.userId)) {
      const keys = holidayKeysFor(rules, person, r.start, r.end);
      for (const [k, m] of timeOffMinutesByDay(r.unit, r, person.capacity, keys)) {
        timeOffMinutes.set(k, (timeOffMinutes.get(k) ?? 0) + m);
      }
    }
    const days = new Map<string, DayWork>();
    for (const w of work) {
      if (w.userId !== person.userId || w.dateKey < from || w.dateKey > to) continue;
      days.set(w.dateKey, {
        dateKey: w.dateKey,
        firstStart: w.firstStart.toISOString(),
        lastEnd: w.lastEnd.toISOString(),
        workSeconds: w.workSeconds,
        breakSeconds: w.breakSeconds,
      });
    }
    const rows = attendanceDays({
      from,
      to,
      work: days,
      capacity: person.capacity,
      holidays,
      timeOffMinutes,
    });
    const weeks = attendanceWeeks(rows, person.capacity, zone.weekStart, { from, to });
    return {
      userId: person.userId,
      userName: person.name,
      timezone: person.timezone,
      capacity: person.capacity,
      days: rows,
      weeks,
      totals: sumAttendanceWeeks(weeks, from),
    };
  });
  return { from, to, label: range.label, people: out };
}
