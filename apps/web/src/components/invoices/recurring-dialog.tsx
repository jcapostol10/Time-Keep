"use client";

import {
  formatQuantity,
  type ImportGroup,
  minorToDecimal,
  parseCenti,
  parseMoney,
  type RecurringMode,
  type RecurringScheduleKind,
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
import { RadioGroup, RadioGroupItem } from "@timekeep/ui/components/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { Switch } from "@timekeep/ui/components/switch";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import type { RecurringInvoiceDTO } from "@/lib/invoice-types";
import { createRecurringAction, updateRecurringAction } from "@/server/actions/recurring-invoices";

import { useInvoiceWrite } from "./use-invoices";
import { WEEKDAYS } from "./status";

interface LineDraft {
  description: string;
  quantity: string;
  price: string;
}

/** A recurring template: a schedule, fixed lines and/or the period's time, a draft or sent. */
export function RecurringDialog({
  slug,
  template,
  clients,
  today,
  currency,
  onClose,
}: {
  slug: string;
  template: RecurringInvoiceDTO | null;
  clients: { id: string; name: string }[];
  today: string;
  currency: string;
  onClose: () => void;
}) {
  const write = useInvoiceWrite(slug);
  const [name, setName] = useState(template?.name ?? "");
  const [clientId, setClientId] = useState(template?.clientId ?? "");
  const [schedule, setSchedule] = useState<RecurringScheduleKind>(template?.schedule ?? "MONTHLY");
  const [weekday, setWeekday] = useState(String(template?.weekday ?? 1));
  const [dayOfMonth, setDayOfMonth] = useState(String(template?.dayOfMonth ?? 1));
  const [startDate, setStartDate] = useState(template?.startDate ?? today);
  const [endDate, setEndDate] = useState(template?.endDate ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    (template?.lines ?? []).map((l) => ({
      description: l.description,
      quantity: formatQuantity(l.quantityCenti),
      price: minorToDecimal(l.unitPriceMinor, currency),
    })),
  );
  const [importPeriod, setImportPeriod] = useState(template?.importPeriod ?? false);
  const [importGroupBy, setImportGroupBy] = useState<ImportGroup>(
    template?.importGroupBy ?? "project",
  );
  const [mode, setMode] = useState<RecurringMode>(template?.mode ?? "DRAFT");
  const [active, setActive] = useState(template?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function save() {
    const parsed = [];
    for (const [i, l] of lines.entries()) {
      const quantityCenti = parseCenti(l.quantity);
      const unitPriceMinor = parseMoney(l.price, currency);
      if (
        !l.description.trim() ||
        quantityCenti === null ||
        quantityCenti <= 0 ||
        unitPriceMinor === null
      ) {
        return setError(`Line ${i + 1} needs a description, a quantity and a unit price.`);
      }
      parsed.push({ description: l.description, quantityCenti, unitPriceMinor });
    }
    const day = Number(dayOfMonth);
    if (schedule === "MONTHLY" && !(Number.isInteger(day) && day >= 1 && day <= 31)) {
      return setError("Pick a day of the month from 1 to 31.");
    }
    const input = {
      clientId,
      name,
      schedule,
      weekday: schedule === "WEEKLY" ? Number(weekday) : null,
      dayOfMonth: schedule === "MONTHLY" ? day : null,
      startDate,
      endDate: endDate || null,
      lines: parsed,
      importPeriod,
      importGroupBy,
      mode,
      active,
    };
    setBusy(true);
    try {
      const saved = await write(
        () =>
          template
            ? updateRecurringAction(slug, template.id, input)
            : createRecurringAction(slug, input),
        "Recurring invoice saved",
      );
      if (saved) onClose();
    } finally {
      setBusy(false);
    }
  }

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
            <DialogTitle>
              {template ? "Edit recurring invoice" : "New recurring invoice"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="recurring-name">Name</Label>
              <Input
                id="recurring-name"
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recurring-client">Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger id="recurring-client" aria-label="Client" className="w-full">
                  <SelectValue placeholder="Pick a client" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Schedule</legend>
            <RadioGroup
              value={schedule}
              onValueChange={(v) => setSchedule(v === "WEEKLY" ? "WEEKLY" : "MONTHLY")}
              className="flex gap-4"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="WEEKLY" aria-label="Weekly" /> Weekly
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="MONTHLY" aria-label="Monthly" /> Monthly
              </label>
            </RadioGroup>
          </fieldset>
          {schedule === "WEEKLY" ? (
            <div className="space-y-2">
              <Label htmlFor="recurring-weekday">Weekday</Label>
              <Select value={weekday} onValueChange={setWeekday}>
                <SelectTrigger id="recurring-weekday" aria-label="Weekday" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((d, i) => (
                    <SelectItem key={d} value={String(i)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">Bills the seven days before it.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="recurring-day">Day of month</Label>
              <Input
                id="recurring-day"
                inputMode="numeric"
                className="w-24"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Bills the previous month; 31 means the month&apos;s last day.
              </p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="recurring-start">Start date</Label>
              <Input
                id="recurring-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recurring-end">End date</Label>
              <Input
                id="recurring-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Lines ({currency})</legend>
            {lines.map((l, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label={`Line ${i + 1} description`}
                  placeholder="Description"
                  className="min-w-40 flex-1"
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                />
                <Input
                  aria-label={`Line ${i + 1} quantity`}
                  placeholder="Qty"
                  inputMode="decimal"
                  className="w-20"
                  value={l.quantity}
                  onChange={(e) => setLine(i, { quantity: e.target.value })}
                />
                <Input
                  aria-label={`Line ${i + 1} unit price`}
                  placeholder="Price"
                  inputMode="decimal"
                  className="w-28"
                  value={l.price}
                  onChange={(e) => setLine(i, { price: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove line ${i + 1}`}
                  onClick={() => setLines((all) => all.filter((_, j) => j !== i))}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setLines((all) => [...all, { description: "", quantity: "1", price: "" }])
              }
            >
              Add line
            </Button>
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-3 text-sm">
              <Switch
                aria-label="Import the period just ended"
                checked={importPeriod}
                onCheckedChange={setImportPeriod}
              />
              Import the period just ended
            </label>
            {importPeriod ? (
              <Select
                value={importGroupBy}
                onValueChange={(v) => setImportGroupBy(v as ImportGroup)}
              >
                <SelectTrigger size="sm" aria-label="Group by" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">Project</SelectItem>
                  <SelectItem value="task">Task</SelectItem>
                  <SelectItem value="user">Person</SelectItem>
                  <SelectItem value="entry">Entry</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Mode</legend>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v === "SEND" ? "SEND" : "DRAFT")}
              className="flex flex-wrap gap-4"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="DRAFT" aria-label="Create a draft" /> Create a draft
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="SEND" aria-label="Create and send" /> Create and send
              </label>
            </RadioGroup>
          </fieldset>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Active</span>
            <Switch aria-label="Active" checked={active} onCheckedChange={setActive} />
          </label>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || !clientId}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
