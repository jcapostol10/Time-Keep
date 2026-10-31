"use server";

import { taskGroupsSchema, taskInputSchema, taskPatchSchema } from "@timekeep/core";
import { and, eq, getDb, inArray, task } from "@timekeep/db";
import { revalidatePath } from "next/cache";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import type { TaskDTO } from "@/lib/catalog-types";
import { workspaceRoutes } from "@/lib/routes";
import { userErrorMessage } from "@/server/actions/errors";
import { authorize } from "@/server/authz";
import { CatalogError } from "@/server/catalog/errors";
import { createTask, deleteTask, setTaskGroups, updateTask } from "@/server/catalog/tasks";
import type { Viewer } from "@/server/catalog/viewer";
import { requireWorkspaceAccess } from "@/server/workspace-access";

/** Admins manage every project's tasks, a project's managers its own (decision 11). */
async function taskViewer(
  slug: string,
  action: "task.create" | "task.update" | "task.assignGroups",
  target: { projectId: string } | { taskId: string },
): Promise<Viewer> {
  const ctx = await requireWorkspaceAccess(slug);
  let projectId: string;
  if ("taskId" in target) {
    const row = await getDb().query.task.findFirst({
      where: and(eq(task.id, target.taskId), eq(task.workspaceId, ctx.workspace.id)),
      columns: { projectId: true },
    });
    if (!row) throw new CatalogError("NOT_FOUND", "Task not found.");
    projectId = row.projectId;
  } else {
    projectId = target.projectId;
  }
  return authorize(ctx, action, { kind: "task", projectId });
}

export async function createTaskAction(
  slug: string,
  projectId: string,
  input: unknown,
): Promise<ActionResult<TaskDTO>> {
  try {
    const viewer = await taskViewer(slug, "task.create", { projectId });
    const parsed = taskInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const created = await createTask(getDb(), viewer, projectId, parsed.data);
    revalidatePath(workspaceRoutes.project(slug, projectId));
    return ok(created);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function updateTaskAction(
  slug: string,
  taskId: string,
  input: unknown,
): Promise<ActionResult<TaskDTO>> {
  try {
    const viewer = await taskViewer(slug, "task.update", { taskId });
    const parsed = taskPatchSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const updated = await updateTask(getDb(), viewer, taskId, parsed.data);
    revalidatePath(workspaceRoutes.project(slug, updated.projectId));
    return ok(updated);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

/** The Tasks tab's multi-select: groups on several tasks of one project at once. */
export async function setTaskGroupsAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ updated: number }>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const parsed = taskGroupsSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const rows = await getDb()
      .select({ projectId: task.projectId })
      .from(task)
      .where(and(eq(task.workspaceId, ctx.workspace.id), inArray(task.id, parsed.data.taskIds)));
    if (rows.length === 0) throw new CatalogError("NOT_FOUND", "Task not found.");
    const [first, ...others] = [...new Set(rows.map((r) => r.projectId))];
    const viewer = await authorize(ctx, "task.assignGroups", { kind: "task", projectId: first! });
    for (const projectId of others) {
      await authorize(ctx, "task.assignGroups", { kind: "task", projectId });
    }
    const projectIds = [first!, ...others];
    await setTaskGroups(
      getDb(),
      viewer,
      parsed.data.taskIds,
      parsed.data.groupIds,
      parsed.data.mode,
    );
    for (const projectId of projectIds) revalidatePath(workspaceRoutes.project(slug, projectId));
    return ok({ updated: parsed.data.taskIds.length });
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function deleteTaskAction(
  slug: string,
  taskId: string,
): Promise<ActionResult<{ affectedEntries: number }>> {
  try {
    const viewer = await taskViewer(slug, "task.update", { taskId });
    const result = await deleteTask(getDb(), viewer, taskId);
    revalidatePath(workspaceRoutes.projects(slug), "layout");
    return ok(result);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}
