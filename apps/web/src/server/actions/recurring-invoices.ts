"use server";

import { recurringInvoiceSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { type ActionResult, fromZodError, ok } from "@/lib/action-result";
import type { RecurringInvoiceDTO } from "@/lib/invoice-types";
import { catalogFailure } from "@/server/actions/errors";
import { authorize } from "@/server/authz";
import { createRecurring, deleteRecurring, updateRecurring } from "@/server/invoices/recurring";
import { requireWorkspaceAccess } from "@/server/workspace-access";

/** Recurring invoice templates (Phase 6d): owners and admins. */

export async function createRecurringAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<RecurringInvoiceDTO>> {
  try {
    const viewer = await authorize(await requireWorkspaceAccess(slug), "invoice.manage");
    const parsed = recurringInvoiceSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await createRecurring(getDb(), viewer, parsed.data));
  } catch (error) {
    return catalogFailure(error);
  }
}

export async function updateRecurringAction(
  slug: string,
  id: string,
  input: unknown,
): Promise<ActionResult<RecurringInvoiceDTO>> {
  try {
    const viewer = await authorize(await requireWorkspaceAccess(slug), "invoice.manage");
    const parsed = recurringInvoiceSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await updateRecurring(getDb(), viewer, id, parsed.data));
  } catch (error) {
    return catalogFailure(error);
  }
}

export async function deleteRecurringAction(slug: string, id: string): Promise<ActionResult> {
  try {
    const viewer = await authorize(await requireWorkspaceAccess(slug), "invoice.manage");
    await deleteRecurring(getDb(), viewer, id);
    return ok(undefined);
  } catch (error) {
    return catalogFailure(error);
  }
}
