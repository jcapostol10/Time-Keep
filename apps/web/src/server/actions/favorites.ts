"use server";

import { pinFavoriteSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import type { FavoriteDTO } from "@/lib/favorite-types";
import { userErrorMessage } from "@/server/actions/errors";
import { authorize } from "@/server/authz";
import { pinFavorite, unpinFavorite } from "@/server/favorites";
import { requireWorkspaceAccess, type WorkspaceContext } from "@/server/workspace-access";

/** Favourites are the caller's own: the matrix's own-entry write right. */
async function ownScope(ctx: WorkspaceContext) {
  return authorize(ctx, "entry.write", { kind: "entry", userId: ctx.user.id, projectId: null });
}

export async function pinFavoriteAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<FavoriteDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await ownScope(ctx);
    const parsed = pinFavoriteSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await pinFavorite(getDb(), viewer, parsed.data));
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function unpinFavoriteAction(
  slug: string,
  id: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await ownScope(ctx);
    await unpinFavorite(getDb(), viewer, id);
    return ok({ id });
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}
