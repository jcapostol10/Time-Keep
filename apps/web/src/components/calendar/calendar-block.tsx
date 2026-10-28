"use client";

import { type DayBlock, type DurationFormat, formatDuration, SLOT_MINUTES } from "@timekeep/core";
import { cn } from "@timekeep/ui/lib/utils";

import type { TimeEntryDTO } from "@/lib/tracker-types";

const SLOT_PX = 16;

export function minutesToPx(minutes: number): number {
  return (minutes / SLOT_MINUTES) * SLOT_PX;
}

export function projectLabel(entry: TimeEntryDTO): string {
  if (entry.type === "break") return "Break";
  if (!entry.project) return "No project";
  return entry.task ? `${entry.project.name} › ${entry.task.name}` : entry.project.name;
}

/** One entry on one day; the drag hook reads its data attributes. */
export function CalendarBlock({
  entry,
  geometry,
  layout,
  durationFormat,
}: {
  entry: TimeEntryDTO;
  geometry: DayBlock;
  layout: { column: number; columns: number };
  durationFormat: DurationFormat;
}) {
  const color = entry.type === "break" ? "#64748b" : (entry.project?.color ?? "#64748b");
  const duration = formatDuration(entry.durationSeconds ?? 0, durationFormat);
  const name = `${entry.description || "(no description)"}, ${projectLabel(entry)}, ${duration}`;
  const height = Math.max(minutesToPx(geometry.height), SLOT_PX);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={name}
      data-entry-id={entry.id}
      data-color={color}
      data-column={layout.column}
      data-columns={layout.columns}
      className={cn(
        "shadow-xs absolute z-10 cursor-grab touch-none select-none overflow-hidden rounded border-l-[3px] px-1.5 py-0.5 text-xs",
        geometry.clippedStart && "rounded-t-none",
        geometry.clippedEnd && "rounded-b-none",
      )}
      style={{
        top: minutesToPx(geometry.top),
        height,
        left: `calc(${(layout.column / layout.columns) * 100}% + 2px)`,
        width: `calc(${100 / layout.columns}% - 4px)`,
        borderLeftColor: color,
        backgroundColor: `color-mix(in srgb, ${color} 18%, var(--card))`,
      }}
    >
      {!geometry.clippedStart ? (
        <div data-resize="start" className="absolute inset-x-0 top-0 h-2 cursor-ns-resize" />
      ) : null}
      <div className="truncate font-medium">{entry.description || "(no description)"}</div>
      {height >= 2 * SLOT_PX ? (
        <div className="text-muted-foreground truncate">
          {projectLabel(entry)} · {duration}
        </div>
      ) : null}
      {!geometry.clippedEnd ? (
        <div data-resize="end" className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize" />
      ) : null}
    </div>
  );
}
