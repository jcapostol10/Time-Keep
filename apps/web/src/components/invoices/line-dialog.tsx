"use client";

import { formatQuantity, minorToDecimal, parseCenti, parseMoney } from "@timekeep/core";
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
import { useState } from "react";

import type { InvoiceDTO, InvoiceLineDTO } from "@/lib/invoice-types";
import { addLineAction, updateLineAction } from "@/server/actions/invoices";

import { useInvoiceWrite } from "./use-invoices";

/** A manual line: a description, a quantity (two decimals) and a unit price in the invoice's currency. */
export function LineDialog({
  slug,
  invoice,
  line,
  onClose,
}: {
  slug: string;
  invoice: InvoiceDTO;
  line: InvoiceLineDTO | null;
  onClose: () => void;
}) {
  const write = useInvoiceWrite(slug);
  const [description, setDescription] = useState(line?.description ?? "");
  const [quantity, setQuantity] = useState(line ? formatQuantity(line.quantityCenti) : "1");
  const [price, setPrice] = useState(
    line?.unitPriceMinor != null ? minorToDecimal(line.unitPriceMinor, invoice.currency) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const quantityCenti = parseCenti(quantity);
    const unitPriceMinor = parseMoney(price, invoice.currency);
    if (quantityCenti === null || quantityCenti <= 0)
      return setError("Enter a quantity, like 2 or 1.5.");
    if (unitPriceMinor === null) return setError("Enter a unit price, like 100 or 99.50.");
    setBusy(true);
    try {
      const input = { description, quantityCenti, unitPriceMinor };
      const saved = await write(() =>
        line
          ? updateLineAction(slug, invoice.id, line.id, input)
          : addLineAction(slug, invoice.id, input),
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
            <DialogTitle>{line ? "Edit line" : "Add line"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="line-description">Description</Label>
            <Input
              id="line-description"
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="line-quantity">Quantity</Label>
              <Input
                id="line-quantity"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="line-price">Unit price ({invoice.currency})</Label>
              <Input
                id="line-price"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !description.trim()}>
              Save line
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
