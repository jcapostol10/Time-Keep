"use client";

import {
  formatDateInZone,
  formatDuration,
  formatMoney,
  formatTimeOfDay,
  localDateKey,
  parseDuration,
  parseTimeOfDay,
  withDuration,
  withEndTime,
  withStartTime,
} from "@timekeep/core";
import { Checkbox } from "@timekeep/ui/components/checkbox";
import { TableCell, TableRow } from "@timekeep/ui/components/table";
import { Badge } from "@timekeep/ui/components/badge";
import { DollarSignIcon } from "lucide-react";
import { toast } from "sonner";

import type { DetailedEntryDTO } from "@/lib/report-types";

import { BillableToggle } from "../tracker/billable-toggle";
import { CommitInput } from "../tracker/manual-entry-fields";
import { ColorDot, ProjectPicker } from "../tracker/project-picker";
import { useTracker } from "../tracker/tracker-provider";
import { type UpdateEntryPatch, useEntryWrites } from "../tracker/use-entry-writes";
import type { DetailedColumn } from "./detailed-columns";

const INPUT = "hover:border-input h-8 border-transparent shadow-none";

function entryName(entry: DetailedEntryDTO) {
  return entry.description || "(no description)";
}

/**
 * One entry of the Detailed report. A person's own entry edits in place with
 * the tracker's fields and rules; anyone else's is read-only until Phase 4.
 */
export function DetailedRow({
  entry,
  hidden,
  currency,
  selected,
  onSelectedChange,
}: {
  entry: DetailedEntryDTO;
  hidden: ReadonlySet<DetailedColumn>;
  /** The workspace currency when the viewer may see amounts; null hides the column. */
  currency: string | null;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}) {
  const { slug, viewer, canCreate, rules } = useTracker();
  const writes = useEntryWrites();
  const tz = viewer.timezone;
  const times = { start: new Date(entry.start), end: new Date(entry.end) };
  const crossesMidnight = localDateKey(times.end, tz) !== localDateKey(times.start, tz);
  const show = (key: DetailedColumn) => !hidden.has(key) && (key !== "amount" || currency !== null);

  function save(patch: UpdateEntryPatch) {
    void writes.update(entry.id, patch);
  }

  function editTime(which: "start" | "end", text: string) {
    const time = parseTimeOfDay(text);
    if (!time) {
      toast.error("Enter a time like 9:30 or 2pm");
      return;
    }
    const next = which === "start" ? withStartTime(times, time, tz) : withEndTime(times, time, tz);
    save({ start: next.start.toISOString(), end: next.end.toISOString() });
  }

  function editDuration(text: string) {
    const seconds = parseDuration(text);
    if (seconds === null || seconds <= 0) {
      toast.error("Enter a duration like 1:30, 1.5 or 90m");
      return;
    }
    save({ end: withDuration(times, seconds).end.toISOString() });
  }

  const timeText = `${formatTimeOfDay(times.start, tz, viewer.timeFormat)} – ${formatTimeOfDay(times.end, tz, viewer.timeFormat)}`;
  const durationText = formatDuration(entry.durationSeconds, viewer.durationFormat);

  return (
    <TableRow aria-label={`Entry ${entryName(entry)}`} data-entry-id={entry.id}>
      <TableCell className="w-8 pr-0">
        {entry.editable ? (
          <Checkbox
            aria-label={`Select ${entryName(entry)}`}
            checked={selected}
            onCheckedChange={(checked) => onSelectedChange(checked === true)}
          />
        ) : null}
      </TableCell>
      <TableCell className="min-w-48">
        {entry.editable ? (
          <CommitInput
            label="Description"
            value={entry.description}
            placeholder="Add description"
            onCommit={(description) => save({ description })}
            className={`${INPUT} w-full`}
          />
        ) : (
          <span className={entry.description ? "" : "text-muted-foreground"}>
            {entryName(entry)}
          </span>
        )}
      </TableCell>
      {show("project") ? (
        <TableCell>
          {entry.type === "break" ? (
            <Badge variant="secondary">Break</Badge>
          ) : entry.editable ? (
            <ProjectPicker
              slug={slug}
              value={{ projectId: entry.projectId, taskId: entry.taskId }}
              current={{
                project: entry.projectName
                  ? { name: entry.projectName, color: entry.projectColor ?? "#888888" }
                  : null,
                task: entry.taskName ? { name: entry.taskName } : null,
              }}
              compact
              canCreate={canCreate.project}
              onChange={(sel) => save({ projectId: sel.projectId, taskId: sel.taskId })}
            />
          ) : entry.projectName ? (
            <span className="flex items-center gap-1.5">
              <ColorDot color={entry.projectColor ?? "#888888"} />
              {entry.projectName}
              {entry.taskName ? (
                <span className="text-muted-foreground">› {entry.taskName}</span>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">No project</span>
          )}
        </TableCell>
      ) : null}
      {show("client") ? (
        <TableCell className="text-muted-foreground">{entry.clientName ?? "—"}</TableCell>
      ) : null}
      {show("user") ? <TableCell>{entry.userName}</TableCell> : null}
      {show("tags") ? (
        <TableCell className="text-muted-foreground text-xs">
          {entry.tags.join(", ") || "—"}
        </TableCell>
      ) : null}
      {show("billable") ? (
        <TableCell>
          {entry.editable ? (
            <BillableToggle value={entry.billable} onChange={(billable) => save({ billable })} />
          ) : entry.billable ? (
            <DollarSignIcon className="text-primary size-4" aria-label="Billable" />
          ) : null}
        </TableCell>
      ) : null}
      {show("date") ? (
        <TableCell className="whitespace-nowrap tabular-nums">
          {formatDateInZone(times.start, tz, viewer.dateFormat)}
        </TableCell>
      ) : null}
      {show("time") ? (
        <TableCell className="whitespace-nowrap tabular-nums">
          {entry.editable ? (
            <span className="flex items-center gap-0.5">
              <CommitInput
                label="Start time"
                value={formatTimeOfDay(times.start, tz, viewer.timeFormat)}
                onCommit={(t) => editTime("start", t)}
                disabled={!rules.canWriteTimes}
                className={`${INPUT} w-[5.25rem]`}
              />
              <span aria-hidden>–</span>
              <CommitInput
                label="End time"
                value={formatTimeOfDay(times.end, tz, viewer.timeFormat)}
                onCommit={(t) => editTime("end", t)}
                disabled={!rules.canWriteTimes}
                className={`${INPUT} w-[5.25rem]`}
              />
              {crossesMidnight ? <sup className="text-muted-foreground">+1</sup> : null}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {timeText}
              {crossesMidnight ? <sup className="ml-0.5">+1</sup> : null}
            </span>
          )}
        </TableCell>
      ) : null}
      {show("duration") ? (
        <TableCell className="text-right tabular-nums">
          {entry.editable ? (
            <CommitInput
              label="Duration"
              value={durationText}
              onCommit={editDuration}
              disabled={!rules.canWriteTimes}
              className={`${INPUT} w-[6rem] text-right font-semibold`}
            />
          ) : (
            <span className="font-semibold">{durationText}</span>
          )}
        </TableCell>
      ) : null}
      {show("amount") && currency ? (
        <TableCell className="text-right tabular-nums">
          {entry.amountMinor === null ? (
            <span
              className="text-muted-foreground"
              title={entry.billable ? "No rate" : "Not billable"}
            >
              —
            </span>
          ) : (
            formatMoney(entry.amountMinor, currency)
          )}
        </TableCell>
      ) : null}
    </TableRow>
  );
}
