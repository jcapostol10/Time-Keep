"use server";

import { taskInputSchema, taskPatchSchema } from "@timekeep/core";
import { and, eq, getDb, task } from "@timekeep/db";
import { revalidatePath } from "next/cache";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import type { TaskDTO } from "@/lib/catalog-types";
import { workspaceRoutes } from "@/lib/routes";
import { userErrorMessage } from "@/server/actions/errors";
import { authorize } from "@/server/authz";
import { CatalogError } from "@/server/catalog/errors";
import { createTask, deleteTask, updateTask } from "@/server/catalog/tasks";
import type { Viewer } from "@/server/catalog/viewer";
import { requireWorkspaceAccess } from "@/server/workspace-access";

/**
 * Admins manage every project's tasks, a project's managers its own (and
 * whoever the workspace's "who can create tasks" setting allows may add them).
 */
async function taskViewer(
  slug: string,
  action: "task.create" | "task.update",
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
