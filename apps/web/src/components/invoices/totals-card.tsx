"use client";

import { formatBps, formatMoney, parseBps } from "@timekeep/core";
import { Input } from "@timekeep/ui/components/input";
import { toast } from "sonner";

import type { InvoiceDTO } from "@/lib/invoice-types";
import { updateInvoiceAction } from "@/server/actions/invoices";

import { useInvoiceWrite } from "./use-invoices";

/**
 * Subtotal, discount and up to two taxes (each on the discounted subtotal),
 * total, paid and the balance due. A draft's percents and tax names save on blur.
 */
export function TotalsCard({ slug, invoice }: { slug: string; invoice: InvoiceDTO }) {
  const write = useInvoiceWrite(slug);
  const draft = invoice.status === "DRAFT";
  const money = (minor: number) => formatMoney(minor, invoice.currency);
  const patch = (input: Record<string, unknown>) =>
    void write(() => updateInvoiceAction(slug, invoice.id, input));
  const bpsOf = (text: string): number | null | undefined => {
    if (text.trim() === "") return null;
    const bps = parseBps(text);
    if (bps === null) {
      toast.error("Enter a percent from 0 to 100, like 12 or 7.5.");
      return undefined;
    }
    return bps;
  };
  const percentInput = (
    label: string,
    bps: number | null,
    onSave: (bps: number | null) => void,
  ) => (
    <Input
      aria-label={label}
      key={`${label}-${bps}`}
      defaultValue={bps === null ? "" : formatBps(bps)}
      inputMode="decimal"
      className="h-8 w-20 text-right"
      disabled={!draft}
      onBlur={(e) => {
        const next = bpsOf(e.target.value);
        if (next !== undefined && next !== bps) onSave(next);
      }}
    />
  );
  const tax = (n: 1 | 2) => {
    const name = n === 1 ? invoice.tax1Name : invoice.tax2Name;
    const bps = n === 1 ? invoice.tax1Bps : invoice.tax2Bps;
    const amount = n === 1 ? invoice.tax1Minor : invoice.tax2Minor;
    const save = (nextName: string | null, nextBps: number | null) =>
      patch({ [`tax${n}Name`]: nextName, [`tax${n}Bps`]: nextBps });
    if (!draft && !name) return null;
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Input
            aria-label={`Tax ${n} name`}
            key={`tax${n}-${name}`}
            defaultValue={name ?? ""}
            placeholder={`Tax ${n}`}
            maxLength={40}
            className="h-8 w-28"
            disabled={!draft}
            onBlur={(e) => {
              const next = e.target.value.trim() || null;
              if (next !== name) save(next, next ? (bps ?? 0) : null);
            }}
          />
          {percentInput(`Tax ${n} %`, bps, (next) =>
            save(next === null ? null : (name ?? `Tax ${n}`), next),
          )}
          <span className="text-muted-foreground text-sm">%</span>
        </div>
        <span className="tabular-nums">{money(amount)}</span>
      </div>
    );
  };

  return (
    <section aria-label="Totals" className="space-y-2 rounded-md border p-4 text-sm">
      <Row label="Subtotal" value={money(invoice.subtotalMinor)} />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span>Discount</span>
          {percentInput("Discount %", invoice.discountBps, (next) =>
            patch({ discountBps: next ?? 0 }),
          )}
          <span className="text-muted-foreground">%</span>
        </div>
        <span className="tabular-nums">−{money(invoice.discountMinor)}</span>
      </div>
      {tax(1)}
      {tax(2)}
      <div className="flex justify-between gap-2 border-t pt-2 text-base font-semibold">
        <span>Total</span>
        <span data-testid="invoice-total" className="tabular-nums">
          {money(invoice.totalMinor)}
        </span>
      </div>
      {invoice.status !== "DRAFT" ? (
        <>
          <Row label="Paid" value={money(invoice.paidMinor)} />
          <div className="flex justify-between gap-2 font-semibold">
            <span>Balance due</span>
            <span data-testid="invoice-balance" className="tabular-nums">
              {money(invoice.balanceMinor)}
            </span>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
