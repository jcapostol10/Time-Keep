import "server-only";

import { localDateKey } from "@timekeep/core";
import {
  and,
  asc,
  type DbExecutor,
  eq,
  invoice,
  invoiceItem,
  isNull,
  lte,
  or,
  payment,
} from "@timekeep/db";

import type { PublicInvoiceDTO } from "@/lib/invoice-types";

import { presignedExportUrl } from "../storage";
import { selectRows, toLineDTO, toListItem } from "./read";
import { invoiceWorkspace, readInvoiceSettings } from "./settings";
import { hashInvoiceToken, INVOICE_DOWNLOAD_INTERVAL_MS, INVOICE_TOKEN_RE } from "./tokens";

/**
 * The public page (decision 25): no session; the token's sha256 finds a sent
 * invoice, and nothing else (a draft, a void invoice, an unknown token: null,
 * the same 404). The PDF is the frozen file, one download per 10 seconds.
 */

type Executor = Pick<DbExecutor, "select" | "insert" | "update">;

export async function resolvePublicInvoice(
  db: Executor,
  token: string,
): Promise<{ invoiceId: string; workspaceId: string } | null> {
  if (!INVOICE_TOKEN_RE.test(token)) return null;
  const [row] = await db
    .select({ id: invoice.id, workspaceId: invoice.workspaceId })
    .from(invoice)
    .where(and(eq(invoice.publicTokenHash, hashInvoiceToken(token)), eq(invoice.status, "SENT")));
  return row ? { invoiceId: row.id, workspaceId: row.workspaceId } : null;
}

export async function publicInvoice(
  db: Executor,
  token: string,
  now: Date = new Date(),
): Promise<PublicInvoiceDTO | null> {
  const ref = await resolvePublicInvoice(db, token);
  if (!ref) return null;
  const ws = await invoiceWorkspace(db, ref.workspaceId);
  const [row] = await selectRows(db).where(eq(invoice.id, ref.invoiceId));
  if (!row) return null;
  const settings = await readInvoiceSettings(db, ws.id);
  const items = await db
    .select()
    .from(invoiceItem)
    .where(eq(invoiceItem.invoiceId, ref.invoiceId))
    .orderBy(asc(invoiceItem.position), asc(invoiceItem.id));
  const payments = await db
    .select({ date: payment.date, amountMinor: payment.amountMinor })
    .from(payment)
    .where(eq(payment.invoiceId, ref.invoiceId))
    .orderBy(asc(payment.date), asc(payment.createdAt));
  const item = toListItem(row, localDateKey(now, ws.timezone));
  return {
    number: item.number,
    status: item.computedStatus,
    currency: item.currency,
    issueDate: item.issueDate,
    dueDate: item.dueDate,
    clientName: item.clientName,
    clientAddress: item.clientAddress,
    company: {
      name: settings.companyName || ws.name,
      address: settings.address,
      taxLine: settings.taxLine,
      logoUrl: ws.logo,
    },
    lines: items.map(toLineDTO),
    discountBps: item.discountBps,
    tax1Name: item.tax1Name,
    tax1Bps: item.tax1Bps,
    tax2Name: item.tax2Name,
    tax2Bps: item.tax2Bps,
    subtotalMinor: item.subtotalMinor,
    discountMinor: item.discountMinor,
    tax1Minor: item.tax1Minor,
    tax2Minor: item.tax2Minor,
    totalMinor: item.totalMinor,
    paidMinor: item.paidMinor,
    balanceMinor: item.balanceMinor,
    payments,
    notes: item.notes,
    canDownload: row.invoice.pdfKey !== null,
  };
}

/** One download per INVOICE_DOWNLOAD_INTERVAL_MS: a conditional update, so two requests cannot both win. */
export async function claimInvoiceDownload(
  db: Executor,
  invoiceId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - INVOICE_DOWNLOAD_INTERVAL_MS);
  const rows = await db
    .update(invoice)
    .set({ lastDownloadAt: now })
    .where(
      and(
        eq(invoice.id, invoiceId),
        or(isNull(invoice.lastDownloadAt), lte(invoice.lastDownloadAt, cutoff)),
      ),
    )
    .returning({ id: invoice.id });
  return rows.length > 0;
}

/** A five-minute link to the frozen PDF, saved as "<number>.pdf". */
export async function publicPdfUrl(db: Executor, invoiceId: string): Promise<string> {
  const [row] = await db
    .select({ key: invoice.pdfKey, number: invoice.number })
    .from(invoice)
    .where(eq(invoice.id, invoiceId));
  if (!row?.key) throw new Error("This invoice has no PDF.");
  return presignedExportUrl(row.key, 300, `${row.number}.pdf`);
}
