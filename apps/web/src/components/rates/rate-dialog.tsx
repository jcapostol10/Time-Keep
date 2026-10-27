"use client";

import { formatMoney, localDateKey, type RateApply } from "@timekeep/core";
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
import { RadioGroup, RadioGroupItem } from "@timekeep/ui/components/radio-group";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import type { RateTarget } from "@/lib/rate-types";
import { setRateAction } from "@/server/actions/rates";

import { trackerKeys } from "../tracker/query-keys";
import { useRateHistory, watchRateRecalc } from "./use-rates";

const APPLY: { value: RateApply; label: string }[] = [
  { value: "new", label: "New entries only" },
  { value: "from", label: "Entries from a date" },
  { value: "all", label: "All entries, past and future" },
];

function day(iso: string, timezone: string): string {
  const key = localDateKey(new Date(iso), timezone);
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Sets one rate (decision 3 of the Phase 4 design): a new rate applies to new
 * entries unless the person asks for past ones too, which runs a job.
 */
export function RateDialog({
  slug,
  target,
  title,
  currency,
  timezone,
  open,
  onOpenChange,
}: {
  slug: string;
  target: RateTarget;
  title: string;
  currency: string;
  /** The workspace's: effective dates are its midnights. */
  timezone: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const id = useId();
  const history = useRateHistory(slug, target, open);
  const [amount, setAmount] = useState("");
  const [apply, setApply] = useState<RateApply>("new");
  const [from, setFrom] = useState(() => localDateKey(new Date(), timezone));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fromLabel = from ? day(`${from}T12:00:00Z`, "UTC") : "the date you pick";
  const explain =
    apply === "new"
      ? "Entries already saved keep their current rate."
      : apply === "from"
        ? `Entries since ${fromLabel} are updated in the background.`
        : "Every entry is updated in the background.";

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const result = await setRateAction(slug, {
      ...target,
      amount: amount.trim() === "" ? null : amount,
      apply,
      from: apply === "from" ? from : undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.fieldErrors?.amount?.[0] ?? result.error);
      return;
    }
    if (result.data.jobId) watchRateRecalc(result.data.jobId);
    await Promise.all([
      qc.invalidateQueries({ queryKey: trackerKeys.rateRecalc(slug) }),
      qc.invalidateQueries({ queryKey: ["tracker", slug, "rates"] }),
    ]);
    toast.success(amount.trim() === "" ? "Rate removed" : "Rate saved");
    setAmount("");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            An hourly rate in {currency}. Leave it empty for no rate at this level.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor={`${id}-amount`}>Hourly rate ({currency})</Label>
            <Input
              id={`${id}-amount`}
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              aria-invalid={error ? true : undefined}
            />
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Apply to</legend>
            <RadioGroup value={apply} onValueChange={(v) => setApply(v as RateApply)}>
              {APPLY.map((o) => (
                <div key={o.value} className="flex items-center gap-2">
                  <RadioGroupItem value={o.value} id={`${id}-${o.value}`} />
                  <Label htmlFor={`${id}-${o.value}`} className="font-normal">
                    {o.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            {apply === "from" ? (
              <div className="space-y-1 pl-6">
                <Label htmlFor={`${id}-from`}>From</Label>
                <Input
                  id={`${id}-from`}
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-44"
                />
              </div>
            ) : null}
            <p className="text-muted-foreground text-sm">{explain}</p>
          </fieldset>
          <div>
            <p className="mb-1 text-sm font-medium">History</p>
            {history.data && history.data.history.length > 0 ? (
              <ul aria-label="History" className="max-h-40 space-y-1 overflow-y-auto text-sm">
                {history.data.history.map((r) => (
                  <li key={r.id} className="flex flex-wrap justify-between gap-x-3">
                    <span className="tabular-nums">
                      {r.amountMinor === null
                        ? "No rate"
                        : `${formatMoney(r.amountMinor, r.currency)} / h`}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(r.effectiveFrom).getTime() === 0
                        ? "from the beginning"
                        : `from ${day(r.effectiveFrom, timezone)}`}
                      {r.createdByName ? ` · ${r.createdByName}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">
                {history.isLoading ? "Loading…" : "No rate set yet."}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2Icon className="animate-spin" /> : null}
              Save rate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
