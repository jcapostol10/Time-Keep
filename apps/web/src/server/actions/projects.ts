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
import { userErrorMessage } from "@/server/actions/errors";
import {
  createProject,
  deleteProject,
  setFavorite,
  setProjectGroups,
  setProjectMembers,
  setProjectsArchived,
  updateProject,
} from "@/server/catalog/projects";
import { countProjectEntries } from "@/server/time-entries";
import { authorize, authorizeProject } from "@/server/authz";
import { requireWorkspaceAccess } from "@/server/workspace-access";

/**
 * Who may create and edit projects is the permission matrix's: admins
 * every project, a project's managers their own (not its deletion), anyone
 * the "who can create projects" setting allows a new one. Favourites are per
 * member.
 */

function refresh(slug: string) {
  revalidatePath(workspaceRoutes.projects(slug));
  revalidatePath(workspaceRoutes.clients(slug));
}

/**
 * Also the picker's inline create, so it does not revalidate any path: Next
 * would refresh the calling page (the tracker) under the open picker. The
 * Projects page refreshes itself after its dialog.
 */
export async function createProjectAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<PickerProject>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await authorize(ctx, "project.create", { kind: "project", projectId: null });
    const parsed = projectInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const created = await createProject(getDb(), viewer, parsed.data);
    return ok(created);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function updateProjectAction(
  slug: string,
  projectId: string,
  input: unknown,
): Promise<ActionResult<ProjectDetail>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await authorizeProject(ctx, "project.update", projectId);
    const parsed = projectPatchSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const updated = await updateProject(getDb(), viewer, projectId, parsed.data);
    refresh(slug);
    return ok(updated);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

const idsSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) });

export async function archiveProjectsAction(
  slug: string,
  input: unknown,
  archived: boolean,
): Promise<ActionResult<number>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const parsed = idsSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    let viewer = await authorize(ctx, "page.view", { kind: "page", page: "projects" });
    for (const id of parsed.data.ids) viewer = await authorizeProject(ctx, "project.update", id);
    const n = await setProjectsArchived(getDb(), viewer, parsed.data.ids, archived);
    refresh(slug);
    return ok(n);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

/** Live entries on the project (any user), shown by the delete dialog. */
export async function countProjectEntriesAction(
  slug: string,
  projectId: string,
): Promise<ActionResult<number>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await authorizeProject(ctx, "project.delete", projectId);
    return ok(await countProjectEntries(getDb(), viewer.workspaceId, projectId));
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function deleteProjectAction(
  slug: string,
  projectId: string,
  input: unknown,
): Promise<ActionResult<null>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await authorizeProject(ctx, "project.delete", projectId);
    const parsed = deleteProjectSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await deleteProject(getDb(), viewer, projectId, parsed.data);
    refresh(slug);
    return ok(null);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function setProjectMembersAction(
  slug: string,
  projectId: string,
  input: unknown,
): Promise<ActionResult<null>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await authorizeProject(ctx, "project.manageMembers", projectId);
    const parsed = projectMembersSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await setProjectMembers(getDb(), viewer, projectId, parsed.data.userIds);
    refresh(slug);
    return ok(null);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function setFavoriteAction(
  slug: string,
  projectId: string,
  favorite: boolean,
): Promise<ActionResult<null>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await authorizeProject(ctx, "project.view", projectId);
    await setFavorite(getDb(), viewer, projectId, favorite);
    refresh(slug);
    return ok(null);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

const projectGroupsSchema = z.object({ groupIds: z.array(z.string().min(1).max(64)).max(100) });

/** Groups whose members may see and track on a private project. */
export async function setProjectGroupsAction(
  slug: string,
  projectId: string,
  input: unknown,
): Promise<ActionResult<null>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await authorizeProject(ctx, "project.manageMembers", projectId);
    const parsed = projectGroupsSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await setProjectGroups(getDb(), viewer, projectId, parsed.data.groupIds);
    refresh(slug);
    return ok(null);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}
