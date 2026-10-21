"use client";

import {
  formatDuration,
  parseDuration,
  planCellChange,
  type TimesheetCell as CellData,
  type TimesheetEntry,
  type TimesheetRow,
  type TimesheetRowKey,
} from "@timekeep/core";
import { Input } from "@timekeep/ui/components/input";
import { useState } from "react";
import { toast } from "sonner";

import type { TimeEntryDTO } from "@/lib/tracker-types";

import { useTracker } from "../tracker/tracker-provider";
import { useEntryWrites } from "../tracker/use-entry-writes";
import { CellEntriesDialog } from "./cell-entries-dialog";
import { toTimesheetEntries } from "./model";

/**
 * One editable cell. Shows the sum of its entries; typing a new total is
 * turned into one write by `planCellChange`, or into the entries dialog when
 * the cell holds several entries and the new total is below what the others
 * add up to.
 */
export function TimesheetCell({
  row,
  day,
  label,
  rowIndex,
  colIndex,
  entries,
  cell,
  billableDefault,
  onKeepRow,
}: {
  row: TimesheetRow;
  day: string;
  label: string;
  rowIndex: number;
  colIndex: number;
  entries: TimeEntryDTO[];
  cell: CellData;
  billableDefault: boolean;
  /** Called before a delete that may empty the row, so the row stays for the visit. */
  onKeepRow?: (row: TimesheetRowKey) => void;
}) {
  const { viewer } = useTracker();
  const writes = useEntryWrites();
  const shown = cell.seconds > 0 ? formatDuration(cell.seconds, viewer.durationFormat) : "";
  // Local text while editing; null means "show the saved value".
  const [text, setText] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<TimesheetEntry[] | null>(null);

  async function commit(raw: string) {
    setText(null);
    const trimmed = raw.trim();
    const seconds = trimmed === "" ? 0 : parseDuration(trimmed);
    if (seconds === null) {
      toast.error("Enter a duration like 1:30, 1.5 or 90m");
      return;
    }
    const all = toTimesheetEntries(entries);
    const plan = planCellChange({
      cellEntries: all.filter((e) => cell.entryIds.includes(e.id)),
      dayEntries: all,
      newSeconds: seconds,
      dayKey: day,
      tz: viewer.timezone,
    });
    switch (plan.kind) {
      case "noop":
        return;
      case "create":
        await writes.createManual({
          description: row.description,
          projectId: row.projectId,
          taskId: row.taskId,
          tagIds: [],
          billable: row.projectId ? billableDefault : false,
          start: plan.start.toISOString(),
          end: plan.end.toISOString(),
        });
        return;
      case "update":
        await writes.update(plan.entryId, { end: plan.end.toISOString() });
        return;
      case "delete":
        onKeepRow?.(row);
        await writes.remove(plan.entryIds);
        return;
      case "choose":
        setChoosing(plan.entries);
        return;
      case "reject":
        toast.error(plan.message);
        return;
    }
  }

  return (
    <>
      <Input
        aria-label={label}
        data-row={rowIndex}
        data-col={colIndex}
        inputMode="text"
        value={text ?? shown}
        placeholder="0:00"
        onFocus={(e) => e.target.select()}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          if (text !== null) void commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setText(null);
          }
        }}
        className="h-8 w-full min-w-20 text-center tabular-nums"
      />
      {choosing ? (
        <CellEntriesDialog
          entryIds={choosing.map((e) => e.id)}
          entries={entries}
          open
          onOpenChange={(open) => !open && setChoosing(null)}
        />
      ) : null}
    </>
  );
}
