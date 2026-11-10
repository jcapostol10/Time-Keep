"use client";

import { formatMoney } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import { useState } from "react";

import type { InvoiceDTO } from "@/lib/invoice-types";
import { sendInvoiceAction } from "@/server/actions/invoices";

import { useInvoiceWrite } from "./use-invoices";

/** Sending freezes the PDF and mints the public link; with email, the client gets both. */
export function SendDialog({
  slug,
  invoice,
  onSent,
  onClose,
}: {
  slug: string;
  invoice: InvoiceDTO;
  onSent: (sent: InvoiceDTO) => void;
  onClose: () => void;
}) {
  const write = useInvoiceWrite(slug);
  const [busy, setBusy] = useState(false);
  const email = invoice.clientEmail.trim();

  async function send(withEmail: boolean) {
    setBusy(true);
    try {
      const sent = await write(
        () => sendInvoiceAction(slug, invoice.id, { email: withEmail }),
        withEmail ? `Sent to ${email}` : "Marked as sent",
      );
      if (sent) onSent(sent);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send invoice</DialogTitle>
          <DialogDescription>
            {invoice.number} for {formatMoney(invoice.totalMinor, invoice.currency)}. Once sent, its
            lines, number and PDF are fixed.
          </DialogDescription>
        </DialogHeader>
        {email ? (
          <p className="text-sm">
            To: <span className="font-medium">{email}</span>, with the PDF attached and a link to
            view it online.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            {invoice.clientName} has no email address. Add one on the Clients page, or mark the
            invoice as sent and share it yourself.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => void send(false)}>
            Mark as sent only
          </Button>
          <Button
            disabled={busy || !email || invoice.lines.length === 0}
            onClick={() => void send(true)}
          >
            Send email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
