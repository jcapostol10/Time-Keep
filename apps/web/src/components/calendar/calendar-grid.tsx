"use client";

import {
  blockOnDay,
  formatClock,
  layoutColumns,
  MINUTES_PER_DAY,
  SLOT_MINUTES,
  zonedDateTimeToInstant,
} from "@timekeep/core";
import { cn } from "@timekeep/ui/lib/utils";
import { useEffect, useRef } from "react";

import type { TimeEntryDTO } from "@/lib/tracker-types";

import { useTracker, useTrackerClock } from "../tracker/tracker-provider";
import { CalendarBlock, minutesToPx } from "./calendar-block";
import { NowLine } from "./now-line";
import { useCalendarDrag } from "./use-calendar-drag";

/** Pixels per 15-minute slot: 64px an hour, 1536px a day. */
export const SLOT_PX = 16;
const DAY_PX = (MINUTES_PER_DAY / SLOT_MINUTES) * SLOT_PX;
const OPEN_AT_MINUTES = 7 * 60;

export function CalendarGrid({
  days,
  entries,
  today,
  hydrated,
  onCreate,
  onMove,
  onResize,
  onEdit,
}: {
  days: string[];
  entries: TimeEntryDTO[];
  today: string | null;
  hydrated: boolean;
  onCreate: (dayKey: string, a: number, b: number) => void;
  onMove: (entry: TimeEntryDTO, dayKey: string, startMinutes: number) => void;
  onResize: (entry: TimeEntryDTO, edge: "start" | "end", dayKey: string, minutes: number) => void;
  onEdit: (entry: TimeEntryDTO) => void;
}) {
  const { viewer, running } = useTracker();
  const tz = viewer.timezone;
  const scrollRef = useRef<HTMLDivElement>(null);
  const { ghost, handlers } = useCalendarDrag({ entries, onCreate, onMove, onResize, onEdit });

  // Open the day on the morning rather than on midnight.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollTop === 0) el.scrollTop = minutesToPx(OPEN_AT_MINUTES) - 8;
  }, []);

  const hours = Array.from({ length: 24 }, (_, h) => h);
  const hourLabel = (h: number) =>
    viewer.timeFormat === "12h"
      ? `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`
      : `${String(h).padStart(2, "0")}:00`;
  const dayHeading = (dayKey: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", day: "numeric" }).format(
      zonedDateTimeToInstant({ date: dayKey, hours: 12, minutes: 0 }, tz),
    );

  return (
    <div data-calendar data-hydrated={hydrated} className="rounded-lg border">
      <div className="bg-muted/40 flex border-b">
        <div className="w-14 shrink-0" />
        {days.map((day) => (
          <div
            key={day}
            className={cn(
              "flex-1 px-2 py-2 text-center text-sm font-medium",
              today === day && "text-primary",
            )}
          >
            {dayHeading(day)}
          </div>
        ))}
      </div>
      <div ref={scrollRef} data-scroll className="max-h-[70vh] overflow-auto">
        <div className="flex" style={{ height: DAY_PX }}>
          <div className="relative w-14 shrink-0 select-none">
            {hours.map((h) => (
              <div
                key={h}
                className="text-muted-foreground absolute right-2 -translate-y-1/2 text-[11px] tabular-nums"
                style={{ top: minutesToPx(h * 60) }}
              >
                {h === 0 ? "" : hourLabel(h)}
              </div>
            ))}
          </div>
          <div className="flex flex-1" {...handlers}>
            {days.map((day) => {
              const blocks = entries.flatMap((e) => {
                if (!e.end) return [];
                const geometry = blockOnDay({ start: e.start, end: e.end }, day, tz);
                return geometry ? [{ entry: e, geometry, id: e.id }] : [];
              });
              const layout = layoutColumns(
                blocks.map((b) => ({ id: b.id, top: b.geometry.top, height: b.geometry.height })),
              );
              return (
                <div
                  key={day}
                  data-day={day}
                  className="relative min-w-0 flex-1 border-l"
                  style={{
                    height: DAY_PX,
                    backgroundImage:
                      "repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent 64px)",
                  }}
                >
                  {blocks.map((b) => (
                    <CalendarBlock
                      key={b.id}
                      entry={b.entry}
                      geometry={b.geometry}
                      layout={layout.get(b.id) ?? { column: 0, columns: 1 }}
                      durationFormat={viewer.durationFormat}
                    />
                  ))}
                  {running ? <RunningBlock running={running} dayKey={day} tz={tz} /> : null}
                  {ghost && ghost.dayKey === day ? (
                    <div
                      data-testid="ghost-block"
                      className="bg-primary/20 border-primary pointer-events-none absolute inset-x-1 z-20 rounded border border-dashed px-1 text-xs"
                      style={{
                        top: minutesToPx(ghost.top),
                        height: Math.max(minutesToPx(ghost.height), SLOT_PX),
                      }}
                    >
                      {ghost.label}
                    </div>
                  ) : null}
                  {today === day ? <NowLine dayKey={day} /> : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The running timer, from its start to now, redrawn each second. */
function RunningBlock({
  running,
  dayKey,
  tz,
}: {
  running: TimeEntryDTO;
  dayKey: string;
  tz: string;
}) {
  const { now, elapsedSeconds } = useTrackerClock();
  if (!now) return null;
  const geometry = blockOnDay(
    { start: running.start, end: new Date(now).toISOString() },
    dayKey,
    tz,
  );
  if (!geometry) return null;
  return (
    <div
      data-running
      className="border-primary bg-primary/10 absolute inset-x-1 z-10 overflow-hidden rounded border border-dashed px-1.5 py-0.5 text-xs"
      style={{
        top: minutesToPx(geometry.top),
        height: Math.max(minutesToPx(geometry.height), SLOT_PX),
      }}
    >
      <span className="font-medium">{running.description || "(no description)"}</span>
      <span className="text-muted-foreground ml-1">Running · {formatClock(elapsedSeconds)}</span>
    </div>
  );
}
