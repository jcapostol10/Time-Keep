"use client";

import { addDaysToKey, formatMoney, hoursText, type ImportGroup } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useMemo, useState } from "react";

import type { InvoiceDTO } from "@/lib/invoice-types";
import { importTimeAction } from "@/server/actions/invoices";

import { MultiSelectFilter } from "../reports/multi-select-filter";
import { useImportPreview, useInvoiceWrite } from "./use-invoices";

const GROUPS: { value: ImportGroup; label: string }[] = [
  { value: "project", label: "Project" },
  { value: "task", label: "Task" },
  { value: "user", label: "Person" },
  { value: "entry", label: "Entry" },
];

/**
 * "Import time and expenses": the client's billable time in the invoice's
 * currency (and, in the workspace currency, their billable expenses) for a
 * range, grouped into lines, as the Summary report counts it.
 */
export function ImportDialog({
  slug,
  invoice,
  projects,
  today,
  onClose,
}: {
  slug: string;
  invoice: InvoiceDTO;
  projects: { id: string; name: string }[];
  today: string;
  onClose: () => void;
}) {
  const write = useInvoiceWrite(slug);
  const [from, setFrom] = useState(addDaysToKey(today, -30));
  const [to, setTo] = useState(today);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<ImportGroup>("project");
  const [expenses, setExpenses] = useState(true);
  const [busy, setBusy] = useState(false);
  const valid = Boolean(from && to && to >= from);
  const params = useMemo(() => {
    const p = new URLSearchParams({ from, to, groupBy, expenses: expenses ? "1" : "0" });
    for (const id of projectIds) p.append("projectIds", id);
    return p.toString();
  }, [from, to, groupBy, expenses, projectIds]);
  const { data: preview } = useImportPreview(slug, invoice.id, params, valid);
  const money = (minor: number) => formatMoney(minor, invoice.currency);

  async function run() {
    setBusy(true);
    try {
      const done = await write(
        () => importTimeAction(slug, invoice.id, { from, to, projectIds, groupBy, expenses }),
        "Imported",
      );
      if (done) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import time and expenses</DialogTitle>
          <DialogDescription>
            Billable time of {invoice.clientName}&apos;s projects rated in {invoice.currency}, not
            on an invoice yet, rounded as the reports round it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="import-from">From</Label>
            <Input
              id="import-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="import-to">To</Label>
            <Input id="import-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MultiSelectFilter
            label="Projects"
            options={projects}
            value={projectIds}
            onChange={setProjectIds}
          />
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as ImportGroup)}>
            <SelectTrigger size="sm" aria-label="Group by" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUPS.map((g) => (
                <SelectItem key={g.value} value={g.value}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Include expenses</span>
          <Switch aria-label="Include expenses" checked={expenses} onCheckedChange={setExpenses} />
        </label>
        <p data-testid="import-preview" className="bg-muted rounded-md px-3 py-2 text-sm">
          {!valid
            ? "Pick a range that ends after it starts."
            : !preview
              ? "Counting…"
              : [
                  `${preview.entries} ${preview.entries === 1 ? "entry" : "entries"} · ${hoursText(preview.seconds)} h · ${money(preview.amountMinor)}`,
                  preview.expenses > 0
                    ? `${preview.expenses} expense${preview.expenses === 1 ? "" : "s"} · ${money(preview.expenseMinor)}`
                    : null,
                  preview.skipped.otherCurrency + preview.skipped.unrated > 0
                    ? `skipped: ${preview.skipped.otherCurrency} in another currency, ${preview.skipped.unrated} unrated`
                    : null,
                  preview.skipped.expensesOtherCurrency > 0
                    ? `${preview.skipped.expensesOtherCurrency} expense${preview.skipped.expensesOtherCurrency === 1 ? "" : "s"} not importable: expenses are in the workspace currency, this invoice is in ${invoice.currency}`
                    : null,
                ]
                  .filter(Boolean)
                  .join("; ")}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !valid || !preview || preview.entries + preview.expenses === 0}
            onClick={() => void run()}
          >
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
