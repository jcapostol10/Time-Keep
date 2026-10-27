"use server";

import { tagInputSchema, tagPatchSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { revalidatePath } from "next/cache";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import type { TagDTO } from "@/lib/catalog-types";
import { workspaceRoutes } from "@/lib/routes";
import type { EntryTag } from "@/lib/tracker-types";
import { userErrorMessage } from "@/server/actions/errors";
import { createTag, deleteTag, updateTag } from "@/server/catalog/tags";
import { authorize } from "@/server/authz";
import { requireWorkspaceAccess } from "@/server/workspace-access";

/** Who may create and edit tags is the permission matrix's (`tag.*`). */

/**
 * Also the tag picker's inline create; returns the picker's shape and does
 * not revalidate (that would refresh the tracker under the open picker).
 */
export async function createTagAction(
  slug: string,
  input: unknown,
  onDuplicate: "reuse" | "refuse" = "reuse",
): Promise<ActionResult<EntryTag>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    await authorize(ctx, "tag.create");
    const parsed = tagInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const created = await createTag(getDb(), ctx.workspace.id, parsed.data, { onDuplicate });
    return ok({ id: created.id, name: created.name, color: created.color });
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function updateTagAction(
  slug: string,
  tagId: string,
  input: unknown,
): Promise<ActionResult<TagDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    await authorize(ctx, "tag.update");
    const parsed = tagPatchSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const updated = await updateTag(getDb(), ctx.workspace.id, tagId, parsed.data);
    revalidatePath(workspaceRoutes.tags(slug));
    return ok(updated);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function deleteTagAction(
  slug: string,
  tagId: string,
): Promise<ActionResult<{ affectedEntries: number }>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    await authorize(ctx, "tag.update");
    const result = await deleteTag(getDb(), ctx.workspace.id, tagId);
    revalidatePath(workspaceRoutes.tags(slug));
    return ok(result);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}
