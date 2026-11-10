"use client";

import { formatDateKey, formatMoney, minorToDecimal, parseMoney } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import { Input } from "@timekeep/ui/components/input";
import { Label } from "@timekeep/ui/components/label";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import type { InvoiceDTO } from "@/lib/invoice-types";
import { addPaymentAction, removePaymentAction } from "@/server/actions/payments";

import { useInvoiceWrite } from "./use-invoices";

/** Payments on a sent invoice: a date, an amount up to the balance, a note. */
export function PaymentsCard({
  slug,
  invoice,
  today,
}: {
  slug: string;
  invoice: InvoiceDTO;
  today: string;
}) {
  const write = useInvoiceWrite(slug);
  const [recording, setRecording] = useState(false);
  const money = (minor: number) => formatMoney(minor, invoice.currency);
  return (
    <section aria-label="Payments" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Payments</h2>
        {invoice.status === "SENT" && invoice.balanceMinor > 0 ? (
          <Button variant="outline" onClick={() => setRecording(true)}>
            Record payment
          </Button>
        ) : null}
      </div>
      {invoice.payments.length === 0 ? (
        <p className="text-muted-foreground text-sm">No payments yet.</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {invoice.payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>
                {formatDateKey(p.date)}
                {p.note ? <span className="text-muted-foreground"> · {p.note}</span> : null}
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{money(p.amountMinor)}</span>
                {invoice.status === "SENT" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove payment of ${money(p.amountMinor)}`}
                    onClick={() =>
                      void write(
                        () => removePaymentAction(slug, invoice.id, p.id),
                        "Payment removed",
                      )
                    }
                  >
                    <Trash2Icon />
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {recording ? (
        <PaymentDialog
          slug={slug}
          invoice={invoice}
          today={today}
          onClose={() => setRecording(false)}
        />
      ) : null}
    </section>
  );
}

function PaymentDialog({
  slug,
  invoice,
  today,
  onClose,
}: {
  slug: string;
  invoice: InvoiceDTO;
  today: string;
  onClose: () => void;
}) {
  const write = useInvoiceWrite(slug);
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState(minorToDecimal(invoice.balanceMinor, invoice.currency));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const amountMinor = parseMoney(amount, invoice.currency);
    if (amountMinor === null || amountMinor <= 0) return setError("Enter an amount, like 150.");
    setBusy(true);
    try {
      const saved = await write(
        () => addPaymentAction(slug, invoice.id, { date, amountMinor, note }),
        "Payment recorded",
      );
      if (saved) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="payment-date">Date</Label>
              <Input
                id="payment-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-amount">Amount ({invoice.currency})</Label>
              <Input
                id="payment-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="payment-note">Note</Label>
            <Input
              id="payment-note"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !date}>
              Save payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
