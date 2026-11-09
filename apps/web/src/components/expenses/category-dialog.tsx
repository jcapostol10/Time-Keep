"use client";

import { type ExpenseCategoryKind, formatMoney, parseMoney } from "@timekeep/core";
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
import { RadioGroup, RadioGroupItem } from "@timekeep/ui/components/radio-group";
import { Switch } from "@timekeep/ui/components/switch";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { ExpenseCategoryDTO } from "@/lib/expense-types";
import {
  createExpenseCategoryAction,
  updateExpenseCategoryAction,
} from "@/server/actions/expense-categories";

import { expenseKeys } from "../tracker/query-keys";

/** Add or edit a category: a fixed amount, or a priced unit (km, pages…). */
export function CategoryDialog({
  slug,
  category,
  currency,
  onClose,
}: {
  slug: string;
  category: ExpenseCategoryDTO | null;
  currency: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(category?.name ?? "");
  const [kind, setKind] = useState<ExpenseCategoryKind>(category?.kind ?? "FIXED");
  const [unitName, setUnitName] = useState(category?.unitName ?? "");
  const [price, setPrice] = useState(
    category?.unitPriceMinor !== null && category?.unitPriceMinor !== undefined
      ? formatMoney(category.unitPriceMinor, currency)
          .replace(/[^\d.,]/g, "")
          .replace(/,/g, "")
      : "",
  );
  const [billableDefault, setBillableDefault] = useState(category?.billableDefault ?? true);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    const unitPriceMinor = kind === "UNIT" ? parseMoney(price, currency) : null;
    if (kind === "UNIT" && unitPriceMinor === null) {
      setErrors({ unitPriceMinor: ["Enter a price per unit."] });
      return;
    }
    setBusy(true);
    try {
      const input = {
        name,
        kind,
        unitName: kind === "UNIT" ? unitName : null,
        unitPriceMinor,
        billableDefault,
      };
      const result = category
        ? await updateExpenseCategoryAction(slug, category.id, input)
        : await createExpenseCategoryAction(slug, input);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      toast.success("Category saved");
      await qc.invalidateQueries({ queryKey: expenseKeys.all(slug) });
      onClose();
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
            <DialogTitle>{category ? "Edit category" : "Add category"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="category-name">Name</Label>
            <Input
              id="category-name"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
            {errors.name ? <p className="text-destructive text-sm">{errors.name[0]}</p> : null}
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Kind</legend>
            <RadioGroup
              value={kind}
              onValueChange={(v) => setKind(v === "UNIT" ? "UNIT" : "FIXED")}
              className="flex gap-4"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="FIXED" aria-label="Fixed amount" /> Fixed amount
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="UNIT" aria-label="Per unit" /> Per unit
              </label>
            </RadioGroup>
          </fieldset>
          {kind === "UNIT" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="category-unit">Unit</Label>
                <Input
                  id="category-unit"
                  placeholder="km"
                  maxLength={20}
                  value={unitName}
                  onChange={(e) => setUnitName(e.target.value)}
                />
                {errors.unitName ? (
                  <p className="text-destructive text-sm">{errors.unitName[0]}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="category-price">Price per unit ({currency})</Label>
                <Input
                  id="category-price"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
                {errors.unitPriceMinor ? (
                  <p className="text-destructive text-sm">{errors.unitPriceMinor[0]}</p>
                ) : null}
              </div>
            </div>
          ) : null}
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Billable by default</span>
            <Switch
              aria-label="Billable by default"
              checked={billableDefault}
              onCheckedChange={setBillableDefault}
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              Save category
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
