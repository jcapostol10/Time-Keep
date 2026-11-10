"use server";

import { invoiceSettingsSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { type ActionResult, fromZodError, ok } from "@/lib/action-result";
import type { InvoiceSettingsDTO } from "@/lib/invoice-types";
import { catalogFailure } from "@/server/actions/errors";
import { authorize } from "@/server/authz";
import { updateInvoiceSettings } from "@/server/invoices/settings";
import { requireWorkspaceAccess } from "@/server/workspace-access";

/** Numbering and branding (Phase 6d): owners and admins. */
export async function updateInvoiceSettingsAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<InvoiceSettingsDTO>> {
  try {
    const viewer = await authorize(await requireWorkspaceAccess(slug), "invoice.manage");
    const parsed = invoiceSettingsSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await updateInvoiceSettings(getDb(), viewer, parsed.data));
  } catch (error) {
    return catalogFailure(error);
  }
}
