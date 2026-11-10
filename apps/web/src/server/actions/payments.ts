"use server";

import { paymentInputSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { type ActionResult, fromZodError, ok } from "@/lib/action-result";
import type { InvoiceDTO } from "@/lib/invoice-types";
import { catalogFailure } from "@/server/actions/errors";
import { authorize } from "@/server/authz";
import { addPayment, removePayment } from "@/server/invoices/payments";
import { requireWorkspaceAccess } from "@/server/workspace-access";

/** Payments on a sent invoice (Phase 6d): owners and admins. */

export async function addPaymentAction(
  slug: string,
  invoiceId: string,
  input: unknown,
): Promise<ActionResult<InvoiceDTO>> {
  try {
    const viewer = await authorize(await requireWorkspaceAccess(slug), "invoice.manage");
    const parsed = paymentInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await addPayment(getDb(), viewer, invoiceId, parsed.data));
  } catch (error) {
    return catalogFailure(error);
  }
}

export async function removePaymentAction(
  slug: string,
  invoiceId: string,
  paymentId: string,
): Promise<ActionResult<InvoiceDTO>> {
  try {
    const viewer = await authorize(await requireWorkspaceAccess(slug), "invoice.manage");
    return ok(await removePayment(getDb(), viewer, invoiceId, paymentId));
  } catch (error) {
    return catalogFailure(error);
  }
}
