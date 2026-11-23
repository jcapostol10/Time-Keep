"use client";

import {
  addDaysInZone,
  formatDuration,
  rowKeyString,
  type Timesheet,
  type TimesheetRow,
  type TimesheetRowKey,
} from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import { cn } from "@timekeep/ui/lib/utils";
import { XIcon } from "lucide-react";
import type { KeyboardEvent } from "react";

import type { TimeEntryDTO } from "@/lib/tracker-types";

import type { TimeOffBand } from "../time-off/use-time-off-bands";
import { ColorDot } from "../tracker/project-picker";
import { useTracker } from "../tracker/tracker-provider";
import { movesHorizontally } from "./grid-keys";
import { dayHeading, type NameLookup, projectPart } from "./model";
import { TimesheetCell } from "./timesheet-cell";

/**
 * What stays put while the grid scrolls inside its frame: the header row and
 * the first column. Their fills are solid (a see-through one would show the
 * cells passing beneath), mixed from the tokens to match the rows they head.
 */
const FIRST_COL = "sticky left-0 z-10 w-36 min-w-36 md:w-56 md:min-w-56";
const HEAD = "bg-muted sticky top-0 z-20";
const BAND_FILL = "bg-[color-mix(in_srgb,var(--muted)_20%,var(--background))]";
/** Today's column: a faint tint of the primary, cell by cell. */
const TODAY = "bg-primary/5";
const TODAY_HEAD = "bg-[color-mix(in_srgb,var(--primary)_8%,var(--muted))] text-primary";

/** Moves focus between cell inputs with the arrow keys (Left and Right only at the text's edge). */
function onGridKeyDown(event: KeyboardEvent<HTMLTableElement>) {
  const target = event.target as HTMLElement;
  if (!(target instanceof HTMLInputElement) || target.dataset.row === undefined) return;
  const moves: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  };
  const move = moves[event.key];
  if (!move) return;
  if (
    (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
    !movesHorizontally(event.key, {
      start: target.selectionStart,
      end: target.selectionEnd,
      length: target.value.length,
    })
  ) {
    return;
  }
  event.preventDefault();
  const row = Number(target.dataset.row) + move[0];
  const col = Number(target.dataset.col) + move[1];
  const next = event.currentTarget.querySelector<HTMLInputElement>(
    `input[data-row="${row}"][data-col="${col}"]`,
  );
  if (next) {
    next.focus();
    next.select();
  }
}

export function TimesheetGrid({
  sheet,
  entries,
  names,
  weekStart,
  today,
  hydrated,
  labelOf,
  onKeepRow,
  removableRows,
  onRemoveRow,
  lockedDays = {},
  bands = [],
}: {
  sheet: Timesheet;
  entries: TimeEntryDTO[];
  names: NameLookup;
  weekStart: Date;
  today: string | null;
  hydrated: boolean;
  labelOf: (row: TimesheetRow) => string;
  onKeepRow?: (key: TimesheetRowKey) => void;
  /** Rows added by hand (`rowKeyString`); one with no time can be removed. */
  removableRows?: ReadonlySet<string>;
  onRemoveRow?: (key: TimesheetRowKey) => void;
  /** Why a day is closed to new time (lock date, submitted period), by date key. */
  lockedDays?: Record<string, string>;
  /** Approved time off and holidays: read-only, never in the totals (decision 8). */
  bands?: TimeOffBand[];
}) {
  const { viewer } = useTracker();
  const tz = viewer.timezone;
  const fmt = (s: number) => formatDuration(s, viewer.durationFormat);
  const headings = sheet.days.map((day, i) => ({
    day,
    label: dayHeading(addDaysInZone(weekStart, i, tz), tz),
  }));

  return (
    // The frame scrolls both ways, so the header can stay at its top: a table
    // that only scrolled sideways would let the page carry its header away.
    <div
      data-timesheet-scroller
      className="max-h-[calc(100svh-9rem)] overflow-auto rounded-lg border"
    >
      <table
        role="grid"
        aria-label="Timesheet"
        data-hydrated={hydrated}
        onKeyDown={onGridKeyDown}
        className="w-full min-w-[56rem] border-collapse text-sm"
      >
        <thead>
          <tr>
            <th scope="col" className={cn(HEAD, FIRST_COL, "z-30 px-3 py-2 text-left font-medium")}>
              Row
            </th>
            {headings.map((h) => (
              <th
                key={h.day}
                scope="col"
                data-day={h.day}
                data-today={today === h.day ? "true" : undefined}
                className={cn(
                  HEAD,
                  "px-2 py-2 text-center font-medium",
                  today === h.day && TODAY_HEAD,
                )}
              >
                <span data-day-label>{h.label}</span>
              </th>
            ))}
            <th scope="col" className={cn(HEAD, "px-3 py-2 text-right font-semibold")}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {sheet.rows.length === 0 ? (
            <tr>
              <td colSpan={9} className="text-muted-foreground px-3 py-10 md:text-center">
                {/* On a phone the grid is wider than the screen: the line stays where it can be read. */}
                <span className="sticky left-3 inline-block max-w-[calc(100vw-4rem)]">
                  No time this week. Add a row, copy last week or apply a template.
                </span>
              </td>
            </tr>
          ) : (
            sheet.rows.map((row, rowIndex) => {
              const label = labelOf(row);
              const project = row.projectId ? names.projects.get(row.projectId) : undefined;
              return (
                <tr key={row.key} className="border-t">
                  <th
                    scope="row"
                    className={cn(
                      FIRST_COL,
                      "bg-background px-3 py-0.5 pr-8 text-left font-normal",
                    )}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {project ? <ColorDot color={project.color} /> : null}
                      <span className="truncate font-medium">{projectPart(row, names)}</span>
                    </div>
                    {row.description ? (
                      <div className="text-muted-foreground truncate text-xs">
                        {row.description}
                      </div>
                    ) : null}
                    {onRemoveRow &&
                    row.totalSeconds === 0 &&
                    removableRows?.has(rowKeyString(row)) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove row ${label}`}
                        className="absolute right-1 top-1 size-6"
                        onClick={() => onRemoveRow(row)}
                      >
                        <XIcon className="size-3.5" />
                      </Button>
                    ) : null}
                  </th>
                  {sheet.days.map((day, colIndex) => (
                    <td
                      key={day}
                      data-today={today === day ? "true" : undefined}
                      className={cn("h-11 px-1 pb-1 pt-[3px]", today === day && TODAY)}
                    >
                      <TimesheetCell
                        row={row}
                        day={day}
                        label={`${label} ${headings[colIndex]!.label}`}
                        rowIndex={rowIndex}
                        colIndex={colIndex}
                        entries={entries}
                        cell={row.cells[day]!}
                        billableDefault={project?.billable ?? false}
                        onKeepRow={onKeepRow}
                        dayLockedReason={lockedDays[day] ?? null}
                      />
                    </td>
                  ))}
                  <td
                    aria-label={`Total ${label}`}
                    className="px-3 py-1.5 text-right font-semibold tabular-nums"
                  >
                    {fmt(row.totalSeconds)}
                  </td>
                </tr>
              );
            })
          )}
          {bands.map((band) => (
            <tr key={band.key} className="bg-muted/20 border-t">
              <th
                scope="row"
                className={cn(FIRST_COL, BAND_FILL, "truncate px-3 py-1.5 text-left font-medium")}
              >
                {band.label}
              </th>
              {sheet.days.map((day) => (
                <td
                  key={day}
                  className={cn(
                    "text-muted-foreground h-11 px-2 py-1.5 text-center tabular-nums",
                    today === day && TODAY,
                  )}
                >
                  {band.days[day] ?? ""}
                </td>
              ))}
              <td />
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-muted border-t">
          <tr>
            <th scope="row" className={cn(FIRST_COL, "bg-muted px-3 py-2 text-left font-semibold")}>
              Total
            </th>
            {headings.map((h) => (
              <td
                key={h.day}
                aria-label={`Total ${h.label}`}
                className={cn(
                  "h-11 px-2 py-2 text-center font-semibold tabular-nums",
                  today === h.day && TODAY_HEAD,
                )}
              >
                {fmt(sheet.dayTotals[h.day] ?? 0)}
              </td>
            ))}
            <td className="px-3 py-2 text-right font-semibold tabular-nums">
              {fmt(sheet.totalSeconds)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
