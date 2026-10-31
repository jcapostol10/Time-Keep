import "server-only";

import { randomUUID } from "node:crypto";

import { can, type TaskInput, type TaskPatch } from "@timekeep/core";
import {
  and,
  asc,
  type Database,
  eq,
  inArray,
  isNotNull,
  isNull,
  membership,
  or,
  project,
  projectGroup,
  sql,
  task,
  taskAssignee,
  taskGroup,
  timeEntry,
  userGroup,
} from "@timekeep/db";
import type { SQL } from "drizzle-orm";

import type { TaskAccessDTO, TaskDTO } from "@/lib/catalog-types";

import { assertCan, loadViewer } from "../authz";
import { CatalogError, isUniqueViolation } from "./errors";
import { requireVisibleProject } from "./projects";
import { type Viewer, visibleProjectFilter } from "./viewer";

type Executor = Pick<Database, "query" | "select" | "insert" | "update" | "delete" | "execute">;

const DUPLICATE_NAME = "A task with this name already exists in this project.";

type TaskRow = typeof task.$inferSelect & {
  assignees: { userId: string }[];
  groups: { groupId: string }[];
};

const taskRelations = {
  assignees: { columns: { userId: true } },
  groups: { columns: { groupId: true } },
} as const;

/** An active task as the pickers and the access lists see it (decision 11). */
export interface VisibleTask {
  id: string;
  projectId: string;
  name: string;
  groupIds: string[];
  /** Whether the viewer may track on it; always true unless tasks are by group. */
  visible: boolean;
}

/**
 * SQL for the tasks `viewer` may track on: none when every task is open to
 * them (everyone mode, owners, admins); otherwise the tasks of a group they
 * belong to, plus every task on a project they manage (rules 3, 6 and 7:
 * a task with no group matches nobody). Combine with the project filter.
 */
function taskVisibilityFilter(viewer: Viewer): SQL | undefined {
  // Whoever may track on a task with no group (owners, admins, everyone mode) sees all.
  // The probe is a task with no group on no project (an empty id matches no managed
  // project), so it answers yes only for roles and settings that see every task.
  const unfiltered = can(viewer.actor, "task.trackTime", {
    kind: "task",
    projectId: "",
    groupIds: [],
  });
  if (unfiltered) return undefined;
  const throughGroups = sql`EXISTS (SELECT 1 FROM "task_group" tg JOIN "user_group_member" gm ON gm."group_id" = tg."group_id" WHERE tg."task_id" = ${task.id} AND gm."user_id" = ${viewer.userId})`;
  const managed = [...viewer.actor.managedProjectIds];
  return managed.length > 0 ? or(inArray(task.projectId, managed), throughGroups) : throughGroups;
}

/**
 * The one source of member-facing task lists: ACTIVE tasks on the viewer's
 * visible, live, non-template projects, filtered by `taskVisibilityFilter`
 * (or marked by it with `includeHidden`). Ordered by project, then name.
 */
export async function visibleTasksFor(
  db: Executor,
  viewer: Viewer,
  opts: { projectIds?: string[]; includeHidden?: boolean } = {},
): Promise<VisibleTask[]> {
  if (opts.projectIds && opts.projectIds.length === 0) return [];
  const filter = taskVisibilityFilter(viewer);
  const rows = await db
    .select({
      id: task.id,
      projectId: task.projectId,
      name: task.name,
      groupIds: sql<
        string[]
      >`coalesce(array_agg(${taskGroup.groupId} ORDER BY ${taskGroup.groupId}) FILTER (WHERE ${taskGroup.groupId} IS NOT NULL), '{}')`,
      visible: filter ? sql<boolean>`(${filter})` : sql<boolean>`true`,
    })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .leftJoin(taskGroup, eq(taskGroup.taskId, task.id))
    .where(
      and(
        eq(task.workspaceId, viewer.workspaceId),
        eq(task.status, "ACTIVE"),
        eq(project.archived, false),
        eq(project.isTemplate, false),
        visibleProjectFilter(viewer),
        opts.projectIds ? inArray(task.projectId, opts.projectIds) : undefined,
        opts.includeHidden ? undefined : filter,
      ),
    )
    .groupBy(task.id, task.projectId, task.name, project.name)
    .orderBy(asc(project.name), asc(task.name));
  return rows.map((r) => ({ ...r, groupIds: [...r.groupIds], visible: Boolean(r.visible) }));
}

/** Tracked seconds and live entry counts per task of a project. */
async function usageByTask(
  db: Executor,
  projectId: string,
): Promise<Map<string, { seconds: number; entries: number }>> {
  const rows = await db
    .select({
      taskId: timeEntry.taskId,
      seconds: sql`coalesce(sum(${timeEntry.durationSeconds}), 0)::bigint`.mapWith(Number),
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
    groupIds: row.groups.map((g) => g.groupId).sort(),
    trackedSeconds: usage?.seconds ?? 0,
    entryCount: usage?.entries ?? 0,
  };
}

/** The task, if its project is visible to the viewer. */
async function requireVisibleTask(db: Executor, viewer: Viewer, taskId: string): Promise<TaskRow> {
  const row = await db.query.task.findFirst({
    where: and(eq(task.id, taskId), eq(task.workspaceId, viewer.workspaceId)),
    with: taskRelations,
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

/** The groups must be this workspace's. */
async function assertGroups(db: Executor, workspaceId: string, groupIds: string[]): Promise<void> {
  if (groupIds.length === 0) return;
  const rows = await db
    .select({ id: userGroup.id })
    .from(userGroup)
    .where(and(eq(userGroup.workspaceId, workspaceId), inArray(userGroup.id, groupIds)));
  if (rows.length !== groupIds.length) throw new CatalogError("INVALID", "Unknown group.");
}

/**
 * Rule 9: a group given a task on a PRIVATE project also gets the project's
 * access, in the same transaction. Removing the task never takes it away.
 */
async function grantProjectAccess(
  db: Executor,
  projectIds: string[],
  groupIds: string[],
): Promise<void> {
  if (projectIds.length === 0 || groupIds.length === 0) return;
  const privateProjects = await db
    .select({ id: project.id })
    .from(project)
    .where(and(inArray(project.id, projectIds), eq(project.visibility, "PRIVATE")));
  if (privateProjects.length === 0) return;
  await db
    .insert(projectGroup)
    .values(
      privateProjects.flatMap((p) => groupIds.map((groupId) => ({ projectId: p.id, groupId }))),
    )
    .onConflictDoNothing();
}

/**
 * Sets, adds or removes groups on tasks (decision 11), by someone with
 * `task.assignGroups` on every task's project: a manager's foreign project is
 * not found. One transaction; `add` and `set` apply rule 9.
 */
export async function setTaskGroups(
  db: Database,
  viewer: Viewer,
  taskIds: string[],
  groupIds: string[],
  mode: "add" | "remove" | "set",
): Promise<void> {
  const uniqueTasks = [...new Set(taskIds)];
  const uniqueGroups = [...new Set(groupIds)];
  if (uniqueTasks.length === 0) return;
  const rows = await db
    .select({ id: task.id, projectId: task.projectId })
    .from(task)
    .where(and(eq(task.workspaceId, viewer.workspaceId), inArray(task.id, uniqueTasks)));
  if (rows.length !== uniqueTasks.length) throw new CatalogError("NOT_FOUND", "Task not found.");
  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  for (const projectId of projectIds) {
    assertCan(viewer.actor, "task.assignGroups", { kind: "task", projectId });
  }
  await assertGroups(db, viewer.workspaceId, uniqueGroups);
  await db.transaction(async (tx) => {
    if (mode === "set") {
      await tx.delete(taskGroup).where(inArray(taskGroup.taskId, uniqueTasks));
    } else if (mode === "remove" && uniqueGroups.length > 0) {
      await tx
        .delete(taskGroup)
        .where(
          and(inArray(taskGroup.taskId, uniqueTasks), inArray(taskGroup.groupId, uniqueGroups)),
        );
    }
    if (mode !== "remove" && uniqueGroups.length > 0) {
      await tx
        .insert(taskGroup)
        .values(
          uniqueTasks.flatMap((taskId) =>
            uniqueGroups.map((groupId) => ({ taskId, groupId, assignedBy: viewer.userId })),
          ),
        )
        .onConflictDoNothing();
      await grantProjectAccess(tx, projectIds, uniqueGroups);
    }
  });
}

/**
 * A project's tasks, alphabetical, with their groups and tracked time. Whoever
 * edits the project's tasks (admins, its managers) sees every task, ACTIVE and
 * DONE; anyone else sees the active tasks `visibleTasksFor` gives them.
 */
export async function listTasks(
  db: Executor,
  viewer: Viewer,
  projectId: string,
): Promise<TaskDTO[]> {
  await requireVisibleProject(db, viewer, projectId);
  const rows = await db.query.task.findMany({
    where: eq(task.projectId, projectId),
    with: taskRelations,
    orderBy: asc(task.name),
  });
  const manages = can(viewer.actor, "task.update", { kind: "task", projectId });
  const listed = manages
    ? rows
    : await (async () => {
        const allowed = new Set(
          (await visibleTasksFor(db, viewer, { projectIds: [projectId] })).map((t) => t.id),
        );
        return rows.filter((r) => allowed.has(r.id));
      })();
  const usage = await usageByTask(db, projectId);
  return listed.map((r) => toDTO(r, usage.get(r.id)));
}

/** ACTIVE tasks on live, non-template projects that no group has yet (the "By group" confirmation). */
export async function countTasksWithoutGroup(db: Executor, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(task)
    .innerJoin(project, eq(project.id, task.projectId))
    .where(
      and(
        eq(task.workspaceId, workspaceId),
        eq(task.status, "ACTIVE"),
        eq(project.archived, false),
        eq(project.isTemplate, false),
        sql`NOT EXISTS (SELECT 1 FROM "task_group" tg WHERE tg."task_id" = ${task.id})`,
      ),
    );
  return row?.n ?? 0;
}

/** Project and group names for a list of visible tasks, grouped by project. */
async function toAccessDTO(
  db: Executor,
  workspaceId: string,
  tasks: VisibleTask[],
): Promise<TaskAccessDTO> {
  const projectIds = [...new Set(tasks.map((t) => t.projectId))];
  const groupIds = [...new Set(tasks.flatMap((t) => t.groupIds))];
  const [projects, groups] = await Promise.all([
    projectIds.length
      ? db
          .select({ id: project.id, name: project.name })
          .from(project)
          .where(and(eq(project.workspaceId, workspaceId), inArray(project.id, projectIds)))
      : Promise.resolve([]),
    groupIds.length
      ? db
          .select({ id: userGroup.id, name: userGroup.name })
          .from(userGroup)
          .where(and(eq(userGroup.workspaceId, workspaceId), inArray(userGroup.id, groupIds)))
      : Promise.resolve([]),
  ]);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const byProject = new Map<string, TaskAccessDTO["byProject"][number]>();
  for (const t of tasks) {
    const entry = byProject.get(t.projectId) ?? {
      projectId: t.projectId,
      projectName: projectName.get(t.projectId) ?? "",
      tasks: [],
    };
    entry.tasks.push({
      id: t.id,
      name: t.name,
      groupNames: t.groupIds.flatMap((g) => groupName.get(g) ?? []).sort(),
    });
    byProject.set(t.projectId, entry);
  }
  return {
    byProject: [...byProject.values()]
      .map((p) => ({ ...p, tasks: p.tasks.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.projectName.localeCompare(b.projectName)),
  };
}

/** The active tasks a group gives its members, by project (the Team page's "Tasks"). */
export async function listGroupTasks(
  db: Executor,
  viewer: Viewer,
  groupId: string,
): Promise<TaskAccessDTO> {
  assertCan(viewer.actor, "group.manage", { kind: "none" });
  const [group] = await db
    .select({ id: userGroup.id })
    .from(userGroup)
    .where(and(eq(userGroup.id, groupId), eq(userGroup.workspaceId, viewer.workspaceId)));
  if (!group) throw new CatalogError("NOT_FOUND", "Group not found.");
  const all = await visibleTasksFor(db, viewer, { includeHidden: true });
  return toAccessDTO(
    db,
    viewer.workspaceId,
    all.filter((t) => t.groupIds.includes(groupId)),
  );
}

/** The active tasks a member can see, by project (the Team page's "Tasks available"). */
export async function listTasksAvailableTo(
  db: Executor,
  viewer: Viewer,
  userId: string,
): Promise<TaskAccessDTO> {
  assertCan(viewer.actor, "group.manage", { kind: "none" });
  const [member] = await db
    .select({ status: membership.status })
    .from(membership)
    .where(and(eq(membership.workspaceId, viewer.workspaceId), eq(membership.userId, userId)));
  // Deactivated: the workspace is closed to them, so no task is available (rule 4).
  if (member?.status === "DEACTIVATED") return { byProject: [] };
  const target = await loadViewer(db, viewer.workspaceId, userId);
  return toAccessDTO(db, viewer.workspaceId, await visibleTasksFor(db, target));
}

export async function createTask(
  db: Database,
  viewer: Viewer,
  projectId: string,
  input: Omit<TaskInput, "groupIds"> & { groupIds?: string[] },
): Promise<TaskDTO> {
  await requireVisibleProject(db, viewer, projectId);
  assertCan(viewer.actor, "task.create", { kind: "task", projectId });
  const assigneeIds = [...new Set(input.assigneeIds)];
  await assertMembers(db, viewer.workspaceId, assigneeIds);
  const groupIds = [...new Set(input.groupIds ?? [])];
  // With tasks by group a task is never created without one (ruling R2 of the plan).
  if (viewer.actor.settings.taskVisibility === "BY_GROUP" && groupIds.length === 0) {
    throw new CatalogError("INVALID", "Pick at least one group.");
  }
  await assertGroups(db, viewer.workspaceId, groupIds);
  const id = randomUUID();
  // The task, its assignees and its groups land together or not at all.
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
    if (groupIds.length > 0) {
      await tx
        .insert(taskGroup)
        .values(groupIds.map((groupId) => ({ taskId: id, groupId, assignedBy: viewer.userId })));
      await grantProjectAccess(tx, [projectId], groupIds);
    }
    return toDTO(await requireVisibleTask(tx, viewer, id), undefined);
  });
}

export async function updateTask(
  db: Database,
  viewer: Viewer,
  taskId: string,
  patch: TaskPatch,
): Promise<TaskDTO> {
  const row = await requireVisibleTask(db, viewer, taskId);
  const assigneeIds = patch.assigneeIds === undefined ? undefined : [...new Set(patch.assigneeIds)];
  if (assigneeIds) await assertMembers(db, viewer.workspaceId, assigneeIds);
  const groupIds = patch.groupIds === undefined ? undefined : [...new Set(patch.groupIds)];
  if (groupIds) {
    assertCan(viewer.actor, "task.assignGroups", { kind: "task", projectId: row.projectId });
    await assertGroups(db, viewer.workspaceId, groupIds);
  }
  // Assignees, groups and the rename land together: a refused name must not leave new ones behind.
  await db.transaction(async (tx) => {
    if (assigneeIds) await replaceAssignees(tx, taskId, assigneeIds);
    const current = row.groups.map((g) => g.groupId).sort();
    const changed =
      groupIds !== undefined &&
      (groupIds.length !== current.length || [...groupIds].sort().some((g, i) => g !== current[i]));
    if (groupIds && changed) {
      await tx.delete(taskGroup).where(eq(taskGroup.taskId, taskId));
      if (groupIds.length > 0) {
        await tx
          .insert(taskGroup)
          .values(groupIds.map((groupId) => ({ taskId, groupId, assignedBy: viewer.userId })));
        await grantProjectAccess(tx, [row.projectId], groupIds);
      }
    }
    if (patch.name !== undefined || patch.status !== undefined) {
      try {
        await tx
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
  });
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
