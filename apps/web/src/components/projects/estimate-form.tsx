"use client";

import {
  type Estimate,
  type EstimateInput,
  type EstimateKind,
  type EstimateReset,
  parseDuration,
  parseMoney,
} from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
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
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { setProjectEstimateAction } from "@/server/actions/estimates";

/**
 * Hours typed as a duration ("40", "1.5", "1:30", "90m") or, past the
 * duration parser's 999-hour ceiling, as a plain number of hours.
 */
export function parseHours(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  const parsed = parseDuration(text);
  if (parsed !== null) return parsed > 0 ? parsed : null;
  if (!/^\d+(?:[.,]\d+)?$/.test(text)) return null;
  const hours = Number(text.replace(",", "."));
  return hours > 0 ? Math.round(hours * 3600) : null;
}

/** Seconds as hours for the input: 5400 → "1.5", 36000 → "10". */
export function hoursText(seconds: number | null): string {
  if (seconds === null) return "";
  const hours = seconds / 3600;
  return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100);
}

const KINDS: { value: EstimateKind; label: string; help: string }[] = [
  { value: "NONE", label: "None", help: "No budget on this project." },
  { value: "TIME", label: "Time", help: "All work on the project, billable or not." },
  { value: "MONEY", label: "Money", help: "The billable amount, in the project's currency." },
];

/** The estimate's settings (Phase 6b, decision 12): kind, amount, period and alerts. */
export function EstimateForm({
  slug,
  projectId,
  estimate,
  currency,
  thresholds,
}: {
  slug: string;
  projectId: string;
  estimate: Estimate;
  currency: string;
  thresholds: number[];
}) {
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<EstimateKind>(estimate.kind);
  const [amount, setAmount] = useState(
    estimate.kind === "MONEY" && estimate.minor !== null
      ? (estimate.minor / 100).toString()
      : hoursText(estimate.seconds),
  );
  const [reset, setReset] = useState<EstimateReset>(estimate.reset);
  const [alerts, setAlerts] = useState(estimate.alerts);
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    let input: EstimateInput;
    if (kind === "NONE") {
      input = { kind, seconds: null, minor: null, reset: "NONE", alerts };
    } else if (kind === "TIME") {
      const seconds = parseHours(amount);
      if (seconds === null) return setError("Enter the hours, e.g. 40 or 1:30.");
      input = { kind, seconds, minor: null, reset, alerts };
    } else {
      const minor = parseMoney(amount, currency);
      if (minor === null || minor === 0) return setError(`Enter an amount in ${currency}.`);
      input = { kind, seconds: null, minor, reset, alerts };
    }
    setError(null);
    startTransition(async () => {
      const result = await setProjectEstimateAction(slug, projectId, input);
      if (!result.ok) {
        const field = result.fieldErrors?.seconds?.[0] ?? result.fieldErrors?.minor?.[0];
        if (field) setError(field);
        else toast.error(result.error);
        return;
      }
      toast.success("Estimate saved");
      router.refresh();
    });
  }

  const list = thresholds.length ? `${thresholds.join(", ")}%` : "no threshold yet";

  return (
    <form onSubmit={submit} aria-label="Estimate" className="space-y-5" noValidate>
      <RadioGroup
        aria-label="Estimate type"
        value={kind}
        onValueChange={(v) => {
          setKind(v as EstimateKind);
          setError(null);
        }}
        className="grid gap-2 sm:grid-cols-3"
      >
        {KINDS.map((k) => (
          <label key={k.value} className="flex items-start gap-3 rounded-md border px-3 py-2">
            <RadioGroupItem value={k.value} aria-label={k.label} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">{k.label}</span>
              <span className="text-muted-foreground block text-xs">{k.help}</span>
            </span>
          </label>
        ))}
      </RadioGroup>

      {kind !== "NONE" ? (
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-amount`}>
              {kind === "TIME" ? "Hours" : `Amount (${currency})`}
            </Label>
            <Input
              id={`${id}-amount`}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
            />
            {error ? (
              <p id={`${id}-error`} className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-period`}>Period</Label>
            <Select value={reset} onValueChange={(v) => setReset(v as EstimateReset)}>
              <SelectTrigger id={`${id}-period`} aria-label="Period" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Whole project</SelectItem>
                <SelectItem value="MONTHLY">Every month</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      {kind !== "NONE" ? (
        <div className="flex items-start gap-3">
          <Switch
            id={`${id}-alerts`}
            aria-label="Email alerts"
            checked={alerts}
            onCheckedChange={setAlerts}
            className="mt-0.5"
          />
          <div>
            <Label htmlFor={`${id}-alerts`}>Email alerts</Label>
            <p className="text-muted-foreground text-xs">
              Sent once a day to owners, admins and the project&apos;s managers when the estimate
              passes {list}.
            </p>
          </div>
        </div>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2Icon className="animate-spin" /> : null}
        Save estimate
      </Button>
    </form>
  );
}
