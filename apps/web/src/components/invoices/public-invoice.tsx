import { formatBps, formatDateKey, formatMoney } from "@timekeep/core";
import { Badge } from "@timekeep/ui/components/badge";
import { Button } from "@timekeep/ui/components/button";

import type { PublicInvoiceDTO } from "@/lib/invoice-types";

import { INVOICE_STATUS_LABELS } from "./status";

/** The client's view of a sent invoice (server-rendered; the public page). */
export function PublicInvoice({
  invoice,
  pdfHref,
}: {
  invoice: PublicInvoiceDTO;
  pdfHref: string;
}) {
  const money = (minor: number) => formatMoney(minor, invoice.currency);
  const tax = (name: string | null, bps: number | null, minor: number) =>
    name && bps !== null ? (
      <Row label={`${name} (${formatBps(bps)}%)`} value={money(minor)} />
    ) : null;
  return (
    <article className="bg-card space-y-6 rounded-lg border p-4 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div className="space-y-1 whitespace-pre-line text-sm">
          {invoice.company.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the logo is a public bucket URL of any size
            <img src={invoice.company.logoUrl} alt="" className="mb-2 max-h-14 max-w-44" />
          ) : null}
          <div className="text-base font-semibold">{invoice.company.name}</div>
          {invoice.company.address ? <div>{invoice.company.address}</div> : null}
          {invoice.company.taxLine ? <div>{invoice.company.taxLine}</div> : null}
        </div>
        <div className="space-y-1 text-right text-sm">
          <h1 className="text-xl font-semibold">Invoice {invoice.number}</h1>
          <Badge variant="secondary">{INVOICE_STATUS_LABELS[invoice.status]}</Badge>
          <div className="text-muted-foreground">Issued {formatDateKey(invoice.issueDate)}</div>
          <div className="text-muted-foreground">Due {formatDateKey(invoice.dueDate)}</div>
        </div>
      </header>

      <section className="whitespace-pre-line text-sm">
        <div className="text-muted-foreground text-xs uppercase">Bill to</div>
        <div className="font-medium">{invoice.clientName}</div>
        {invoice.clientAddress ? <div>{invoice.clientAddress}</div> : null}
      </section>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-2 font-medium">Description</th>
              <th className="py-2 pr-2 text-right font-medium">Qty</th>
              <th className="py-2 pr-2 text-right font-medium">Unit price</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.id} className="border-b align-top">
                <td className="py-2 pr-2">{l.description}</td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {(l.quantityCenti / 100).toFixed(2)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {l.unitPriceMinor === null ? "—" : money(l.unitPriceMinor)}
                </td>
                <td className="py-2 text-right tabular-nums">{money(l.amountMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto max-w-xs space-y-1 text-sm">
        <Row label="Subtotal" value={money(invoice.subtotalMinor)} />
        {invoice.discountBps > 0 ? (
          <Row
            label={`Discount (${formatBps(invoice.discountBps)}%)`}
            value={`−${money(invoice.discountMinor)}`}
          />
        ) : null}
        {tax(invoice.tax1Name, invoice.tax1Bps, invoice.tax1Minor)}
        {tax(invoice.tax2Name, invoice.tax2Bps, invoice.tax2Minor)}
        <Row label="Total" value={money(invoice.totalMinor)} strong />
        {invoice.paidMinor > 0 ? (
          <>
            <Row label="Paid" value={`−${money(invoice.paidMinor)}`} />
            <Row label="Balance due" value={money(invoice.balanceMinor)} strong />
          </>
        ) : null}
      </dl>

      {invoice.notes ? <p className="whitespace-pre-line text-sm">{invoice.notes}</p> : null}

      {invoice.canDownload ? (
        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <a href={pdfHref}>Download PDF</a>
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "font-semibold" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
