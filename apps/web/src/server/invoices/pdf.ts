import "server-only";

import { formatBps, formatDateKey, formatMoney } from "@timekeep/core";
import type { DbExecutor } from "@timekeep/db";

import type { InvoiceDTO, InvoiceSettingsDTO } from "@/lib/invoice-types";

import type { Viewer } from "../catalog/viewer";
import { htmlToPdf } from "../report-pdf";
import { getInvoice } from "./read";
import { getInvoiceSettings, invoiceWorkspace } from "./settings";

/**
 * The invoice template (decision 24): a self-contained page the report
 * printer turns into the PDF frozen on send, and the admin's live preview of
 * a draft. Money prints in the invoice's currency; dates are the keys.
 */

function esc(text: string | number | null | undefined): string {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1c2430; font-size: 11px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 2px solid #0f766e; padding-bottom: 12px; margin-bottom: 16px; }
  .company { font-size: 12px; white-space: pre-line; }
  .company strong { font-size: 14px; display: block; margin-bottom: 2px; }
  .logo { max-height: 56px; max-width: 180px; display: block; margin-bottom: 6px; }
  h1 { font-size: 22px; margin: 0 0 4px; text-align: right; }
  .meta { text-align: right; color: #5b6672; }
  .meta div { margin: 2px 0; }
  .parties { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 16px; }
  .label { color: #5b6672; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 3px; }
  .client { white-space: pre-line; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { text-align: left; background: #f1f4f6; font-weight: 600; }
  th, td { padding: 5px 6px; border-bottom: 1px solid #e3e8ec; vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr { page-break-inside: avoid; }
  .totals { margin-left: auto; width: 46%; }
  .totals td { border-bottom: 1px solid #eef1f3; }
  .totals tr.total td { font-weight: 700; font-size: 13px; border-top: 2px solid #0f766e; border-bottom: 0; }
  .totals tr.due td { font-weight: 700; }
  .notes { margin-top: 18px; white-space: pre-line; }
  footer { margin-top: 24px; color: #5b6672; font-size: 10px; }
`;

const STATUS_TEXT: Record<InvoiceDTO["computedStatus"], string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  VOID: "Void",
};

export function renderInvoiceHtml(args: {
  invoice: InvoiceDTO;
  settings: InvoiceSettingsDTO;
  workspaceName: string;
  /** The file frozen on send: no status line, which could only go stale. */
  frozen?: boolean;
}): string {
  const { invoice, settings } = args;
  const money = (minor: number) => formatMoney(minor, invoice.currency);
  const date = (key: string) => `<time datetime="${esc(key)}">${esc(formatDateKey(key))}</time>`;
  const qty = (centi: number) => (centi / 100).toFixed(2);
  const company = settings.companyName || args.workspaceName;
  const lines = invoice.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.description)}</td><td class="num">${esc(qty(l.quantityCenti))}</td><td class="num">${l.unitPriceMinor === null ? "—" : esc(money(l.unitPriceMinor))}</td><td class="num">${esc(money(l.amountMinor))}</td></tr>`,
    )
    .join("");
  const taxRow = (name: string | null, bps: number | null, minor: number) =>
    name && bps !== null
      ? `<tr><td>${esc(name)} (${esc(formatBps(bps))}%)</td><td class="num">${esc(money(minor))}</td></tr>`
      : "";
  const totals = [
    `<tr><td>Subtotal</td><td class="num">${esc(money(invoice.subtotalMinor))}</td></tr>`,
    invoice.discountBps > 0
      ? `<tr><td>Discount (${esc(formatBps(invoice.discountBps))}%)</td><td class="num">−${esc(money(invoice.discountMinor))}</td></tr>`
      : "",
    taxRow(invoice.tax1Name, invoice.tax1Bps, invoice.tax1Minor),
    taxRow(invoice.tax2Name, invoice.tax2Bps, invoice.tax2Minor),
    `<tr class="total"><td>Total</td><td class="num">${esc(money(invoice.totalMinor))}</td></tr>`,
    invoice.paidMinor > 0
      ? `<tr><td>Paid</td><td class="num">−${esc(money(invoice.paidMinor))}</td></tr><tr class="due"><td>Balance due</td><td class="num">${esc(money(invoice.balanceMinor))}</td></tr>`
      : "",
  ].join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(`Invoice ${invoice.number}`)}</title><style>${CSS}</style></head><body>
<header>
  <div class="company">${settings.logoUrl ? `<img class="logo" src="${esc(settings.logoUrl)}" alt="">` : ""}<strong>${esc(company)}</strong>${esc(settings.address)}${settings.taxLine ? `\n${esc(settings.taxLine)}` : ""}</div>
  <div><h1>Invoice ${esc(invoice.number)}</h1><div class="meta">${args.frozen ? "" : `<div>Status: ${esc(STATUS_TEXT[invoice.computedStatus])}</div>`}<div>Issued ${date(invoice.issueDate)}</div><div>Due ${date(invoice.dueDate)}</div></div></div>
</header>
<section class="parties">
  <div><div class="label">Bill to</div><div class="client"><strong>${esc(invoice.clientName)}</strong>${invoice.clientAddress ? `\n${esc(invoice.clientAddress)}` : ""}${invoice.clientEmail ? `\n${esc(invoice.clientEmail)}` : ""}</div></div>
  <div><div class="label">Currency</div><div>${esc(invoice.currency)}</div></div>
</section>
<table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead><tbody>${lines}</tbody></table>
<table class="totals"><tbody>${totals}</tbody></table>
${invoice.notes ? `<div class="notes">${esc(invoice.notes)}</div>` : ""}
<footer>Payment terms: ${esc(settings.paymentTermsDays)} days.</footer>
</body></html>`;
}

/** The invoice as the printer sees it now: the frozen file on send, a live render for a draft. */
export async function buildInvoicePdf(
  db: Pick<DbExecutor, "select" | "insert" | "update">,
  viewer: Viewer,
  id: string,
  now: Date = new Date(),
  opts: { frozen?: boolean } = {},
): Promise<Uint8Array> {
  const [invoice, settings, ws] = await Promise.all([
    getInvoice(db, viewer, id, now),
    getInvoiceSettings(db, viewer),
    invoiceWorkspace(db, viewer.workspaceId),
  ]);
  return htmlToPdf(
    renderInvoiceHtml({ invoice, settings, workspaceName: ws.name, frozen: opts.frozen }),
  );
}
