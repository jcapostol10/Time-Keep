"use server";

import { clientInputSchema, clientPatchSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { revalidatePath } from "next/cache";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import type { ClientDTO } from "@/lib/catalog-types";
import { workspaceRoutes } from "@/lib/routes";
import { createClient, deleteClient, updateClient } from "@/server/catalog/clients";
import { CatalogError } from "@/server/catalog/errors";
import { requireWorkspaceAccess, WorkspaceAccessError } from "@/server/workspace-access";

/** Clients are managed by admins only (decision 1 of the Phase 2 design). */

function errorMessage(error: unknown): string {
  if (error instanceof WorkspaceAccessError) return error.message;
  if (error instanceof CatalogError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export async function createClientAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<ClientDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug, "admin");
    const parsed = clientInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const created = await createClient(getDb(), ctx.workspace.id, parsed.data);
    revalidatePath(workspaceRoutes.clients(slug));
    return ok(created);
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function updateClientAction(
  slug: string,
  clientId: string,
  input: unknown,
): Promise<ActionResult<ClientDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug, "admin");
    const parsed = clientPatchSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const updated = await updateClient(getDb(), ctx.workspace.id, clientId, parsed.data);
    revalidatePath(workspaceRoutes.clients(slug));
    return ok(updated);
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function deleteClientAction(
  slug: string,
  clientId: string,
): Promise<ActionResult<null>> {
  try {
    const ctx = await requireWorkspaceAccess(slug, "admin");
    await deleteClient(getDb(), ctx.workspace.id, clientId);
    revalidatePath(workspaceRoutes.clients(slug));
    return ok(null);
  } catch (error) {
    return fail(errorMessage(error));
  }
}
