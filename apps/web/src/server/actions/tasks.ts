"use server";

import { taskInputSchema, taskPatchSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { revalidatePath } from "next/cache";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import type { TaskDTO } from "@/lib/catalog-types";
import { workspaceRoutes } from "@/lib/routes";
import { userErrorMessage } from "@/server/actions/errors";
import { createTask, deleteTask, updateTask } from "@/server/catalog/tasks";
import type { Viewer } from "@/server/catalog/viewer";
import { requireWorkspaceAccess } from "@/server/workspace-access";
import { viewerFor } from "@/server/authz";

/** Tasks are managed by admins only (decision 1 of the Phase 2 design). */

async function adminViewer(slug: string): Promise<Viewer> {
  const ctx = await requireWorkspaceAccess(slug, "admin");
  return await viewerFor(ctx);
}

export async function createTaskAction(
  slug: string,
  projectId: string,
  input: unknown,
): Promise<ActionResult<TaskDTO>> {
  try {
    const viewer = await adminViewer(slug);
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
    const viewer = await adminViewer(slug);
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
    const viewer = await adminViewer(slug);
    const result = await deleteTask(getDb(), viewer, taskId);
    revalidatePath(workspaceRoutes.projects(slug), "layout");
    return ok(result);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}
