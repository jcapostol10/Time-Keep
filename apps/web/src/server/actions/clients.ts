"use server";

import { can, clientInputSchema, clientPatchSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import type { ClientDTO } from "@/lib/catalog-types";
import { workspaceRoutes } from "@/lib/routes";
import { catalogFailure, userErrorMessage } from "@/server/actions/errors";
import { createClient, deleteClient, updateClient } from "@/server/catalog/clients";
import { authorize } from "@/server/authz";
import { requireWorkspaceAccess } from "@/server/workspace-access";

/** Who may create and edit clients is the permission matrix's (`client.*`). */

const updateClientSchema = clientPatchSchema.extend({
  /** The person saw that a new currency relabels the projects' rates without converting them. */
  confirmCurrencyChange: z.boolean().optional(),
});

export async function createClientAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<ClientDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await authorize(ctx, "client.create");
    const parsed = clientInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    // What a client is billed in is for owners and admins, whoever may create clients.
    const currency = can(viewer.actor, "client.update", { kind: "none" })
      ? parsed.data.currency
      : null;
    const created = await createClient(getDb(), ctx.workspace.id, { ...parsed.data, currency });
    revalidatePath(workspaceRoutes.clients(slug));
    return ok(created);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function updateClientAction(
  slug: string,
  clientId: string,
  input: unknown,
): Promise<ActionResult<ClientDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    await authorize(ctx, "client.update");
    const parsed = updateClientSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const { confirmCurrencyChange, ...patch } = parsed.data;
    const updated = await updateClient(getDb(), ctx.workspace.id, clientId, patch, {
      confirmCurrencyChange,
    });
    // A relabel shows wherever money does.
    revalidatePath(`/w/${slug}`, "layout");
    return ok(updated);
  } catch (error) {
    return catalogFailure(error);
  }
}

export async function deleteClientAction(
  slug: string,
  clientId: string,
): Promise<ActionResult<null>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    await authorize(ctx, "client.update");
    await deleteClient(getDb(), ctx.workspace.id, clientId);
    revalidatePath(workspaceRoutes.clients(slug));
    return ok(null);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}
