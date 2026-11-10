"use server";

import {
  invoiceCreateSchema,
  invoiceImportSchema,
  invoiceLineSchema,
  invoicePatchSchema,
  reorderLinesSchema,
  sendInvoiceSchema,
} from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { type ActionResult, fromZodError, ok } from "@/lib/action-result";
import type { InvoiceDTO } from "@/lib/invoice-types";
import { catalogFailure } from "@/server/actions/errors";
import { authorize } from "@/server/authz";
import { importIntoInvoice } from "@/server/invoices/import";
import {
  addManualLine,
  createInvoice,
  deleteInvoice,
  removeLine,
  reorderLines,
  sendInvoice,
  updateInvoice,
  updateLine,
  voidInvoice,
} from "@/server/invoices/invoices";
import { requireWorkspaceAccess } from "@/server/workspace-access";

/** Invoices (Phase 6d): owners and admins (`invoice.manage`). */

async function managerOf(slug: string) {
  return authorize(await requireWorkspaceAccess(slug), "invoice.manage");
}

export async function createInvoiceAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<InvoiceDTO>> {
  try {
    const viewer = await authorize(await requireWorkspaceAccess(slug), "invoice.manage");
    const parsed = invoiceCreateSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await createInvoice(getDb(), viewer, parsed.data));
  } catch (error) {
    return catalogFailure(error);
  }
}

export async function updateInvoiceAction(
  slug: string,
  invoiceId: string,
  input: unknown,
): Promise<ActionResult<InvoiceDTO>> {
  try {
    const viewer = await managerOf(slug);
    const parsed = invoicePatchSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await updateInvoice(getDb(), viewer, invoiceId, parsed.data));
  } catch (error) {
    return catalogFailure(error);
  }
}

export async function addLineAction(
  slug: string,
  invoiceId: string,
  input: unknown,
): Promise<ActionResult<InvoiceDTO>> {
  try {
    const viewer = await managerOf(slug);
    const parsed = invoiceLineSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await addManualLine(getDb(), viewer, invoiceId, parsed.data));
  } catch (error) {
    return catalogFailure(error);
  }
}

export async function updateLineAction(
  slug: string,
  invoiceId: string,
  lineId: string,
  input: unknown,
): Promise<ActionResult<InvoiceDTO>> {
  try {
    const viewer = await managerOf(slug);
    const parsed = invoiceLineSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await updateLine(getDb(), viewer, invoiceId, lineId, parsed.data));
  } catch (error) {
    return catalogFailure(error);
  }
}

export async function removeLineAction(
  slug: string,
  invoiceId: string,
  lineId: string,
): Promise<ActionResult<InvoiceDTO>> {
  try {
    const viewer = await managerOf(slug);
    return ok(await removeLine(getDb(), viewer, invoiceId, lineId));
  } catch (error) {
    return catalogFailure(error);
  }
}

export async function reorderLinesAction(
  slug: string,
  invoiceId: string,
  input: unknown,
): Promise<ActionResult<InvoiceDTO>> {
  try {
    const viewer = await managerOf(slug);
    const parsed = reorderLinesSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await reorderLines(getDb(), viewer, invoiceId, parsed.data.lineIds));
  } catch (error) {
    return catalogFailure(error);
  }
}

export async function importTimeAction(
  slug: string,
  invoiceId: string,
  input: unknown,
): Promise<ActionResult<InvoiceDTO>> {
  try {
    const viewer = await managerOf(slug);
    const parsed = invoiceImportSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await importIntoInvoice(getDb(), viewer, invoiceId, parsed.data));
  } catch (error) {
    return catalogFailure(error);
  }
}

export async function sendInvoiceAction(
  slug: string,
  invoiceId: string,
  input: unknown,
): Promise<ActionResult<InvoiceDTO>> {
  try {
    const viewer = await managerOf(slug);
    const parsed = sendInvoiceSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const sent = await sendInvoice(getDb(), viewer, invoiceId, { email: parsed.data.email });
    if (parsed.data.email) {
      const { drainSoon } = await import("@/server/outbox-after");
      drainSoon();
    }
    return ok(sent);
  } catch (error) {
    return catalogFailure(error);
  }
}

export async function voidInvoiceAction(
  slug: string,
  invoiceId: string,
): Promise<ActionResult<InvoiceDTO>> {
  try {
    const viewer = await managerOf(slug);
    return ok(await voidInvoice(getDb(), viewer, invoiceId));
  } catch (error) {
    return catalogFailure(error);
  }
}

export async function deleteInvoiceAction(slug: string, invoiceId: string): Promise<ActionResult> {
  try {
    const viewer = await managerOf(slug);
    await deleteInvoice(getDb(), viewer, invoiceId);
    return ok(undefined);
  } catch (error) {
    return catalogFailure(error);
  }
}
