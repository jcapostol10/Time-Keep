import "server-only";

import {
  assignmentDays,
  can,
  capacityByDay,
  holidayApplies,
  holidayKeysFor,
  holidaysInRange,
  scheduleRangeSchema,
  spanLastDay,
  timeOffMinutesByDay,
} from "@timekeep/core";
import {
  and,
  asc,
  assignment,
  assignmentPublish,
  count,
  type DbExecutor,
  desc,
  eq,
  gte,
  inArray,
  lte,
  membership,
  project,
  projectGroup,
  projectMember,
  task,
  timeOffPolicy,
  timeOffRequest,
  userGroupMember,
} from "@timekeep/db";

import type {
  AssignmentDTO,
  ScheduleDTO,
  SchedulePerson,
  ScheduleProject,
} from "@/lib/schedule-types";

import { assertCan } from "../authz";
import { visibleProjectFilter, type Viewer } from "../catalog/viewer";
import { holidayRules } from "../time-off/holidays";
import { peopleContext, workspaceZone } from "../time-off/people";
import { BadRequestError } from "../workspace-access";
import { listMilestones } from "./milestones";
import {
  assignmentScopeFilter,
  overlapsRange,
  publishedPlanWhere,
  workingPlanWhere,
} from "./plan-sql";

/**
 * The schedule's one read (Phase 7 design, decisions 7, 9, 11–17): the
 * working plan for planners or a person's own published plan, over at most
 * 13 weeks, with each person's capacity per day. Hours on a project the
 * viewer cannot see count, blanked as "Another project".
 */

export interface ScheduleOptions {
  from: string;
  to: string;
  plan: "working" | "published";
  userIds?: readonly string[];
  groupIds?: readonly string[];
  projectIds?: readonly string[];
}

/** The people a planner's rows show: everyone for admins; a manager themselves, their people, their projects' members. */
async function plannerPeople(db: DbExecutor, viewer: Viewer): Promise<string[]> {
  const active = await db
    .select({ userId: membership.userId })
    .from(membership)
    .where(and(eq(membership.workspaceId, viewer.workspaceId), eq(membership.status, "ACTIVE")));
  const ids = active.map((r) => r.userId);
  const { actor } = viewer;
  if (actor.role === "owner" || actor.role === "admin") return ids;
  const reach = new Set([actor.userId, ...actor.managedUserIds]);
  const projects = [...actor.managedProjectIds];
  if (projects.length > 0) {
    const [direct, viaGroups] = await Promise.all([
      db
        .select({ userId: projectMember.userId })
        .from(projectMember)
        .where(inArray(projectMember.projectId, projects)),
      db
        .select({ userId: userGroupMember.userId })
        .from(projectGroup)
        .innerJoin(userGroupMember, eq(userGroupMember.groupId, projectGroup.groupId))
        .where(inArray(projectGroup.projectId, projects)),
    ]);
    for (const r of [...direct, ...viaGroups]) reach.add(r.userId);
  }
  return ids.filter((id) => reach.has(id));
}

export async function readSchedule(
  db: DbExecutor,
  viewer: Viewer,
  opts: ScheduleOptions,
): Promise<ScheduleDTO> {
  const range = scheduleRangeSchema.safeParse({ from: opts.from, to: opts.to });
  if (!range.success) throw new BadRequestError(range.error.issues[0]!.message);
  const { from, to } = range.data;
  const working = opts.plan === "working";
  if (working) assertCan(viewer.actor, "schedule.viewTeam", { kind: "none" });

  const zone = await workspaceZone(db, viewer.workspaceId);
  let ids = working ? await plannerPeople(db, viewer) : [viewer.userId];
  if (opts.userIds?.length) ids = ids.filter((id) => opts.userIds!.includes(id));
  const people = [...(await peopleContext(db, zone, ids)).values()]
    .filter((p) => !opts.groupIds?.length || opts.groupIds.some((g) => p.groupIds.has(g)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const personIds = people.map((p) => p.userId);

  const rows = personIds.length
    ? await db
        .select({
          a: assignment,
          projectName: project.name,
          projectColor: project.color,
          taskName: task.name,
        })
        .from(assignment)
        .innerJoin(project, eq(project.id, assignment.projectId))
        .leftJoin(task, eq(task.id, assignment.taskId))
        .where(
          and(
            eq(assignment.workspaceId, viewer.workspaceId),
            inArray(assignment.userId, personIds),
            working ? workingPlanWhere() : publishedPlanWhere(),
            overlapsRange(from, to),
            opts.projectIds?.length
              ? inArray(assignment.projectId, [...opts.projectIds])
              : undefined,
          ),
        )
        .orderBy(asc(assignment.startDate), asc(assignment.id))
    : [];

  const rowProjectIds = [...new Set(rows.map((r) => r.a.projectId))];
  const visible = new Set(
    rowProjectIds.length
      ? (
          await db
            .select({ id: project.id })
            .from(project)
            .where(
              and(
                eq(project.workspaceId, viewer.workspaceId),
                inArray(project.id, rowProjectIds),
                visibleProjectFilter(viewer),
              ),
            )
        ).map((r) => r.id)
      : [],
  );

  // Holidays over every occurrence's whole span: a total is spread over it before the range cuts it.
  const rulesFrom = rows.reduce((m, r) => (r.a.startDate < m ? r.a.startDate : m), from);
  const rulesTo = rows.reduce((m, r) => {
    const last = spanLastDay(r.a);
    return last > m ? last : m;
  }, to);
  const [rules, approved] = await Promise.all([
    personIds.length ? holidayRules(db, viewer.workspaceId, rulesFrom, rulesTo) : [],
    personIds.length
      ? db
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
              inArray(timeOffRequest.userId, personIds),
              eq(timeOffRequest.status, "APPROVED"),
              lte(timeOffRequest.startDate, to),
              gte(timeOffRequest.endDate, from),
            ),
          )
      : [],
  ]);

  const assignments: AssignmentDTO[] = [];
  const outPeople: SchedulePerson[] = [];
  let hidden = 0;
  for (const person of people) {
    const holidayKeys = holidayKeysFor(rules, person, rulesFrom, rulesTo);
    const timeOff = new Map<string, number>();
    for (const r of approved.filter((x) => x.userId === person.userId)) {
      const keys = holidayKeysFor(rules, person, r.start, r.end);
      for (const [k, m] of timeOffMinutesByDay(r.unit, r, person.capacity, keys)) {
        timeOff.set(k, (timeOff.get(k) ?? 0) + m);
      }
    }
    const capacity = capacityByDay({ from, to }, person.capacity, holidayKeys, timeOff);
    const holidays: Record<string, string> = {};
    for (const h of holidaysInRange(
      rules.filter((x) => holidayApplies(x, person)),
      from,
      to,
    )) {
      holidays[h.dateKey] = holidays[h.dateKey]
        ? `${holidays[h.dateKey]}, ${h.holiday.name}`
        : h.holiday.name;
    }
    let scheduledMinutes = 0;
    for (const r of rows.filter((x) => x.a.userId === person.userId)) {
      const days = Object.fromEntries(
        assignmentDays(
          r.a,
          { workingDays: person.capacity.workingDays, holidayKeys },
          { from, to },
        ),
      );
      for (const m of Object.values(days)) scheduledMinutes += m;
      const seen = visible.has(r.a.projectId);
      assignments.push({
        id: seen ? r.a.id : `hidden-${(hidden += 1)}`,
        userId: r.a.userId,
        project: seen ? { id: r.a.projectId, name: r.projectName, color: r.projectColor } : null,
        task: seen && r.a.taskId && r.taskName ? { id: r.a.taskId, name: r.taskName } : null,
        startDate: r.a.startDate,
        endDate: r.a.endDate,
        mode: r.a.mode,
        minutesPerDay: r.a.minutesPerDay,
        totalMinutes: r.a.totalMinutes,
        includeNonWorking: r.a.includeNonWorking,
        note: seen ? r.a.note : "",
        repeatWeeks: r.a.repeatWeeks,
        repeatUntil: r.a.repeatUntil,
        draft: !r.a.published,
        editable:
          working &&
          seen &&
          can(viewer.actor, "assignment.write", {
            kind: "entry",
            userId: r.a.userId,
            projectId: r.a.projectId,
          }),
        days,
      });
    }
    outPeople.push({
      userId: person.userId,
      name: person.name,
      capacity: Object.fromEntries(capacity),
      holidays,
      scheduledMinutes,
      capacityMinutes: [...capacity.values()].reduce((a, b) => a + b, 0),
    });
  }

  const milestones = working
    ? await listMilestones(
        db,
        viewer,
        { from, to },
        opts.projectIds?.length ? opts.projectIds : undefined,
      )
    : [];
  const projectIds = [
    ...new Set([
      ...assignments.flatMap((a) => (a.project ? [a.project.id] : [])),
      ...milestones.map((m) => m.projectId),
    ]),
  ];
  const projects: ScheduleProject[] = projectIds.length
    ? (
        await db
          .select({ id: project.id, name: project.name, color: project.color })
          .from(project)
          .where(inArray(project.id, projectIds))
          .orderBy(asc(project.name))
      ).map((p) => ({
        ...p,
        canManage: can(viewer.actor, "milestone.manage", { kind: "project", projectId: p.id }),
      }))
    : [];

  let draftCount = 0;
  let lastPublishedAt: string | null = null;
  if (working) {
    const [drafts, last] = await Promise.all([
      db
        .select({ n: count() })
        .from(assignment)
        .where(
          and(
            eq(assignment.workspaceId, viewer.workspaceId),
            eq(assignment.published, false),
            assignmentScopeFilter(viewer.actor),
          ),
        ),
      db
        .select({ at: assignmentPublish.publishedAt })
        .from(assignmentPublish)
        .where(eq(assignmentPublish.workspaceId, viewer.workspaceId))
        .orderBy(desc(assignmentPublish.publishedAt))
        .limit(1),
    ]);
    draftCount = drafts[0]?.n ?? 0;
    lastPublishedAt = last[0]?.at.toISOString() ?? null;
  }

  return {
    from,
    to,
    plan: opts.plan,
    people: outPeople,
    assignments,
    milestones,
    projects,
    draftCount,
    lastPublishedAt,
  };
}
