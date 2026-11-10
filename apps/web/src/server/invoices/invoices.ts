import "server-only";

import { randomUUID } from "node:crypto";

import {
  addDaysToKey,
  DUE_BEFORE_ISSUE_MESSAGE,
  formatMoney,
  type InvoiceCreateInput,
  type InvoiceLineInput,
  type InvoicePatch,
  invoiceTotals,
  lineAmount,
} from "@timekeep/core";
import {
  and,
  asc,
  client,
  type Database,
  type DbExecutor,
  eq,
  type Invoice,
  invoice,
  invoiceItem,
  sql,
} from "@timekeep/db";

import type { InvoiceDTO } from "@/lib/invoice-types";

import { CatalogError, isUniqueViolation } from "../catalog/errors";
import type { Viewer } from "../catalog/viewer";
import { env } from "../env";
import { releaseExpensesInvoiced } from "../expenses";
import { enqueueEmail } from "../outbox";
import { uploadExport } from "../storage";
import { releaseInvoiced } from "../time-entries";
import { invoiceSentEmail } from "./emails";
import { buildInvoicePdf } from "./pdf";
import { findOwned, getInvoice, listInvoices, loadDTO, requireManage } from "./read";
import { invoiceWorkspace, readInvoiceSettings, takeInvoiceNumber } from "./settings";
import { hashInvoiceToken, newInvoiceToken, publicInvoicePath } from "./tokens";

export { getInvoice, listInvoices };

/**
 * The invoice service (Phase 6d, decisions 20–24): the only writer of
 * `invoice`, `invoice_item` and (through `payments.ts`) `payment`. Time and
 * expenses are marked through the entry and expense services. A draft is
 * edited; a sent invoice keeps its lines, its number and its PDF and takes
 * payments; a void one releases what it billed.
 */

type Executor = DbExecutor;

export const DRAFT_ONLY = "Only a draft can be changed.";
const ALREADY_SENT = "This invoice was already sent.";
const IS_VOID = "This invoice is void.";

/** One import per client at a time (decision 23): a transaction-scoped advisory lock. */
export function clientLock(clientId: string) {
  return sql`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${clientId}`}))`;
}

/** The lines' sum through core `invoiceTotals`, cached on the row for the list. */
export async function recomputeTotals(tx: Executor, id: string): Promise<void> {
  const [inv] = await tx
    .select({
      discountBps: invoice.discountBps,
      tax1Bps: invoice.tax1Bps,
      tax2Bps: invoice.tax2Bps,
    })
    .from(invoice)
    .where(eq(invoice.id, id));
  if (!inv) return;
  const lines = await tx
    .select({ amountMinor: invoiceItem.amountMinor })
    .from(invoiceItem)
    .where(eq(invoiceItem.invoiceId, id));
  const totals = invoiceTotals(lines, inv);
  await tx
    .update(invoice)
    .set({ subtotalMinor: totals.subtotalMinor, totalMinor: totals.totalMinor })
    .where(eq(invoice.id, id));
}

/** The position after the last line. */
export async function nextPosition(tx: Executor, id: string): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number>`coalesce(max(${invoiceItem.position}), 0)::int` })
    .from(invoiceItem)
    .where(eq(invoiceItem.invoiceId, id));
  return (row?.max ?? 0) + 1;
}

/** The row locked for a change that only a draft takes. */
async function lockDraft(tx: Executor, workspaceId: string, id: string): Promise<Invoice> {
  const row = await findOwned(tx, workspaceId, id, true);
  if (row.status !== "DRAFT") throw new CatalogError("INVALID", DRAFT_ONLY);
  return row;
}

/**
 * A new draft for a live client: the client's currency (else the workspace's),
 * the next number under the sequence lock, the due date from the payment
 * terms, the default taxes and notes. For the service and the recurring job.
 */
export async function createInvoiceRow(
  tx: Executor,
  args: {
    workspaceId: string;
    clientId: string;
    createdBy: string | null;
    issueDate: string;
    dueDate?: string;
    recurringId?: string;
    periodKey?: string;
  },
): Promise<string> {
  const [c] = await tx
    .select({ id: client.id, currency: client.currency, archived: client.archived })
    .from(client)
    .where(and(eq(client.id, args.clientId), eq(client.workspaceId, args.workspaceId)));
  if (!c) throw new CatalogError("NOT_FOUND", "Client not found.");
  if (c.archived) throw new CatalogError("INVALID", "This client is archived.");
  const settings = await readInvoiceSettings(tx, args.workspaceId);
  const ws = await invoiceWorkspace(tx, args.workspaceId);
  const dueDate = args.dueDate ?? addDaysToKey(args.issueDate, settings.paymentTermsDays);
  if (dueDate < args.issueDate) throw new CatalogError("INVALID", DUE_BEFORE_ISSUE_MESSAGE);
  const number = await takeInvoiceNumber(tx, args.workspaceId);
  const id = randomUUID();
  try {
    await tx.insert(invoice).values({
      id,
      workspaceId: args.workspaceId,
      clientId: args.clientId,
      number,
      issueDate: args.issueDate,
      dueDate,
      currency: c.currency ?? ws.currency,
      tax1Name: settings.tax1Name,
      tax1Bps: settings.tax1Bps,
      tax2Name: settings.tax2Name,
      tax2Bps: settings.tax2Bps,
      notes: settings.notes,
      recurringId: args.recurringId ?? null,
      periodKey: args.periodKey ?? null,
      createdBy: args.createdBy,
    });
  } catch (error) {
    if (isUniqueViolation(error, "invoice_workspace_number_uq")) {
      throw new CatalogError(
        "CONFLICT",
        `Invoice number ${number} is already used. Change the next number in Settings.`,
      );
    }
    throw error;
  }
  return id;
}

export async function createInvoice(
  db: Database,
  viewer: Viewer,
  input: InvoiceCreateInput,
  now: Date = new Date(),
): Promise<InvoiceDTO> {
  requireManage(viewer);
  const id = await db.transaction((tx) =>
    createInvoiceRow(tx, {
      workspaceId: viewer.workspaceId,
      clientId: input.clientId,
      createdBy: viewer.userId,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
    }),
  );
  return getInvoice(db, viewer, id, now);
}

const AFTER_SEND = new Set<keyof InvoicePatch>(["notes", "externalRef"]);

/**
 * A draft takes every field; a sent or void invoice only its notes and the
 * accounting reference. A tax applies only with both a name and a rate.
 */
export async function updateInvoice(
  db: Database,
  viewer: Viewer,
  id: string,
  patch: InvoicePatch,
  now: Date = new Date(),
): Promise<InvoiceDTO> {
  requireManage(viewer);
  await db.transaction(async (tx) => {
    const row = await findOwned(tx, viewer.workspaceId, id, true);
    const keys = (Object.keys(patch) as (keyof InvoicePatch)[]).filter(
      (k) => patch[k] !== undefined,
    );
    if (row.status !== "DRAFT" && keys.some((k) => !AFTER_SEND.has(k))) {
      throw new CatalogError("INVALID", DRAFT_ONLY);
    }
    const issueDate = patch.issueDate ?? row.issueDate;
    const dueDate = patch.dueDate ?? row.dueDate;
    if (dueDate < issueDate) throw new CatalogError("INVALID", DUE_BEFORE_ISSUE_MESSAGE);
    const tax = (name: string | null | undefined, bps: number | null | undefined) =>
      name && bps !== null && bps !== undefined ? { name, bps } : { name: null, bps: null };
    const tax1 = tax(patch.tax1Name ?? row.tax1Name, patch.tax1Bps ?? row.tax1Bps);
    const tax2 = tax(patch.tax2Name ?? row.tax2Name, patch.tax2Bps ?? row.tax2Bps);
    try {
      await tx
        .update(invoice)
        .set({
          ...(patch.number !== undefined ? { number: patch.number } : {}),
          issueDate,
          dueDate,
          ...(patch.discountBps !== undefined ? { discountBps: patch.discountBps } : {}),
          tax1Name: tax1.name,
          tax1Bps: tax1.bps,
          tax2Name: tax2.name,
          tax2Bps: tax2.bps,
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.externalRef !== undefined ? { externalRef: patch.externalRef } : {}),
        })
        .where(eq(invoice.id, id));
    } catch (error) {
      if (isUniqueViolation(error, "invoice_workspace_number_uq")) {
        throw new CatalogError("CONFLICT", "An invoice with this number exists.");
      }
      throw error;
    }
    await recomputeTotals(tx, id);
  });
  return getInvoice(db, viewer, id, now);
}

/** Manual lines after the last one, each quantity × price rounded alone; the caller recomputes. */
export async function insertManualLines(
  tx: Executor,
  invoiceId: string,
  lines: InvoiceLineInput[],
): Promise<void> {
  if (lines.length === 0) return;
  let position = await nextPosition(tx, invoiceId);
  await tx.insert(invoiceItem).values(
    lines.map((line) => ({
      id: randomUUID(),
      invoiceId,
      position: position++,
      kind: "MANUAL" as const,
      description: line.description,
      quantityCenti: line.quantityCenti,
      unitPriceMinor: line.unitPriceMinor,
      amountMinor: lineAmount(line.quantityCenti, line.unitPriceMinor),
    })),
  );
}

export async function addManualLine(
  db: Database,
  viewer: Viewer,
  id: string,
  line: InvoiceLineInput,
  now: Date = new Date(),
): Promise<InvoiceDTO> {
  requireManage(viewer);
  await db.transaction(async (tx) => {
    await lockDraft(tx, viewer.workspaceId, id);
    await insertManualLines(tx, id, [line]);
    await recomputeTotals(tx, id);
  });
  return getInvoice(db, viewer, id, now);
}

async function findLine(tx: Executor, invoiceId: string, lineId: string) {
  const [item] = await tx
    .select()
    .from(invoiceItem)
    .where(and(eq(invoiceItem.id, lineId), eq(invoiceItem.invoiceId, invoiceId)));
  if (!item) throw new CatalogError("NOT_FOUND", "Line not found.");
  return item;
}

export async function updateLine(
  db: Database,
  viewer: Viewer,
  id: string,
  lineId: string,
  line: InvoiceLineInput,
  now: Date = new Date(),
): Promise<InvoiceDTO> {
  requireManage(viewer);
  await db.transaction(async (tx) => {
    await lockDraft(tx, viewer.workspaceId, id);
    const item = await findLine(tx, id, lineId);
    if (item.kind !== "MANUAL") {
      throw new CatalogError(
        "INVALID",
        "An imported line cannot be edited. Remove it and import again.",
      );
    }
    await tx
      .update(invoiceItem)
      .set({
        description: line.description,
        quantityCenti: line.quantityCenti,
        unitPriceMinor: line.unitPriceMinor,
        amountMinor: lineAmount(line.quantityCenti, line.unitPriceMinor),
      })
      .where(eq(invoiceItem.id, lineId));
    await recomputeTotals(tx, id);
  });
  return getInvoice(db, viewer, id, now);
}

/** Removes a line; an imported one gives its time and expenses back. */
export async function removeLine(
  db: Database,
  viewer: Viewer,
  id: string,
  lineId: string,
  now: Date = new Date(),
): Promise<InvoiceDTO> {
  requireManage(viewer);
  await db.transaction(async (tx) => {
    await lockDraft(tx, viewer.workspaceId, id);
    const item = await findLine(tx, id, lineId);
    await tx.delete(invoiceItem).where(eq(invoiceItem.id, lineId));
    if (item.entryIds.length > 0) {
      await releaseInvoiced(tx, viewer.workspaceId, id, item.entryIds);
    }
    if (item.expenseIds.length > 0) {
      await releaseExpensesInvoiced(tx, viewer.workspaceId, id, item.expenseIds);
    }
    const rest = await tx
      .select({ id: invoiceItem.id })
      .from(invoiceItem)
      .where(eq(invoiceItem.invoiceId, id))
      .orderBy(asc(invoiceItem.position), asc(invoiceItem.id));
    for (const [i, r] of rest.entries()) {
      await tx
        .update(invoiceItem)
        .set({ position: i + 1 })
        .where(eq(invoiceItem.id, r.id));
    }
    await recomputeTotals(tx, id);
  });
  return getInvoice(db, viewer, id, now);
}

export async function reorderLines(
  db: Database,
  viewer: Viewer,
  id: string,
  lineIds: string[],
  now: Date = new Date(),
): Promise<InvoiceDTO> {
  requireManage(viewer);
  await db.transaction(async (tx) => {
    await lockDraft(tx, viewer.workspaceId, id);
    const items = await tx
      .select({ id: invoiceItem.id })
      .from(invoiceItem)
      .where(eq(invoiceItem.invoiceId, id));
    const have = new Set(items.map((i) => i.id));
    if (lineIds.length !== have.size || !lineIds.every((l) => have.has(l))) {
      throw new CatalogError("INVALID", "The line order does not match the invoice.");
    }
    for (const [i, lineId] of lineIds.entries()) {
      await tx
        .update(invoiceItem)
        .set({ position: i + 1 })
        .where(eq(invoiceItem.id, lineId));
    }
  });
  return getInvoice(db, viewer, id, now);
}

/** Deletes a draft and gives its time and expenses back; the number is not reused. */
export async function deleteInvoice(db: Database, viewer: Viewer, id: string): Promise<void> {
  requireManage(viewer);
  await db.transaction(async (tx) => {
    const row = await findOwned(tx, viewer.workspaceId, id, true);
    if (row.status !== "DRAFT") {
      throw new CatalogError("INVALID", "Only a draft can be deleted. Void it instead.");
    }
    await releaseInvoiced(tx, viewer.workspaceId, id);
    await releaseExpensesInvoiced(tx, viewer.workspaceId, id);
    await tx.delete(invoice).where(eq(invoice.id, id));
  });
}

/** Voids a sent invoice: its time and expenses are free again; the lines, the number and the PDF stay. */
export async function voidInvoice(
  db: Database,
  viewer: Viewer,
  id: string,
  now: Date = new Date(),
): Promise<InvoiceDTO> {
  requireManage(viewer);
  await db.transaction(async (tx) => {
    const row = await findOwned(tx, viewer.workspaceId, id, true);
    if (row.status !== "SENT") {
      throw new CatalogError("INVALID", "Only a sent invoice can be voided.");
    }
    await releaseInvoiced(tx, viewer.workspaceId, id);
    await releaseExpensesInvoiced(tx, viewer.workspaceId, id);
    await tx.update(invoice).set({ status: "VOID" }).where(eq(invoice.id, id));
  });
  return getInvoice(db, viewer, id, now);
}

/**
 * Decision 24: freezes the PDF in the private bucket, mints the public token
 * (the sha256 stored, the token returned once as `publicPath`), marks the
 * invoice sent and, with `email`, enqueues the client's email with the PDF
 * attached, all in one transaction under the row lock, so two sends make one
 * PDF and one email. "Mark as sent" is the same without the email.
 */
export async function sendInvoice(
  db: Database,
  viewer: Viewer,
  id: string,
  opts: { email: boolean; now?: Date },
): Promise<InvoiceDTO> {
  requireManage(viewer);
  const now = opts.now ?? new Date();
  const ws = await invoiceWorkspace(db, viewer.workspaceId);
  const token = await db.transaction(async (tx) => {
    const row = await findOwned(tx, ws.id, id, true);
    if (row.status === "VOID") throw new CatalogError("INVALID", IS_VOID);
    if (row.status !== "DRAFT") throw new CatalogError("INVALID", ALREADY_SENT);
    const [lines] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(invoiceItem)
      .where(eq(invoiceItem.invoiceId, id));
    if (!lines || Number(lines.n) === 0) {
      throw new CatalogError("INVALID", "Add a line before sending.");
    }
    const [c] = await tx
      .select({ email: client.email, name: client.name })
      .from(client)
      .where(eq(client.id, row.clientId));
    const to = c?.email.trim() ?? "";
    if (opts.email && !to) throw new CatalogError("INVALID", "This client has no email address.");

    const pdf = await buildInvoicePdf(tx, viewer, id, now);
    const key = `invoices/${ws.id}/${id}.pdf`;
    await uploadExport({ key, body: pdf, contentType: "application/pdf" });
    const token = newInvoiceToken();
    await tx
      .update(invoice)
      .set({ status: "SENT", sentAt: now, pdfKey: key, publicTokenHash: hashInvoiceToken(token) })
      .where(eq(invoice.id, id));
    if (opts.email) {
      const settings = await readInvoiceSettings(tx, ws.id);
      await enqueueEmail(tx, {
        workspaceId: ws.id,
        to,
        kind: `invoice.sent:${id}`,
        attachment: { key, name: `${row.number}.pdf` },
        ...invoiceSentEmail({
          appUrl: env().APP_URL,
          number: row.number,
          companyName: settings.companyName || ws.name,
          totalText: formatMoney(row.totalMinor, row.currency),
          dueDate: row.dueDate,
          publicPath: publicInvoicePath(token),
        }),
      });
    }
    return token;
  });
  return loadDTO(db, ws.id, id, ws.timezone, now, publicInvoicePath(token));
}
