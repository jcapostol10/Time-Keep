import "server-only";

import { randomUUID } from "node:crypto";

import {
  assignmentDays,
  type AssignmentInput,
  assignmentInputSchema,
  type AssignmentPatch,
  type AssignmentShape,
  can,
  type DayRules,
  MINUTES_PER_DAY_MAX,
  moveAssignment,
  occurrences,
  splitAssignment,
  trackingBlock,
} from "@timekeep/core";
import {
  and,
  type Assignment,
  assignment,
  type Database,
  type DbExecutor,
  eq,
  project,
  task,
  user,
} from "@timekeep/db";

import { WorkspaceAccessError } from "../access-error";
import { assertCan, loadViewer, projectResource } from "../authz";
import { visibleTasksFor } from "../catalog/tasks";
import type { Viewer } from "../catalog/viewer";
import { personContext, workspaceZone } from "../time-off/people";
import { dayRulesFor } from "./days";
import { assignmentScopeFilter } from "./plan-sql";

/**
 * The one writer of `assignment` with `publish.ts` (Phase 7 design, decisions
 * 1–9). A published row is never edited in place: an edit makes (or edits)
 * the draft that replaces it, a delete makes a tombstone draft. Every write
 * asks the matrix for the person and project before and after the change.
 */

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class ScheduleError extends Error {
  constructor(
    readonly code: "INVALID" | "NOT_FOUND",
    message: string,
    /** The form field the message belongs to. */
    readonly field?: string,
  ) {
    super(message);
    this.name = "ScheduleError";
  }
}

const NOT_FOUND = "Not found";

function shapeOf(a: AssignmentInput | Assignment): AssignmentShape {
  return {
    startDate: a.startDate,
    endDate: a.endDate,
    mode: a.mode,
    minutesPerDay: a.minutesPerDay,
    totalMinutes: a.totalMinutes,
    includeNonWorking: a.includeNonWorking,
    repeatWeeks: a.repeatWeeks,
    repeatUntil: a.repeatUntil,
  };
}

function inputOf(row: Assignment): AssignmentInput {
  return {
    userId: row.userId,
    projectId: row.projectId,
    taskId: row.taskId,
    note: row.note,
    ...shapeOf(row),
  };
}

/** The person's working days and holidays over the whole series. */
async function rulesFor(db: DbExecutor, viewer: Viewer, a: AssignmentInput): Promise<DayRules> {
  const zone = await workspaceZone(db, viewer.workspaceId);
  const person = await personContext(db, zone, a.userId);
  const spans = occurrences(shapeOf(a));
  const last = spans[spans.length - 1]?.endDate ?? a.endDate;
  const rules = await dayRulesFor(db, viewer.workspaceId, [person], a.startDate, last);
  return rules.get(a.userId)!;
}

/**
 * Who and what an assignment may name (decision 5): the matrix for the
 * actor, a live project the actor can see, a person who can see it, a task
 * of that project available to them, and an amount that fits the days.
 */
async function requireAssignable(db: Tx, viewer: Viewer, a: AssignmentInput): Promise<void> {
  assertCan(viewer.actor, "assignment.write", {
    kind: "entry",
    userId: a.userId,
    projectId: a.projectId,
  });
  const person = await loadViewer(db, viewer.workspaceId, a.userId);
  const [row] = await db
    .select({ id: project.id, archived: project.archived, isTemplate: project.isTemplate })
    .from(project)
    .where(and(eq(project.id, a.projectId), eq(project.workspaceId, viewer.workspaceId)));
  if (!row) throw new WorkspaceAccessError(404, NOT_FOUND);
  assertCan(viewer.actor, "project.view", await projectResource(db, viewer, a.projectId));
  const taskRow = a.taskId
    ? (
        await db
          .select({ id: task.id, projectId: task.projectId, status: task.status })
          .from(task)
          .where(and(eq(task.id, a.taskId), eq(task.workspaceId, viewer.workspaceId)))
      )[0]
    : null;
  if (a.taskId && !taskRow) throw new WorkspaceAccessError(404, NOT_FOUND);
  const block = trackingBlock({ project: row, task: taskRow ?? null, tags: [] });
  if (block) throw new ScheduleError("INVALID", block, taskRow ? "taskId" : "projectId");

  const [named] = await db.select({ name: user.name }).from(user).where(eq(user.id, a.userId));
  const name = named?.name ?? "this person";
  if (!can(person.actor, "project.view", await projectResource(db, person, a.projectId))) {
    throw new ScheduleError("INVALID", `Add ${name} to the project first.`, "projectId");
  }
  if (a.taskId) {
    const available = await visibleTasksFor(db, person, { projectIds: [a.projectId] });
    if (!available.some((t) => t.id === a.taskId)) {
      throw new ScheduleError("INVALID", `This task is not available to ${name}.`, "taskId");
    }
  }

  const rules = await rulesFor(db, viewer, a);
  const span = occurrences(shapeOf(a))[0]!;
  const shape = shapeOf(a);
  const falling = assignmentDays(
    { ...shape, repeatWeeks: null, repeatUntil: null, mode: "PER_DAY", minutesPerDay: 1 },
    rules,
    { from: span.startDate, to: span.endDate },
  ).size;
  if (falling === 0) {
    throw new ScheduleError(
      "INVALID",
      "This falls on no working day: include non-working days.",
      "includeNonWorking",
    );
  }
  if (a.mode === "TOTAL" && (a.totalMinutes ?? 0) > falling * MINUTES_PER_DAY_MAX) {
    throw new ScheduleError("INVALID", "That is more than 24 hours a day.", "totalMinutes");
  }
}

/** The merged shape, validated like a new assignment (one amount per mode, a repeat with its end). */
function merge(row: AssignmentInput, patch: AssignmentPatch): AssignmentInput {
  const next = { ...row };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (next as Record<string, unknown>)[k] = v;
  }
  // A new project without a task named clears the old project's task.
  if (patch.projectId && patch.projectId !== row.projectId && patch.taskId === undefined) {
    next.taskId = null;
  }
  if (next.mode === "PER_DAY") next.totalMinutes = null;
  else next.minutesPerDay = null;
  if (next.repeatWeeks === null) next.repeatUntil = null;
  const parsed = assignmentInputSchema.safeParse(next);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new ScheduleError("INVALID", issue.message, issue.path.join(".") || undefined);
  }
  return parsed.data;
}

/**
 * The row an id names in the working plan: a draft (never a tombstone), or a
 * published row; a published row with a draft resolves to the draft. Outside
 * the actor's reach, or absent: not found.
 */
async function workingRow(db: Tx, viewer: Viewer, id: string): Promise<Assignment> {
  const [row] = await db
    .select()
    .from(assignment)
    .where(
      and(
        eq(assignment.id, id),
        eq(assignment.workspaceId, viewer.workspaceId),
        assignmentScopeFilter(viewer.actor),
      ),
    )
    .for("update");
  if (!row || row.deleted) throw new WorkspaceAccessError(404, NOT_FOUND);
  if (!row.published) return row;
  const [draft] = await db
    .select()
    .from(assignment)
    .where(eq(assignment.replacesId, row.id))
    .for("update");
  if (draft?.deleted) throw new WorkspaceAccessError(404, NOT_FOUND);
  return draft ?? row;
}

async function insertDraft(
  db: Tx,
  viewer: Viewer,
  a: AssignmentInput,
  extra: { replacesId?: string; deleted?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(assignment).values({
    id,
    workspaceId: viewer.workspaceId,
    ...a,
    published: false,
    replacesId: extra.replacesId ?? null,
    deleted: extra.deleted ?? false,
    createdBy: viewer.userId,
  });
  return id;
}

async function createIn(db: Tx, viewer: Viewer, input: AssignmentInput): Promise<string> {
  await requireAssignable(db, viewer, input);
  return insertDraft(db, viewer, input);
}

async function updateIn(
  db: Tx,
  viewer: Viewer,
  id: string,
  patch: AssignmentPatch,
): Promise<string> {
  const row = await workingRow(db, viewer, id);
  const before = inputOf(row);
  const next = merge(before, patch);
  // The matrix for where it was, then everything about where it goes.
  assertCan(viewer.actor, "assignment.write", {
    kind: "entry",
    userId: before.userId,
    projectId: before.projectId,
  });
  await requireAssignable(db, viewer, next);
  if (!row.published) {
    await db
      .update(assignment)
      .set({ ...next })
      .where(eq(assignment.id, row.id));
    return row.id;
  }
  return insertDraft(db, viewer, next, { replacesId: row.id });
}

export async function createAssignment(
  db: Database,
  viewer: Viewer,
  input: AssignmentInput,
): Promise<string> {
  return db.transaction((tx) => createIn(tx, viewer, input));
}

export async function updateAssignment(
  db: Database,
  viewer: Viewer,
  id: string,
  patch: AssignmentPatch,
): Promise<string> {
  return db.transaction((tx) => updateIn(tx, viewer, id, patch));
}

export async function deleteAssignment(db: Database, viewer: Viewer, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await workingRow(tx, viewer, id);
    assertCan(viewer.actor, "assignment.write", {
      kind: "entry",
      userId: row.userId,
      projectId: row.projectId,
    });
    if (row.published) {
      await insertDraft(tx, viewer, inputOf(row), { replacesId: row.id, deleted: true });
    } else if (row.replacesId) {
      await tx.update(assignment).set({ deleted: true }).where(eq(assignment.id, row.id));
    } else {
      await tx.delete(assignment).where(eq(assignment.id, row.id));
    }
  });
}

export async function copyAssignment(
  db: Database,
  viewer: Viewer,
  id: string,
  to: { userId?: string; startDate: string },
): Promise<string> {
  return db.transaction(async (tx) => {
    const row = await workingRow(tx, viewer, id);
    const moved = moveAssignment(shapeOf(row), to.startDate);
    const next = merge(inputOf(row), { ...moved, userId: to.userId ?? row.userId });
    return createIn(tx, viewer, next);
  });
}

export async function splitAssignmentAt(
  db: Database,
  viewer: Viewer,
  id: string,
  at: string,
): Promise<[string, string]> {
  return db.transaction(async (tx) => {
    const row = await workingRow(tx, viewer, id);
    const rules = await rulesFor(tx, viewer, inputOf(row));
    let parts: [AssignmentShape, AssignmentShape];
    try {
      parts = splitAssignment(shapeOf(row), at, rules);
    } catch (e) {
      if (e instanceof RangeError) throw new ScheduleError("INVALID", e.message);
      throw e;
    }
    const [first, second] = parts;
    const firstId = await updateIn(tx, viewer, row.id, {
      endDate: first.endDate,
      totalMinutes: first.totalMinutes,
    });
    const secondId = await createIn(tx, viewer, { ...inputOf(row), ...second });
    return [firstId, secondId];
  });
}
