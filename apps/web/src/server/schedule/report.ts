import "server-only";

import {
  addDaysInZone,
  assignmentsRows,
  localDateKey,
  type PlanRow,
  type ReportQuery,
  resolveReportRange,
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
  or,
  project,
  sql,
  timeEntry,
  user,
  userGroupMember,
} from "@timekeep/db";
import type { SQL } from "drizzle-orm";

import type { AssignmentsReport } from "@/lib/report-types";

import { scopeFilter } from "../authz";
import { visibleProjectFilter, type Viewer } from "../catalog/viewer";
import { workspaceZone } from "../time-off/people";
import { publishedPlanDays } from "./plan-days";
import { assignmentScopeFilter } from "./plan-sql";

/**
 * The Assignments report (Phase 7 design, decision 22): the published plan
 * against raw tracked work, per person, project, day or week. A member sees
 * only their own (a plan is not the team's time); a manager their scope;
 * projects the viewer cannot see are left out on both sides.
 */

const NO_PROJECT = "";

export async function assignmentsReport(
  db: DbExecutor,
  viewer: Viewer,
  query: ReportQuery,
  prefs: ViewerPrefs,
  now: Date = new Date(),
): Promise<AssignmentsReport> {
  const range = resolveReportRange(query, prefs, now);
  const from = localDateKey(range.from, prefs.timezone);
  const to = localDateKey(new Date(range.to.getTime() - 1), prefs.timezone);
  const zone = await workspaceZone(db, viewer.workspaceId);
  const member = viewer.role === "member";

  // The people filter: a member pinned to themselves; groups expanded to their members.
  let userIds: string[] | undefined = member
    ? [viewer.userId]
    : query.userIds.length
      ? [...query.userIds]
      : undefined;
  if (!member && query.groupIds.length) {
    const inGroups = (
      await db
        .select({ userId: userGroupMember.userId })
        .from(userGroupMember)
        .where(inArray(userGroupMember.groupId, query.groupIds))
    ).map((r) => r.userId);
    userIds = userIds ? userIds.filter((u) => inGroups.includes(u)) : inGroups;
  }
  const projectFilter: SQL[] = [];
  if (query.projectIds.length) projectFilter.push(inArray(project.id, query.projectIds));
  if (query.clientIds.length) projectFilter.push(inArray(project.clientId, query.clientIds));

  const visible = visibleProjectFilter(viewer);
  const scheduled = await publishedPlanDays(db, viewer.workspaceId, {
    from,
    to,
    userIds,
    where: and(assignmentScopeFilter(viewer.actor), visible, ...projectFilter),
  });

  // Tracked: stopped live work, on each owner's own local day, a day either side of the range.
  const localDay = sql<string>`((${timeEntry.start} at time zone coalesce(${user.timezone}, ${zone.timezone}))::date)::text`;
  const trackedRows =
    userIds?.length === 0
      ? []
      : await db
          .select({
            userId: timeEntry.userId,
            projectId: timeEntry.projectId,
            dateKey: localDay,
            seconds: sql<number>`coalesce(sum(${timeEntry.durationSeconds}), 0)::bigint`.mapWith(
              Number,
            ),
          })
          .from(timeEntry)
          .innerJoin(user, eq(user.id, timeEntry.userId))
          .leftJoin(project, eq(project.id, timeEntry.projectId))
          .where(
            and(
              eq(timeEntry.workspaceId, viewer.workspaceId),
              isNull(timeEntry.deletedAt),
              isNotNull(timeEntry.end),
              eq(timeEntry.type, "work"),
              gte(timeEntry.start, addDaysInZone(range.from, -1, prefs.timezone)),
              lt(timeEntry.start, addDaysInZone(range.to, 1, prefs.timezone)),
              member ? eq(timeEntry.userId, viewer.userId) : scopeFilter(viewer.actor),
              userIds ? inArray(timeEntry.userId, userIds) : undefined,
              // Time on no project has no plan to compare with, but it is the person's time.
              visible ? or(isNull(timeEntry.projectId), visible) : undefined,
              ...projectFilter,
            ),
          )
          .groupBy(sql.raw("1"), sql.raw("2"), sql.raw("3"));
  const tracked: PlanRow[] = trackedRows
    .filter((r) => r.dateKey >= from && r.dateKey <= to)
    .map((r) => ({ ...r, projectId: r.projectId ?? NO_PROJECT }));
  const plan: PlanRow[] = scheduled.map((d) => ({
    userId: d.userId,
    projectId: d.projectId,
    dateKey: d.dateKey,
    seconds: d.minutes * 60,
  }));

  const labels = new Map<string, string>([[NO_PROJECT, "(no project)"]]);
  const people = [...new Set([...plan, ...tracked].map((r) => r.userId))];
  const projects = [...new Set([...plan, ...tracked].map((r) => r.projectId))].filter(Boolean);
  if (people.length) {
    for (const u of await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(inArray(user.id, people))) {
      labels.set(u.id, u.name);
    }
  }
  if (projects.length) {
    for (const p of await db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(inArray(project.id, projects))) {
      labels.set(p.id, p.name);
    }
  }
  const { rows, totals } = assignmentsRows(plan, tracked, query.assignmentsBy, {
    weekStart: zone.weekStart,
    labels,
  });
  return { from, to, label: range.label, by: query.assignmentsBy, rows, totals };
}
