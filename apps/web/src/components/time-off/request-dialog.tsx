"use client";

import { formatCenti } from "@timekeep/core";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { Textarea } from "@timekeep/ui/components/textarea";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { fetchJson } from "@/lib/fetch-json";
import type { PolicyDTO, TimeOffPreviewDTO } from "@/lib/time-off-types";
import { requestTimeOffAction } from "@/server/actions/time-off";

import { timeOffKeys, timeOffUrls } from "../tracker/query-keys";

/**
 * Ask for time off: a policy, one day (full, half, or hours) or a range, and a
 * note. The server previews what it takes and what is left as the person types.
 */
export function RequestDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: [...timeOffKeys.policies(slug), "mine"],
    queryFn: () => fetchJson<{ policies: PolicyDTO[] }>(`${timeOffUrls.policies(slug)}?mine=1`),
  });
  const policies = data?.policies ?? [];
  const [policyId, setPolicyId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [half, setHalf] = useState(false);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const policy = policies.find((p) => p.id === policyId) ?? null;
  const oneDay = start !== "" && start === end;
  const halfDay = policy?.unit === "DAYS" && oneDay && half;

  const params = new URLSearchParams({ policyId, start, end });
  if (halfDay) params.set("halfDay", "1");
  if (policy?.unit === "HOURS" && hours) params.set("hours", hours);
  const ready = Boolean(policy && start && end && (policy.unit === "DAYS" || hours));
  const preview = useQuery({
    queryKey: timeOffKeys.preview(slug, params.toString()),
    queryFn: () =>
      fetchJson<{ preview?: TimeOffPreviewDTO; error?: string }>(
        timeOffUrls.preview(slug, params.toString()),
      ),
    enabled: ready,
  });

  async function submit() {
    setBusy(true);
    try {
      const result = await requestTimeOffAction(slug, {
        policyId,
        start,
        end,
        halfDay,
        hours: policy?.unit === "HOURS" ? hours : undefined,
        note,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.data.status === "APPROVED" ? "Time off approved" : "Time off requested");
      await qc.invalidateQueries({ queryKey: timeOffKeys.all(slug) });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const shown = ready ? preview.data : undefined;
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Request time off</DialogTitle>
            <DialogDescription>
              Dates are inclusive. Holidays and days off are not counted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="to-policy">Policy</Label>
            <Select value={policyId} onValueChange={setPolicyId}>
              <SelectTrigger id="to-policy" aria-label="Policy" className="w-full">
                <SelectValue placeholder={policies.length ? "Pick a policy" : "No policies yet"} />
              </SelectTrigger>
              <SelectContent>
                {policies.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="to-start">Start date</Label>
              <Input
                id="to-start"
                type="date"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  if (!end || end < e.target.value) setEnd(e.target.value);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to-end">End date</Label>
              <Input
                id="to-end"
                type="date"
                value={end}
                min={start || undefined}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
          {policy?.unit === "DAYS" && oneDay ? (
            <RadioGroup
              value={half ? "half" : "full"}
              onValueChange={(v) => setHalf(v === "half")}
              className="flex gap-4"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="full" aria-label="Full day" /> Full day
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="half" aria-label="Half day" /> Half day
              </label>
            </RadioGroup>
          ) : null}
          {policy?.unit === "HOURS" ? (
            <div className="space-y-2">
              <Label htmlFor="to-hours">{oneDay ? "Hours" : "Total hours"}</Label>
              <Input
                id="to-hours"
                inputMode="decimal"
                placeholder="4 or 4:30"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="to-note">Note</Label>
            <Textarea
              id="to-note"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <p className="text-sm" aria-live="polite">
            {shown?.error ? (
              <span className="text-destructive">{shown.error}</span>
            ) : shown?.preview ? (
              shown.preview.unlimited ? (
                `Takes ${formatCenti(shown.preview.amountCenti, shown.preview.unit)} (unlimited)`
              ) : (
                `Balance: ${formatCenti(shown.preview.balanceCenti, shown.preview.unit)} → ${formatCenti(shown.preview.afterCenti, shown.preview.unit)}`
              )
            ) : null}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !ready || Boolean(shown?.error)}>
              Request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
