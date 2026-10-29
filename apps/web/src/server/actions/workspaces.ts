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
import { z } from "zod";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import { workspaceRoutes } from "@/lib/routes";
import { getAuth } from "@/server/auth";
import { requireSession } from "@/server/session";
import { requireWorkspaceAccess, WorkspaceAccessError } from "@/server/workspace-access";
import { createWorkspace } from "@/server/workspaces";
import { authorize } from "@/server/authz";
import { countTasksWithoutGroup } from "@/server/catalog/tasks";
import { relabelWorkspaceCurrency, workspaceHasRates } from "@/server/rates";

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

const updateSettingsSchema = workspaceSettingsSchema.extend({
  name: workspaceNameSchema,
  /** The person saw that a new currency relabels rates without converting them. */
  confirmCurrencyChange: z.boolean().optional(),
  /** The person saw how many active tasks have no group before switching to "By group". */
  confirmTaskVisibility: z.boolean().optional(),
});
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
    const { name, confirmCurrencyChange, confirmTaskVisibility, ...settings } = parsed.data;

    const db = getDb();
    const newCurrency = settings.currency !== ctx.settings.currency;
    if (newCurrency && !confirmCurrencyChange && (await workspaceHasRates(db, ctx.workspace.id))) {
      const message = `Rates and amounts will show in ${settings.currency}; they are not converted.`;
      return fail(message, { currency: [message] });
    }
    // Decision 11, rule 1: switching tasks to "By group" says how many tasks nobody will see yet.
    const toByGroup =
      settings.taskVisibility === "BY_GROUP" && ctx.settings.taskVisibility !== "BY_GROUP";
    if (toByGroup && !confirmTaskVisibility) {
      const n = await countTasksWithoutGroup(db, ctx.workspace.id);
      const message =
        n === 0
          ? "Every active task already has a group."
          : `${n} active ${n === 1 ? "task has" : "tasks have"} no group yet. Members will not see ${n === 1 ? "it" : "them"} until a group is assigned.`;
      return fail(message, { taskVisibility: [message] });
    }
    await db.transaction(async (tx) => {
      await tx.update(workspace).set({ name }).where(eq(workspace.id, ctx.workspace.id));
      await tx
        .update(workspaceSettings)
        .set(settings)
        .where(eq(workspaceSettings.workspaceId, ctx.workspace.id));
      if (newCurrency) await relabelWorkspaceCurrency(tx, ctx.workspace.id, settings.currency);
    });

    revalidatePath(`/w/${slug}`, "layout");
    return ok({ slug });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return fail(error.message);
    throw error;
  }
}
