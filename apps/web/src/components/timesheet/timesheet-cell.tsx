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
import { useRef, useState } from "react";
import { toast } from "sonner";

import type { TimeEntryDTO } from "@/lib/tracker-types";

import { useCanWriteTimes, useTracker } from "../tracker/tracker-provider";
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
  dayLockedReason,
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
  /** The day is closed to new time (an empty cell is read-only too). */
  dayLockedReason?: string | null;
}) {
  const { viewer } = useTracker();
  const canWriteTimes = useCanWriteTimes();
  const writes = useEntryWrites();
  const shown = cell.seconds > 0 ? formatDuration(cell.seconds, viewer.durationFormat) : "";
  // Local text while editing; null means "show the saved value".
  const [text, setText] = useState<string | null>(null);
  // The value being saved, shown until the write lands; not an edit, so a blur
  // or a second Enter meanwhile writes nothing.
  const [pending, setPending] = useState<string | null>(null);
  const saving = useRef(false);
  const [choosing, setChoosing] = useState<TimesheetEntry[] | null>(null);
  // An entry in a locked day or a submitted period makes the cell read-only (Phase 5a).
  const lockedReason =
    entries.find((e) => cell.entryIds.includes(e.id) && e.lockedReason)?.lockedReason ??
    dayLockedReason ??
    null;
  const readOnly = !canWriteTimes || lockedReason !== null;

  async function commit(raw: string) {
    if (readOnly || saving.current) return;
    setText(null);
    const trimmed = raw.trim();
    const seconds = trimmed === "" ? 0 : parseDuration(trimmed);
    if (seconds === null) {
      toast.error("Enter a duration like 1:30, 1.5 or 90m");
      return;
    }
    // The new value shows while the write is in flight; the range cache holds it after.
    saving.current = true;
    setPending(seconds === 0 ? "" : formatDuration(seconds, viewer.durationFormat));
    try {
      await applyCell(seconds);
    } finally {
      saving.current = false;
      setPending(null);
    }
  }

  async function applyCell(seconds: number) {
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
        readOnly={readOnly}
        title={lockedReason ?? undefined}
        data-row={rowIndex}
        data-col={colIndex}
        inputMode="text"
        value={text ?? pending ?? shown}
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
