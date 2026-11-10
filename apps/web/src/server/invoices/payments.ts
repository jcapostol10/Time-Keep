import "server-only";

import { randomUUID } from "node:crypto";

import type { PaymentInput } from "@timekeep/core";
import { and, type Database, eq, payment, sql } from "@timekeep/db";

import type { InvoiceDTO } from "@/lib/invoice-types";

import { CatalogError } from "../catalog/errors";
import type { Viewer } from "../catalog/viewer";
import { findOwned, getInvoice, requireManage } from "./read";

/** Payments (decision 26): on a sent invoice, never past the balance; the status follows. */

export async function addPayment(
  db: Database,
  viewer: Viewer,
  id: string,
  input: PaymentInput,
  now: Date = new Date(),
): Promise<InvoiceDTO> {
  requireManage(viewer);
  await db.transaction(async (tx) => {
    const row = await findOwned(tx, viewer.workspaceId, id, true);
    if (row.status !== "SENT") {
      throw new CatalogError("INVALID", "Only a sent invoice takes payments.");
    }
    const [paid] = await tx
      .select({ sum: sql`coalesce(sum(${payment.amountMinor}), 0)::bigint`.mapWith(Number) })
      .from(payment)
      .where(eq(payment.invoiceId, id));
    if ((paid?.sum ?? 0) + input.amountMinor > row.totalMinor) {
      throw new CatalogError("INVALID", "This payment is more than the balance.");
    }
    await tx.insert(payment).values({
      id: randomUUID(),
      invoiceId: id,
      date: input.date,
      amountMinor: input.amountMinor,
      note: input.note,
      createdBy: viewer.userId,
    });
  });
  return getInvoice(db, viewer, id, now);
}

export async function removePayment(
  db: Database,
  viewer: Viewer,
  id: string,
  paymentId: string,
  now: Date = new Date(),
): Promise<InvoiceDTO> {
  requireManage(viewer);
  await db.transaction(async (tx) => {
    await findOwned(tx, viewer.workspaceId, id, true);
    const rows = await tx
      .delete(payment)
      .where(and(eq(payment.id, paymentId), eq(payment.invoiceId, id)))
      .returning({ id: payment.id });
    if (rows.length === 0) throw new CatalogError("NOT_FOUND", "Payment not found.");
  });
  return getInvoice(db, viewer, id, now);
}
