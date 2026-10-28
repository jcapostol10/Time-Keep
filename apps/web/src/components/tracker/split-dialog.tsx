"use client";

import {
  addDaysInZone,
  formatTimeOfDay,
  localDateKey,
  parseTimeOfDay,
  splitPoint,
  zonedDateTimeToInstant,
} from "@timekeep/core";
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
import { Loader2Icon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import type { TimeEntryDTO } from "@/lib/tracker-types";

import { useTracker } from "./tracker-provider";

/**
 * Split: a time inside the entry turns it into two with the same details.
 * The time is read on the entry's start day; one before the start belongs to
 * the next day, for entries that cross midnight.
 */
export function SplitDialog({
  entry,
  open,
  onOpenChange,
  onSplit,
}: {
  entry: TimeEntryDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSplit: (at: Date) => Promise<boolean>;
}) {
  const { viewer } = useTracker();
  const tz = viewer.timezone;
  const start = new Date(entry.start);
  const end = new Date(entry.end ?? entry.start);
  const id = useId();
  const [text, setText] = useState(() =>
    formatTimeOfDay(splitPoint({ start, end }), tz, viewer.timeFormat),
  );
  const [busy, setBusy] = useState(false);

  function resolve(): Date | null {
    const time = parseTimeOfDay(text);
    if (!time) return null;
    const at = zonedDateTimeToInstant({ date: localDateKey(start, tz), ...time }, tz);
    return at.getTime() <= start.getTime() ? addDaysInZone(at, 1, tz) : at;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Split entry</DialogTitle>
          <DialogDescription>
            Between {formatTimeOfDay(start, tz, viewer.timeFormat)} and{" "}
            {formatTimeOfDay(end, tz, viewer.timeFormat)}. Both parts keep the details and tags.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const at = resolve();
            if (!at) {
              toast.error("Enter a time like 9:30 or 2pm");
              return;
            }
            setBusy(true);
            const ok = await onSplit(at);
            setBusy(false);
            if (ok) onOpenChange(false);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={id}>Split at</Label>
            <Input
              id={id}
              value={text}
              inputMode="numeric"
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
              className="w-32 tabular-nums"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              Split
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
