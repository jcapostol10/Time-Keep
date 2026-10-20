"use client";

import { addDaysInZone, formatDuration, type Timesheet, type TimesheetRow } from "@timekeep/core";
import { cn } from "@timekeep/ui/lib/utils";
import type { KeyboardEvent } from "react";

import type { TimeEntryDTO } from "@/lib/tracker-types";

import { ColorDot } from "../tracker/project-picker";
import { useTracker } from "../tracker/tracker-provider";
import { dayHeading, type NameLookup, projectPart } from "./model";
import { TimesheetCell } from "./timesheet-cell";

/** Moves focus between cell inputs with the arrow keys. */
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
}: {
  sheet: Timesheet;
  entries: TimeEntryDTO[];
  names: NameLookup;
  weekStart: Date;
  today: string | null;
  hydrated: boolean;
  labelOf: (row: TimesheetRow) => string;
}) {
  const { viewer } = useTracker();
  const tz = viewer.timezone;
  const fmt = (s: number) => formatDuration(s, viewer.durationFormat);
  const headings = sheet.days.map((day, i) => ({
    day,
    label: dayHeading(addDaysInZone(weekStart, i, tz), tz),
  }));

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table
        role="grid"
        aria-label="Timesheet"
        data-hydrated={hydrated}
        onKeyDown={onGridKeyDown}
        className="w-full min-w-[56rem] border-collapse text-sm"
      >
        <thead className="bg-muted/40">
          <tr>
            <th
              scope="col"
              className="bg-muted/40 sticky left-0 z-10 w-56 min-w-56 px-3 py-2 text-left font-medium"
            >
              Row
            </th>
            {headings.map((h) => (
              <th
                key={h.day}
                scope="col"
                data-day={h.day}
                data-today={today === h.day ? "true" : undefined}
                className={cn(
                  "px-2 py-2 text-center font-medium",
                  today === h.day && "text-primary",
                )}
              >
                <span data-day-label>{h.label}</span>
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {sheet.rows.length === 0 ? (
            <tr>
              <td colSpan={9} className="text-muted-foreground px-3 py-10 text-center">
                No time this week. Add a row, copy last week or apply a template.
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
                    className="bg-background sticky left-0 z-10 w-56 min-w-56 px-3 py-1.5 text-left font-normal"
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
                  </th>
                  {sheet.days.map((day, colIndex) => (
                    <td key={day} className="p-1">
                      <TimesheetCell
                        row={row}
                        day={day}
                        label={`${label} ${headings[colIndex]!.label}`}
                        rowIndex={rowIndex}
                        colIndex={colIndex}
                        entries={entries}
                        cell={row.cells[day]!}
                        billableDefault={project?.billable ?? false}
                      />
                    </td>
                  ))}
                  <td aria-label={`Total ${label}`} className="px-3 py-1.5 text-right tabular-nums">
                    {fmt(row.totalSeconds)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
        <tfoot className="bg-muted/40 border-t">
          <tr>
            <th
              scope="row"
              className="bg-muted/40 sticky left-0 z-10 px-3 py-2 text-left font-medium"
            >
              Total
            </th>
            {headings.map((h) => (
              <td
                key={h.day}
                aria-label={`Total ${h.label}`}
                className="px-2 py-2 text-center tabular-nums"
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
