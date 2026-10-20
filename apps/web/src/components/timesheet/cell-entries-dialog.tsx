"use client";

import { formatDuration, formatTimeOfDay, parseDuration } from "@timekeep/core";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import { Input } from "@timekeep/ui/components/input";
import { useState } from "react";
import { toast } from "sonner";

import type { TimeEntryDTO } from "@/lib/tracker-types";

import { useTracker } from "../tracker/tracker-provider";
import { useEntryWrites } from "../tracker/use-entry-writes";

/** The entries behind one cell, each with its own editable duration. */
export function CellEntriesDialog({
  entryIds,
  entries,
  open,
  onOpenChange,
}: {
  entryIds: string[];
  entries: TimeEntryDTO[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { viewer } = useTracker();
  const rows = entryIds.flatMap((id) => {
    const e = entries.find((x) => x.id === id);
    return e && e.end ? [e] : [];
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label="Entries in this cell" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Entries in this cell</DialogTitle>
          <DialogDescription>
            The new total is less than these entries add up to. Change the one you mean.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-md border">
          {rows.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2">
              <span className="text-muted-foreground w-28 shrink-0 text-xs tabular-nums">
                {formatTimeOfDay(new Date(e.start), viewer.timezone, viewer.timeFormat)} –{" "}
                {formatTimeOfDay(new Date(e.end!), viewer.timezone, viewer.timeFormat)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {e.description || <span className="text-muted-foreground">(no description)</span>}
              </span>
              <DurationField entry={e} />
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function DurationField({ entry }: { entry: TimeEntryDTO }) {
  const { viewer } = useTracker();
  const writes = useEntryWrites();
  const saved = formatDuration(entry.durationSeconds ?? 0, viewer.durationFormat);
  const [text, setText] = useState<string | null>(null);

  async function commit(raw: string) {
    setText(null);
    const seconds = parseDuration(raw.trim());
    if (seconds === null) {
      toast.error("Enter a duration like 1:30, 1.5 or 90m");
      return;
    }
    if (seconds === 0) {
      await writes.remove([entry.id]);
      return;
    }
    const end = new Date(new Date(entry.start).getTime() + seconds * 1000);
    await writes.update(entry.id, { end: end.toISOString() });
  }

  return (
    <Input
      aria-label="Duration"
      value={text ?? saved}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => {
        if (text !== null) void commit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void commit(e.currentTarget.value);
        }
      }}
      className="h-8 w-24 text-center tabular-nums"
    />
  );
}
