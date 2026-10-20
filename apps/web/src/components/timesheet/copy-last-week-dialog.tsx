"use client";

import { addDaysInZone, rowKeyString, type TimesheetRowKey } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import { RadioGroup, RadioGroupItem } from "@timekeep/ui/components/radio-group";
import { Loader2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { copyWeekAction } from "@/server/actions/timesheet";

import { trackSave } from "../tracker/saving-store";
import { useEntryWrites } from "../tracker/use-entry-writes";
import { useRangeEntries } from "./use-timesheet";

/** Copies last week's rows, or its rows and their time, into the shown week. */
export function CopyLastWeekDialog({
  slug,
  weekStart,
  tz,
  open,
  onOpenChange,
  onRows,
}: {
  slug: string;
  weekStart: Date;
  tz: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRows: (rows: TimesheetRowKey[]) => void;
}) {
  const lastWeekStart = addDaysInZone(weekStart, -7, tz);
  const { data: lastWeek, isLoading } = useRangeEntries(
    slug,
    lastWeekStart.toISOString(),
    weekStart.toISOString(),
    open,
  );
  const [mode, setMode] = useState<"rows" | "time">("rows");
  const [busy, setBusy] = useState(false);
  const writes = useEntryWrites();

  const rowKeys = () => {
    const seen = new Map<string, TimesheetRowKey>();
    for (const e of lastWeek ?? []) {
      const key = { projectId: e.projectId, taskId: e.taskId, description: e.description };
      seen.set(rowKeyString(key), key);
    }
    return [...seen.values()];
  };

  async function confirm() {
    if (mode === "rows") {
      onRows(rowKeys());
      onOpenChange(false);
      return;
    }
    setBusy(true);
    const result = await trackSave(() =>
      copyWeekAction(slug, {
        fromWeekStart: lastWeekStart.toISOString(),
        toWeekStart: weekStart.toISOString(),
      }),
    );
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    writes.settle();
    toast.success(
      result.data.length === 1 ? "1 entry copied" : `${result.data.length} entries copied`,
    );
    onOpenChange(false);
  }

  const count = lastWeek?.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copy last week</DialogTitle>
          <DialogDescription>
            {isLoading
              ? "Looking at last week…"
              : count === 0
                ? "Last week has no entries."
                : `Last week has ${count} ${count === 1 ? "entry" : "entries"}.`}
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          aria-label="What to copy"
          value={mode}
          onValueChange={(v) => setMode(v as "rows" | "time")}
        >
          <label className="flex items-start gap-3">
            <RadioGroupItem value="rows" aria-label="Rows only" className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Rows only</span>
              <span className="text-muted-foreground block text-xs">
                {"Add last week's project, task and description rows, empty."}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <RadioGroupItem value="time" aria-label="Rows and time" className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Rows and time</span>
              <span className="text-muted-foreground block text-xs">
                Create the same entries seven days later, at the same times.
              </span>
            </span>
          </label>
        </RadioGroup>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy || isLoading || count === 0}>
            {busy ? <Loader2Icon className="animate-spin" /> : null}
            Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
