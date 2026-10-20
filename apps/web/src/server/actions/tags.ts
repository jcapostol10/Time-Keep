"use server";

import { tagInputSchema, tagPatchSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { revalidatePath } from "next/cache";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import type { TagDTO } from "@/lib/catalog-types";
import { workspaceRoutes } from "@/lib/routes";
import type { EntryTag } from "@/lib/tracker-types";
import { CatalogError } from "@/server/catalog/errors";
import { createTag, deleteTag, updateTag } from "@/server/catalog/tags";
import { requireWorkspaceAccess, WorkspaceAccessError } from "@/server/workspace-access";

/** Tags are managed by admins only (decision 1 of the Phase 2 design). */

function errorMessage(error: unknown): string {
  if (error instanceof WorkspaceAccessError) return error.message;
  if (error instanceof CatalogError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

/** Also the tag picker's inline create; returns the picker's shape. */
export async function createTagAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<EntryTag>> {
  try {
    const ctx = await requireWorkspaceAccess(slug, "admin");
    const parsed = tagInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const created = await createTag(getDb(), ctx.workspace.id, parsed.data);
    revalidatePath(workspaceRoutes.tags(slug));
    return ok({ id: created.id, name: created.name, color: created.color });
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function updateTagAction(
  slug: string,
  tagId: string,
  input: unknown,
): Promise<ActionResult<TagDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug, "admin");
    const parsed = tagPatchSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const updated = await updateTag(getDb(), ctx.workspace.id, tagId, parsed.data);
    revalidatePath(workspaceRoutes.tags(slug));
    return ok(updated);
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function deleteTagAction(
  slug: string,
  tagId: string,
): Promise<ActionResult<{ affectedEntries: number }>> {
  try {
    const ctx = await requireWorkspaceAccess(slug, "admin");
    const result = await deleteTag(getDb(), ctx.workspace.id, tagId);
    revalidatePath(workspaceRoutes.tags(slug));
    return ok(result);
  } catch (error) {
    return fail(errorMessage(error));
  }
}
