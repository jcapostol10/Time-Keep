import "server-only";

import { randomUUID } from "node:crypto";

import { addDaysToKey, can, localDateKey, occurrences } from "@timekeep/core";
import {
  and,
  asc,
  assignment,
  assignmentPublish,
  type Database,
  type DbExecutor,
  eq,
  inArray,
  project,
  sql,
  task,
  user,
} from "@timekeep/db";
import { alias } from "drizzle-orm/pg-core";

import { WorkspaceAccessError } from "../access-error";
import { assertCan, loadViewer } from "../authz";
import { visibleProjectFilter, type Viewer } from "../catalog/viewer";
import { env } from "../env";
import { enqueueEmail } from "../outbox";
import { peopleContext, workspaceZone } from "../time-off/people";
import { type ScheduleEmailItem, schedulePublishedEmail } from "./emails";
import { assignmentScopeFilter, overlapsRange, publishedPlanWhere } from "./plan-sql";

/**
 * Publishing (Phase 7 design, decisions 9–10): every draft the actor may
 * write is applied in one transaction under a workspace lock, so two
 * planners publishing at once apply each draft once. Each person whose
 * published plan changed gets one email with their next four weeks.
 */

/** Days after today the email lists (today included: 28 days). */
const EMAIL_DAYS = 27;

function scheduleLock(workspaceId: string) {
  return sql`SELECT pg_advisory_xact_lock(hashtext(${`schedule:${workspaceId}`}))`;
}

const original = alias(assignment, "original");

/** Drafts in the actor's reach, with the user and project of the row each replaces. */
async function draftsInScope(db: DbExecutor, viewer: Viewer) {
  const rows = await db
    .select({
      id: assignment.id,
      userId: assignment.userId,
      projectId: assignment.projectId,
      replacesId: assignment.replacesId,
      deleted: assignment.deleted,
      originalUserId: original.userId,
      originalProjectId: original.projectId,
    })
    .from(assignment)
    .leftJoin(original, eq(original.id, assignment.replacesId))
    .where(
      and(
        eq(assignment.workspaceId, viewer.workspaceId),
        eq(assignment.published, false),
        assignmentScopeFilter(viewer.actor),
      ),
    );
  const writes = (userId: string | null, projectId: string | null) =>
    userId === null || can(viewer.actor, "assignment.write", { kind: "entry", userId, projectId });
  return rows.filter(
    (r) => writes(r.userId, r.projectId) && writes(r.originalUserId, r.originalProjectId),
  );
}

/** A person's published assignments over `[from, to]`, on projects they can see. */
async function upcomingFor(
  db: DbExecutor,
  person: Viewer,
  from: string,
  to: string,
): Promise<ScheduleEmailItem[]> {
  const rows = await db
    .select({
      startDate: assignment.startDate,
      endDate: assignment.endDate,
      mode: assignment.mode,
      minutesPerDay: assignment.minutesPerDay,
      totalMinutes: assignment.totalMinutes,
      note: assignment.note,
      repeatWeeks: assignment.repeatWeeks,
      repeatUntil: assignment.repeatUntil,
      includeNonWorking: assignment.includeNonWorking,
      projectName: project.name,
      taskName: task.name,
    })
    .from(assignment)
    .innerJoin(project, eq(project.id, assignment.projectId))
    .leftJoin(task, eq(task.id, assignment.taskId))
    .where(
      and(
        eq(assignment.workspaceId, person.workspaceId),
        eq(assignment.userId, person.userId),
        publishedPlanWhere(),
        overlapsRange(from, to),
        visibleProjectFilter(person),
      ),
    )
    .orderBy(asc(assignment.startDate), asc(project.name));
  return rows
    .flatMap((r) =>
      occurrences(r)
        .filter((o) => o.endDate >= from && o.startDate <= to)
        .map((o) => ({ ...r, startDate: o.startDate, endDate: o.endDate })),
    )
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
}

export async function publishSchedule(
  db: Database,
  viewer: Viewer,
  now: Date = new Date(),
): Promise<{ changed: number; notified: number }> {
  assertCan(viewer.actor, "schedule.publish", { kind: "none" });
  return db.transaction(async (tx) => {
    await tx.execute(scheduleLock(viewer.workspaceId));
    const drafts = await draftsInScope(tx, viewer);
    if (drafts.length === 0) return { changed: 0, notified: 0 };
    const changedPeople = new Set<string>();
    for (const d of drafts) {
      changedPeople.add(d.userId);
      if (d.originalUserId) changedPeople.add(d.originalUserId);
      if (d.deleted) {
        // Deleting the original cascades to its tombstone.
        await tx.delete(assignment).where(eq(assignment.id, d.replacesId!));
      } else if (d.replacesId) {
        // Detach first: deleting the original would cascade to the draft.
        await tx
          .update(assignment)
          .set({ published: true, replacesId: null })
          .where(eq(assignment.id, d.id));
        await tx.delete(assignment).where(eq(assignment.id, d.replacesId));
      } else {
        await tx.update(assignment).set({ published: true }).where(eq(assignment.id, d.id));
      }
    }
    const publishId = randomUUID();
    await tx.insert(assignmentPublish).values({
      id: publishId,
      workspaceId: viewer.workspaceId,
      publishedBy: viewer.userId,
      changedCount: drafts.length,
    });

    const zone = await workspaceZone(tx, viewer.workspaceId);
    const people = await peopleContext(tx, zone, [...changedPeople]);
    const emails = await tx
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(inArray(user.id, [...changedPeople]));
    let notified = 0;
    for (const person of people.values()) {
      const to = emails.find((e) => e.id === person.userId)?.email;
      if (!to) continue;
      let personViewer: Viewer;
      try {
        personViewer = await loadViewer(tx, viewer.workspaceId, person.userId);
      } catch (e) {
        if (e instanceof WorkspaceAccessError) continue;
        throw e;
      }
      const today = localDateKey(now, person.timezone);
      const items = await upcomingFor(tx, personViewer, today, addDaysToKey(today, EMAIL_DAYS));
      await enqueueEmail(tx, {
        workspaceId: viewer.workspaceId,
        to,
        kind: `schedule.published:${publishId}:${person.userId}`,
        ...schedulePublishedEmail({
          appUrl: env().APP_URL,
          slug: zone.slug,
          workspaceName: zone.name,
          items,
        }),
      });
      notified += 1;
    }
    return { changed: drafts.length, notified };
  });
}

/** Deletes the drafts the actor would publish, restoring the published plan. */
export async function discardDrafts(db: Database, viewer: Viewer): Promise<number> {
  assertCan(viewer.actor, "schedule.publish", { kind: "none" });
  return db.transaction(async (tx) => {
    await tx.execute(scheduleLock(viewer.workspaceId));
    const drafts = await draftsInScope(tx, viewer);
    if (drafts.length === 0) return 0;
    await tx.delete(assignment).where(
      inArray(
        assignment.id,
        drafts.map((d) => d.id),
      ),
    );
    return drafts.length;
  });
}
