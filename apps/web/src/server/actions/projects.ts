"use server";

import {
  deleteProjectSchema,
  projectInputSchema,
  projectMembersSchema,
  projectPatchSchema,
} from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import type { ProjectDetail } from "@/lib/catalog-types";
import { workspaceRoutes } from "@/lib/routes";
import type { PickerProject } from "@/lib/tracker-types";
import { CatalogError } from "@/server/catalog/errors";
import {
  createProject,
  deleteProject,
  setFavorite,
  setProjectMembers,
  setProjectsArchived,
  updateProject,
} from "@/server/catalog/projects";
import type { Viewer } from "@/server/catalog/viewer";
import { countProjectEntries } from "@/server/time-entries";
import { requireWorkspaceAccess, WorkspaceAccessError } from "@/server/workspace-access";

/** Projects are managed by admins only (decision 1 of the Phase 2 design); favourites are per member. */

function errorMessage(error: unknown): string {
  if (error instanceof WorkspaceAccessError) return error.message;
  if (error instanceof CatalogError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

async function adminViewer(slug: string): Promise<Viewer> {
  const ctx = await requireWorkspaceAccess(slug, "admin");
  return { workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role };
}

async function memberViewer(slug: string): Promise<Viewer> {
  const ctx = await requireWorkspaceAccess(slug);
  return { workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role };
}

function refresh(slug: string) {
  revalidatePath(workspaceRoutes.projects(slug));
  revalidatePath(workspaceRoutes.clients(slug));
}

/** Also the picker's inline create. */
export async function createProjectAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<PickerProject>> {
  try {
    const viewer = await adminViewer(slug);
    const parsed = projectInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const created = await createProject(getDb(), viewer, parsed.data);
    refresh(slug);
    return ok(created);
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function updateProjectAction(
  slug: string,
  projectId: string,
  input: unknown,
): Promise<ActionResult<ProjectDetail>> {
  try {
    const viewer = await adminViewer(slug);
    const parsed = projectPatchSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const updated = await updateProject(getDb(), viewer, projectId, parsed.data);
    refresh(slug);
    return ok(updated);
  } catch (error) {
    return fail(errorMessage(error));
  }
}

const idsSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) });

export async function archiveProjectsAction(
  slug: string,
  input: unknown,
  archived: boolean,
): Promise<ActionResult<number>> {
  try {
    const viewer = await adminViewer(slug);
    const parsed = idsSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const n = await setProjectsArchived(getDb(), viewer, parsed.data.ids, archived);
    refresh(slug);
    return ok(n);
  } catch (error) {
    return fail(errorMessage(error));
  }
}

/** Live entries on the project (any user), shown by the delete dialog. */
export async function countProjectEntriesAction(
  slug: string,
  projectId: string,
): Promise<ActionResult<number>> {
  try {
    const viewer = await adminViewer(slug);
    return ok(await countProjectEntries(getDb(), viewer.workspaceId, projectId));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function deleteProjectAction(
  slug: string,
  projectId: string,
  input: unknown,
): Promise<ActionResult<null>> {
  try {
    const viewer = await adminViewer(slug);
    const parsed = deleteProjectSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await deleteProject(getDb(), viewer, projectId, parsed.data);
    refresh(slug);
    return ok(null);
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function setProjectMembersAction(
  slug: string,
  projectId: string,
  input: unknown,
): Promise<ActionResult<null>> {
  try {
    const viewer = await adminViewer(slug);
    const parsed = projectMembersSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await setProjectMembers(getDb(), viewer, projectId, parsed.data.userIds);
    refresh(slug);
    return ok(null);
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function setFavoriteAction(
  slug: string,
  projectId: string,
  favorite: boolean,
): Promise<ActionResult<null>> {
  try {
    const viewer = await memberViewer(slug);
    await setFavorite(getDb(), viewer, projectId, favorite);
    refresh(slug);
    return ok(null);
  } catch (error) {
    return fail(errorMessage(error));
  }
}
