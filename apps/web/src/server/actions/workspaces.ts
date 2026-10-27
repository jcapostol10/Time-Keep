"use server";

import {
  createWorkspaceSchema,
  workspaceNameSchema,
  workspaceSettingsSchema,
} from "@timekeep/core";
import { eq, getDb, workspace, workspaceSettings } from "@timekeep/db";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type z } from "zod";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import { workspaceRoutes } from "@/lib/routes";
import { getAuth } from "@/server/auth";
import { requireSession } from "@/server/session";
import { requireWorkspaceAccess, WorkspaceAccessError } from "@/server/workspace-access";
import { createWorkspace } from "@/server/workspaces";
import { authorize } from "@/server/authz";

export async function createWorkspaceAction(
  input: unknown,
): Promise<ActionResult<{ slug: string }>> {
  const session = await requireSession("/workspaces/new");
  const parsed = createWorkspaceSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const timezone = (session.user as { timezone?: string | null }).timezone ?? undefined;
  const created = await createWorkspace(getDb(), {
    name: parsed.data.name,
    ownerId: session.user.id,
    timezone,
  });

  await getAuth().api.setActiveOrganization({
    headers: await headers(),
    body: { organizationId: created.id },
  });

  return ok({ slug: created.slug });
}

/** Switch the session's active workspace, then go there. */
export async function switchWorkspaceAction(slug: string): Promise<never> {
  const ctx = await requireWorkspaceAccess(slug);
  await getAuth().api.setActiveOrganization({
    headers: await headers(),
    body: { organizationId: ctx.workspace.id },
  });
  redirect(workspaceRoutes.tracker(slug));
}

const updateSettingsSchema = workspaceSettingsSchema.extend({ name: workspaceNameSchema });
export type UpdateWorkspaceSettingsInput = z.infer<typeof updateSettingsSchema>;

export async function updateWorkspaceSettingsAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ slug: string }>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    await authorize(ctx, "workspace.update");
    const parsed = updateSettingsSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const { name, ...settings } = parsed.data;

    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.update(workspace).set({ name }).where(eq(workspace.id, ctx.workspace.id));
      await tx
        .update(workspaceSettings)
        .set(settings)
        .where(eq(workspaceSettings.workspaceId, ctx.workspace.id));
    });

    revalidatePath(`/w/${slug}`, "layout");
    return ok({ slug });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return fail(error.message);
    throw error;
  }
}
