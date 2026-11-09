"use client";

import {
  expenseAmount,
  formatMoney,
  formatQuantity,
  localDateKey,
  parseMoney,
  parseQuantity,
} from "@timekeep/core";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { Switch } from "@timekeep/ui/components/switch";
import { Textarea } from "@timekeep/ui/components/textarea";
import { useState } from "react";

import type { ExpenseCategoryDTO, ExpenseDTO } from "@/lib/expense-types";

import { ProjectPicker } from "../tracker/project-picker";
import { expenseUrls } from "../tracker/query-keys";
import { useTracker } from "../tracker/tracker-provider";
import type { PreparedReceipt } from "./receipt-image";
import { ReceiptInput } from "./receipt-input";
import { useExpenseCategories, useExpenseWrites } from "./use-expenses";

/**
 * Add or edit an expense (Phase 6c): a person (for those who add for others),
 * a project, a category, a date, an amount or a quantity, billable, a
 * description and a receipt. A unit category shows the amount it computes
 * as the quantity is typed, from the category's current price; the server
 * snapshots that price on the expense.
 */
export function ExpenseDialog({
  slug,
  expense,
  people,
  currency,
  onClose,
}: {
  slug: string;
  /** The expense edited, or null for a new one. */
  expense: ExpenseDTO | null;
  /** Whom the viewer may add for, themselves first (hidden when only them). */
  people: { id: string; name: string }[];
  currency: string;
  onClose: () => void;
}) {
  const { viewer } = useTracker();
  const { data: categories } = useExpenseCategories(slug);
  const writes = useExpenseWrites(slug);
  const [userId, setUserId] = useState(expense?.userId ?? people[0]?.id ?? "");
  const [projectId, setProjectId] = useState<string | null>(expense?.projectId ?? null);
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? "");
  const [date, setDate] = useState(expense?.date ?? localDateKey(new Date(), viewer.timezone));
  const [amount, setAmount] = useState(
    expense && expense.quantityCenti === null ? decimalOf(expense.amountMinor, currency) : "",
  );
  const [quantity, setQuantity] = useState(
    expense?.quantityCenti !== null && expense?.quantityCenti !== undefined
      ? formatQuantity(expense.quantityCenti)
      : "",
  );
  const [billable, setBillable] = useState(expense?.billable ?? true);
  const [description, setDescription] = useState(expense?.description ?? "");
  const [receipt, setReceipt] = useState<PreparedReceipt | null>(null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const active = (categories ?? []).filter((c) => !c.archived || c.id === expense?.categoryId);
  const category: ExpenseCategoryDTO | undefined = active.find((c) => c.id === categoryId);
  const unit = category?.kind === "UNIT";
  const quantityCenti = unit ? parseQuantity(quantity) : null;
  const computed =
    unit && quantityCenti !== null && category?.unitPriceMinor !== null
      ? expenseAmount(quantityCenti, category?.unitPriceMinor ?? 0)
      : null;

  function pickCategory(id: string) {
    setCategoryId(id);
    const next = active.find((c) => c.id === id);
    // A new expense follows the category's default; an edited one keeps its own.
    if (!expense && next) setBillable(next.billableDefault);
  }

  async function save() {
    const problems: Record<string, string> = {};
    if (!projectId) problems.project = "Pick a project.";
    if (!category) problems.category = "Pick a category.";
    if (!date) problems.date = "Pick a date.";
    const amountMinor = unit ? undefined : parseMoney(amount, currency);
    if (!unit && (amountMinor === null || amountMinor === 0)) problems.amount = "Enter an amount.";
    if (unit && quantityCenti === null) problems.quantity = "Enter a quantity.";
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    try {
      const input = {
        ...(expense ? {} : { userId: userId || undefined }),
        projectId,
        categoryId,
        date,
        ...(unit ? { quantityCenti } : { amountMinor }),
        billable,
        description,
      };
      if (expense && removeReceipt && !receipt) {
        if (!(await writes.removeReceipt(expense.id))) return;
      }
      const saved = await writes.save(input, expense?.id ?? null, receipt);
      if (saved) onClose();
    } finally {
      setBusy(false);
    }
  }

  const existing =
    expense?.receipt && !removeReceipt
      ? {
          thumbUrl: expense.receipt.thumb ? expenseUrls.receipt(slug, expense.id, true) : null,
          isPdf: expense.receipt.mime === "application/pdf",
        }
      : null;

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>{expense ? "Edit expense" : "Add expense"}</DialogTitle>
          </DialogHeader>
          {!expense && people.length > 1 ? (
            <div className="space-y-2">
              <Label htmlFor="expense-person">Person</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger id="expense-person" aria-label="Person" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label>Project</Label>
            <div>
              <ProjectPicker
                slug={slug}
                value={{ projectId, taskId: null }}
                onChange={(s) => setProjectId(s.projectId)}
                invalid={Boolean(errors.project)}
                current={
                  expense && expense.projectId === projectId
                    ? {
                        project: { name: expense.projectName, color: expense.projectColor },
                        task: null,
                      }
                    : null
                }
              />
            </div>
            {errors.project ? <p className="text-destructive text-sm">{errors.project}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="expense-category">Category</Label>
            <Select value={categoryId} onValueChange={pickCategory}>
              <SelectTrigger id="expense-category" aria-label="Category" className="w-full">
                <SelectValue
                  placeholder={active.length ? "Pick a category" : "No categories yet"}
                />
              </SelectTrigger>
              <SelectContent>
                {active.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.archived ? " (archived)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.category ? <p className="text-destructive text-sm">{errors.category}</p> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="expense-date">Date</Label>
              <Input
                id="expense-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              {errors.date ? <p className="text-destructive text-sm">{errors.date}</p> : null}
            </div>
            {unit ? (
              <div className="space-y-2">
                <Label htmlFor="expense-quantity">
                  Quantity{category?.unitName ? ` (${category.unitName})` : ""}
                </Label>
                <Input
                  id="expense-quantity"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
                {errors.quantity ? (
                  <p className="text-destructive text-sm">{errors.quantity}</p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="expense-amount">Amount ({currency})</Label>
                <Input
                  id="expense-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                {errors.amount ? <p className="text-destructive text-sm">{errors.amount}</p> : null}
              </div>
            )}
          </div>
          {unit && category ? (
            <p className="text-muted-foreground text-sm tabular-nums" aria-live="polite">
              {computed !== null
                ? `× ${formatMoney(category.unitPriceMinor ?? 0, currency)}/${category.unitName ?? "unit"} = ${formatMoney(computed, currency)}`
                : `${formatMoney(category.unitPriceMinor ?? 0, currency)} per ${category.unitName ?? "unit"}`}
            </p>
          ) : null}
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Billable</span>
            <Switch aria-label="Billable" checked={billable} onCheckedChange={setBillable} />
          </label>
          <div className="space-y-2">
            <Label htmlFor="expense-description">Description</Label>
            <Textarea
              id="expense-description"
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <ReceiptInput
            value={receipt}
            onChange={setReceipt}
            existing={existing}
            onRemoveExisting={() => setRemoveReceipt(true)}
            disabled={busy}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Save expense
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 12550, "USD" → "125.50", for the amount box of an edited expense. */
function decimalOf(minor: number, currency: string): string {
  const text = formatMoney(minor, currency);
  // Keep digits and the decimal point only: the box takes a plain decimal.
  return text.replace(/[^\d.,]/g, "").replace(/,/g, "");
}
