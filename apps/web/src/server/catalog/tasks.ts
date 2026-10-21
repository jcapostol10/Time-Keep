import "server-only";

import { randomUUID } from "node:crypto";

import type { TaskInput, TaskPatch } from "@timekeep/core";
import {
  and,
  asc,
  type Database,
  eq,
  inArray,
  isNotNull,
  isNull,
  membership,
  sql,
  task,
  taskAssignee,
  timeEntry,
} from "@timekeep/db";

import type { TaskDTO } from "@/lib/catalog-types";

import { CatalogError, isUniqueViolation } from "./errors";
import { requireVisibleProject } from "./projects";
import type { Viewer } from "./viewer";

type Executor = Pick<Database, "query" | "select" | "insert" | "update" | "delete" | "execute">;

const DUPLICATE_NAME = "A task with this name already exists in this project.";

type TaskRow = typeof task.$inferSelect & { assignees: { userId: string }[] };

/** Tracked seconds and live entry counts per task of a project. */
async function usageByTask(
  db: Executor,
  projectId: string,
): Promise<Map<string, { seconds: number; entries: number }>> {
  const rows = await db
    .select({
      taskId: timeEntry.taskId,
      seconds: sql<number>`coalesce(sum(${timeEntry.durationSeconds}), 0)::int`,
      entries: sql<number>`count(*)::int`,
    })
    .from(timeEntry)
    .where(
      and(
        eq(timeEntry.projectId, projectId),
        isNotNull(timeEntry.taskId),
        isNull(timeEntry.deletedAt),
      ),
    )
    .groupBy(timeEntry.taskId);
  return new Map(
    rows.flatMap((r) =>
      r.taskId ? [[r.taskId, { seconds: r.seconds, entries: r.entries }] as const] : [],
    ),
  );
}

function toDTO(row: TaskRow, usage: { seconds: number; entries: number } | undefined): TaskDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    status: row.status,
    assigneeIds: row.assignees.map((a) => a.userId).sort(),
    trackedSeconds: usage?.seconds ?? 0,
    entryCount: usage?.entries ?? 0,
  };
}

/** The task, if its project is visible to the viewer. */
async function requireVisibleTask(db: Executor, viewer: Viewer, taskId: string): Promise<TaskRow> {
  const row = await db.query.task.findFirst({
    where: and(eq(task.id, taskId), eq(task.workspaceId, viewer.workspaceId)),
    with: { assignees: { columns: { userId: true } } },
  });
  if (!row) throw new CatalogError("NOT_FOUND", "Task not found.");
  try {
    await requireVisibleProject(db, viewer, row.projectId);
  } catch {
    throw new CatalogError("NOT_FOUND", "Task not found.");
  }
  return row;
}

async function assertMembers(db: Executor, workspaceId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const rows = await db
    .select({ userId: membership.userId })
    .from(membership)
    .where(
      and(
        eq(membership.workspaceId, workspaceId),
        inArray(membership.userId, userIds),
        eq(membership.status, "ACTIVE"),
      ),
    );
  if (rows.length !== userIds.length) {
    throw new CatalogError("INVALID", "Only workspace members can be assigned.");
  }
}

async function replaceAssignees(db: Executor, taskId: string, userIds: string[]): Promise<void> {
  await db.delete(taskAssignee).where(eq(taskAssignee.taskId, taskId));
  if (userIds.length > 0) {
    await db.insert(taskAssignee).values(userIds.map((userId) => ({ taskId, userId })));
  }
}

/** A project's tasks, alphabetical, with assignees and tracked time. */
export async function listTasks(
  db: Executor,
  viewer: Viewer,
  projectId: string,
): Promise<TaskDTO[]> {
  await requireVisibleProject(db, viewer, projectId);
  const rows = await db.query.task.findMany({
    where: eq(task.projectId, projectId),
    with: { assignees: { columns: { userId: true } } },
    orderBy: asc(task.name),
  });
  const usage = await usageByTask(db, projectId);
  return rows.map((r) => toDTO(r, usage.get(r.id)));
}

export async function createTask(
  db: Database,
  viewer: Viewer,
  projectId: string,
  input: TaskInput,
): Promise<TaskDTO> {
  await requireVisibleProject(db, viewer, projectId);
  const assigneeIds = [...new Set(input.assigneeIds)];
  await assertMembers(db, viewer.workspaceId, assigneeIds);
  const id = randomUUID();
  // The task and its assignees land together or not at all.
  return db.transaction(async (tx) => {
    try {
      await tx.insert(task).values({
        id,
        workspaceId: viewer.workspaceId,
        projectId,
        name: input.name.trim(),
      });
    } catch (error) {
      if (isUniqueViolation(error, "task_project_name_uq")) {
        throw new CatalogError("CONFLICT", DUPLICATE_NAME);
      }
      throw error;
    }
    await replaceAssignees(tx, id, assigneeIds);
    return toDTO(await requireVisibleTask(tx, viewer, id), undefined);
  });
}

export async function updateTask(
  db: Executor,
  viewer: Viewer,
  taskId: string,
  patch: TaskPatch,
): Promise<TaskDTO> {
  const row = await requireVisibleTask(db, viewer, taskId);
  if (patch.assigneeIds !== undefined) {
    const assigneeIds = [...new Set(patch.assigneeIds)];
    await assertMembers(db, viewer.workspaceId, assigneeIds);
    await replaceAssignees(db, taskId, assigneeIds);
  }
  if (patch.name !== undefined || patch.status !== undefined) {
    try {
      await db
        .update(task)
        .set({
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        })
        .where(eq(task.id, taskId));
    } catch (error) {
      if (isUniqueViolation(error, "task_project_name_uq")) {
        throw new CatalogError("CONFLICT", DUPLICATE_NAME);
      }
      throw error;
    }
  }
  const usage = await usageByTask(db, row.projectId);
  return toDTO(await requireVisibleTask(db, viewer, taskId), usage.get(taskId));
}

/** Deletes a task; its entries stay on the project with no task (FK SET NULL). */
export async function deleteTask(
  db: Executor,
  viewer: Viewer,
  taskId: string,
): Promise<{ affectedEntries: number }> {
  await requireVisibleTask(db, viewer, taskId);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(timeEntry)
    .where(and(eq(timeEntry.taskId, taskId), isNull(timeEntry.deletedAt)));
  await db.delete(task).where(eq(task.id, taskId));
  return { affectedEntries: row?.n ?? 0 };
}
