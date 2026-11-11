import "server-only";

import { assignmentDays, DEFAULT_CAPACITY, type DayRules, spanLastDay } from "@timekeep/core";
import { and, assignment, type DbExecutor, eq, inArray, project } from "@timekeep/db";
import type { SQL } from "drizzle-orm";

import { peopleContext, workspaceZone } from "../time-off/people";
import { dayRulesFor } from "./days";
import { overlapsRange, publishedPlanWhere } from "./plan-sql";

/**
 * The published plan as minutes per person, project and day (Phase 7b): what
 * the forecast and the Assignments report read. Each assignment falls on its
 * person's working days less their holidays (over each occurrence's whole
 * span, so a total is spread before the range cuts it), as on the grid.
 */

export interface PlanDay {
  userId: string;
  projectId: string;
  taskId: string | null;
  dateKey: string;
  minutes: number;
}

export async function publishedPlanDays(
  db: DbExecutor,
  workspaceId: string,
  opts: {
    from: string;
    to: string;
    userIds?: readonly string[];
    projectIds?: readonly string[];
    /** Extra conditions over `assignment` and `project` (scope, visibility). */
    where?: SQL;
  },
): Promise<PlanDay[]> {
  if (opts.userIds?.length === 0 || opts.projectIds?.length === 0) return [];
  const rows = await db
    .select({ a: assignment })
    .from(assignment)
    .innerJoin(project, eq(project.id, assignment.projectId))
    .where(
      and(
        eq(assignment.workspaceId, workspaceId),
        publishedPlanWhere(),
        overlapsRange(opts.from, opts.to),
        opts.userIds ? inArray(assignment.userId, [...opts.userIds]) : undefined,
        opts.projectIds ? inArray(assignment.projectId, [...opts.projectIds]) : undefined,
        opts.where,
      ),
    );
  if (rows.length === 0) return [];
  const userIds = [...new Set(rows.map((r) => r.a.userId))];
  const zone = await workspaceZone(db, workspaceId);
  const people = [
    ...(await peopleContext(db, zone, userIds, { includeDeactivated: true })).values(),
  ];
  const rulesFrom = rows.reduce((m, r) => (r.a.startDate < m ? r.a.startDate : m), opts.from);
  const rulesTo = rows.reduce((m, r) => {
    const last = spanLastDay(r.a);
    return last > m ? last : m;
  }, opts.to);
  const rules = await dayRulesFor(db, workspaceId, people, rulesFrom, rulesTo);
  // Someone no longer a member: the default working week, no holidays.
  const fallback: DayRules = { workingDays: DEFAULT_CAPACITY.workingDays, holidayKeys: new Set() };
  return rows.flatMap(({ a }) =>
    [...assignmentDays(a, rules.get(a.userId) ?? fallback, opts)].map(([dateKey, minutes]) => ({
      userId: a.userId,
      projectId: a.projectId,
      taskId: a.taskId,
      dateKey,
      minutes,
    })),
  );
}
