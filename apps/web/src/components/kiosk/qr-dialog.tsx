"use client";

import { QR_REISSUE_NOTE } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import QRCode from "qrcode";
import { useState } from "react";
import { toast } from "sonner";

import type { ActionResult } from "@/lib/action-result";

/** Only the dialog's code prints: it goes on a card, not the page behind it. */
const PRINT_ONLY_CODE = `@media print {
  body * { visibility: hidden; }
  [data-qr-print], [data-qr-print] * { visibility: visible; }
  [data-qr-print] { position: fixed; inset: 0; margin: auto; }
}`;

export interface QrCodeImage {
  payload: string;
  image: string;
}

export async function drawQrCode(payload: string): Promise<QrCodeImage> {
  return { payload, image: await QRCode.toDataURL(payload, { width: 320, margin: 2 }) };
}

/**
 * Shows a person's kiosk QR code. Only the code's hash is stored, so showing
 * one always issues a new one. Without `first`, a code already exists: the
 * person is told a printed copy stops working before a new one is issued.
 */
export function QrDialog({
  first = null,
  alt,
  issue,
  onClose,
}: {
  first?: QrCodeImage | null;
  alt: string;
  issue: () => Promise<ActionResult<{ payload: string }>>;
  onClose: () => void;
}) {
  const [code, setCode] = useState<QrCodeImage | null>(first);
  const [busy, setBusy] = useState(false);

  async function reissue() {
    setBusy(true);
    const result = await issue();
    if (result.ok) setCode(await drawQrCode(result.data.payload));
    else toast.error(result.error);
    setBusy(false);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>QR code</DialogTitle>
          <DialogDescription>
            {code ? "Scan this on a kiosk to clock in." : QR_REISSUE_NOTE}
          </DialogDescription>
        </DialogHeader>
        {code ? (
          <>
            <style>{PRINT_ONLY_CODE}</style>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, drawn here */}
            <img
              data-qr-print
              data-payload={code.payload}
              src={code.image}
              alt={alt}
              width={320}
              height={320}
              className="mx-auto"
            />
          </>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {code ? (
            <Button onClick={() => window.print()}>Print</Button>
          ) : (
            <Button disabled={busy} onClick={() => void reissue()}>
              Show a new code
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
