import "server-only";

import {
  balanceMinor,
  invoiceStatus,
  invoiceTotals,
  localDateKey,
  type MoneyAmount,
} from "@timekeep/core";
import {
  and,
  asc,
  client,
  type DbExecutor,
  desc,
  eq,
  type Invoice,
  invoice,
  invoiceItem,
  type InvoiceItem,
  isNull,
  lt,
  ne,
  or,
  type Payment,
  payment,
  sql,
} from "@timekeep/db";
import type { SQL } from "drizzle-orm";

import type {
  InvoiceDTO,
  InvoiceLineDTO,
  InvoiceListItem,
  InvoiceListPage,
  InvoiceListQuery,
  PaymentDTO,
} from "@/lib/invoice-types";

import { assertCan } from "../authz";
import { CatalogError } from "../catalog/errors";
import type { Viewer } from "../catalog/viewer";
import { invoiceWorkspace } from "./settings";
import { invoiceStatusSql, paidMinorSql } from "./status-sql";

/** The invoice reads (Phase 6d): one row shape for the list, the page and the PDF. */

type Executor = Pick<DbExecutor, "select">;

export const INVOICE_NOT_FOUND = "Invoice not found.";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * A draft or sent invoice in `currency` for a client billed in the workspace
 * currency: what a workspace currency change would relabel under it.
 */
export async function hasOpenInvoicesIn(
  db: Executor,
  workspaceId: string,
  currency: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: invoice.id })
    .from(invoice)
    .innerJoin(client, eq(client.id, invoice.clientId))
    .where(
      and(
        eq(invoice.workspaceId, workspaceId),
        ne(invoice.status, "VOID"),
        eq(invoice.currency, currency),
        isNull(client.currency),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export function requireManage(viewer: Viewer): void {
  assertCan(viewer.actor, "invoice.manage", { kind: "none" });
}

/** The invoice row of this workspace, or not found; `lock` takes it `FOR UPDATE`. */
export async function findOwned(
  db: Executor,
  workspaceId: string,
  id: string,
  lock = false,
): Promise<Invoice> {
  const query = db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, id), eq(invoice.workspaceId, workspaceId)));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new CatalogError("NOT_FOUND", INVOICE_NOT_FOUND);
  return row;
}

interface InvoiceRow {
  invoice: Invoice;
  clientName: string;
  clientEmail: string;
  clientAddress: string;
  paidMinor: number;
}

const ROW = {
  invoice,
  clientName: client.name,
  clientEmail: client.email,
  clientAddress: client.address,
  paidMinor: paidMinorSql(),
};

export function selectRows(db: Executor) {
  return db.select(ROW).from(invoice).innerJoin(client, eq(client.id, invoice.clientId));
}

export function toLineDTO(item: InvoiceItem): InvoiceLineDTO {
  return {
    id: item.id,
    position: item.position,
    kind: item.kind,
    description: item.description,
    quantityCenti: item.quantityCenti,
    unitPriceMinor: item.unitPriceMinor,
    amountMinor: item.amountMinor,
    entryCount: item.entryIds.length + item.expenseIds.length,
  };
}

export function toPaymentDTO(p: Payment): PaymentDTO {
  return {
    id: p.id,
    date: p.date,
    amountMinor: p.amountMinor,
    note: p.note,
    createdBy: p.createdBy,
    createdAt: p.createdAt.toISOString(),
  };
}

/**
 * The list item: the stored subtotal run through core `invoiceTotals` gives
 * the discount, the taxes and the total the lines gave (the same maths over
 * one line of the subtotal), and the computed status reads today in the
 * workspace timezone.
 */
export function toListItem(row: InvoiceRow, todayKey: string): InvoiceListItem {
  const inv = row.invoice;
  const totals = invoiceTotals([{ amountMinor: inv.subtotalMinor }], inv);
  const paidMinor = Number(row.paidMinor);
  return {
    id: inv.id,
    number: inv.number,
    clientId: inv.clientId,
    clientName: row.clientName,
    clientEmail: row.clientEmail,
    clientAddress: row.clientAddress,
    currency: inv.currency,
    status: inv.status,
    computedStatus: invoiceStatus(
      { status: inv.status, totalMinor: inv.totalMinor, paidMinor, dueDate: inv.dueDate },
      todayKey,
    ),
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    discountBps: inv.discountBps,
    tax1Name: inv.tax1Name,
    tax1Bps: inv.tax1Bps,
    tax2Name: inv.tax2Name,
    tax2Bps: inv.tax2Bps,
    notes: inv.notes,
    ...totals,
    paidMinor,
    balanceMinor: balanceMinor(inv.totalMinor, paidMinor),
    sentAt: inv.sentAt ? inv.sentAt.toISOString() : null,
    hasPdf: inv.pdfKey !== null,
    publicPath: null,
    recurringId: inv.recurringId,
    periodKey: inv.periodKey,
    externalRef: inv.externalRef,
    createdAt: inv.createdAt.toISOString(),
    updatedAt: inv.updatedAt.toISOString(),
  };
}

/** The whole invoice; `publicPath` is set only by a send (the token is shown once). */
export async function loadDTO(
  db: Executor,
  workspaceId: string,
  id: string,
  timezone: string,
  now: Date,
  publicPath: string | null = null,
): Promise<InvoiceDTO> {
  const [row] = await selectRows(db).where(
    and(eq(invoice.id, id), eq(invoice.workspaceId, workspaceId)),
  );
  if (!row) throw new CatalogError("NOT_FOUND", INVOICE_NOT_FOUND);
  const items = await db
    .select()
    .from(invoiceItem)
    .where(eq(invoiceItem.invoiceId, id))
    .orderBy(asc(invoiceItem.position), asc(invoiceItem.id));
  const payments = await db
    .select()
    .from(payment)
    .where(eq(payment.invoiceId, id))
    .orderBy(asc(payment.date), asc(payment.createdAt), asc(payment.id));
  return {
    ...toListItem(row, localDateKey(now, timezone)),
    publicPath,
    lines: items.map(toLineDTO),
    payments: payments.map(toPaymentDTO),
  };
}

export async function getInvoice(
  db: Executor,
  viewer: Viewer,
  id: string,
  now: Date = new Date(),
): Promise<InvoiceDTO> {
  requireManage(viewer);
  const ws = await invoiceWorkspace(db, viewer.workspaceId);
  return loadDTO(db, ws.id, id, ws.timezone, now);
}

function parseCursor(cursor: string): { date: string; id: string } {
  const at = cursor.indexOf("|");
  const date = cursor.slice(0, at);
  const id = cursor.slice(at + 1);
  if (at < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !id) {
    throw new CatalogError("INVALID", "Invalid cursor.");
  }
  return { date, id };
}

/**
 * The Invoices page: newest issue date first, by keyset on (issue_date, id);
 * the status filter is the SQL form of decision 21 against today in the
 * workspace timezone. The totals cover the whole filter, per currency, and
 * come with the first page only: every invoice counts, a void one owes
 * nothing, and the balance is what sent invoices still owe.
 */
export async function listInvoices(
  db: Executor,
  viewer: Viewer,
  query: InvoiceListQuery,
  now: Date = new Date(),
): Promise<InvoiceListPage> {
  requireManage(viewer);
  const ws = await invoiceWorkspace(db, viewer.workspaceId);
  const today = localDateKey(now, ws.timezone);
  const conds: SQL[] = [eq(invoice.workspaceId, ws.id)];
  if (query.clientId) conds.push(eq(invoice.clientId, query.clientId));
  if (query.status !== "all") conds.push(sql`${invoiceStatusSql(today)} = ${query.status}`);
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const where = [...conds];
  if (query.cursor) {
    const c = parseCursor(query.cursor);
    where.push(
      or(lt(invoice.issueDate, c.date), and(eq(invoice.issueDate, c.date), lt(invoice.id, c.id)))!,
    );
  }
  const rows = await selectRows(db)
    .where(and(...where))
    .orderBy(desc(invoice.issueDate), desc(invoice.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? `${last.invoice.issueDate}|${last.invoice.id}` : null;

  let totals: InvoiceListPage["totals"] = { count: 0, totalMinor: [], balanceMinor: [] };
  if (!query.cursor) {
    const paid = paidMinorSql();
    const sums = await db
      .select({
        currency: invoice.currency,
        count: sql<number>`count(*)::int`,
        total:
          sql`coalesce(sum(case when ${invoice.status} = 'VOID' then 0 else ${invoice.totalMinor} end), 0)::bigint`.mapWith(
            Number,
          ),
        balance:
          sql`coalesce(sum(case when ${invoice.status} = 'SENT' then greatest(${invoice.totalMinor} - ${paid}, 0) else 0 end), 0)::bigint`.mapWith(
            Number,
          ),
      })
      .from(invoice)
      .where(and(...conds))
      .groupBy(invoice.currency)
      .orderBy(invoice.currency);
    const money = (pick: (r: (typeof sums)[number]) => number): MoneyAmount[] =>
      sums
        .filter((r) => pick(r) !== 0)
        .map((r) => ({ currency: r.currency, amountMinor: pick(r) }));
    totals = {
      count: sums.reduce((n, r) => n + Number(r.count), 0),
      totalMinor: money((r) => r.total),
      balanceMinor: money((r) => r.balance),
    };
  }
  return { invoices: page.map((r) => toListItem(r, today)), nextCursor, totals };
}
