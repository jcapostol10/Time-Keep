"use client";

import {
  formatDuration,
  formatTimeOfDay,
  localDateKey,
  ribbonBlocks,
  ribbonSummary,
  type RibbonBlock,
} from "@timekeep/core";
import { Tooltip, TooltipContent, TooltipTrigger } from "@timekeep/ui/components/tooltip";
import { cn } from "@timekeep/ui/lib/utils";
import { useMemo, useState } from "react";

import type { TimeEntryDTO } from "@/lib/tracker-types";

import { ColorDot } from "./project-picker";
import { useTracker, useTrackerClock } from "./tracker-provider";

/** Stopped entries never read the clock; any instant will do. */
const EPOCH = new Date(0);

/** Where a block sits: its share of the day, never thinner than two pixels. */
const place = (block: RibbonBlock) => ({
  left: `${block.left}%`,
  width: `max(${block.width}%, 2px)`,
});

/** A block is 4px tall, on the track; what the pointer can hit is the ribbon's 16px. */
const HIT = "absolute inset-y-0";
const BAR = "absolute inset-x-0 top-1.5 block h-1 rounded-[1px]";

function useTimes() {
  const { viewer } = useTracker();
  return (block: RibbonBlock) =>
    `${formatTimeOfDay(new Date(block.from), viewer.timezone, viewer.timeFormat)} – ${formatTimeOfDay(
      new Date(block.to),
      viewer.timezone,
      viewer.timeFormat,
    )} · ${formatDuration(block.seconds, viewer.durationFormat)}`;
}

function EntryLine({ entry, times }: { entry: TimeEntryDTO; times: string }) {
  return (
    <span className="block">
      <span className="block font-medium">
        {entry.description || (entry.type === "break" ? "Break" : "(no description)")}
      </span>
      {entry.project ? (
        <span className="flex items-center gap-1.5">
          <ColorDot color={entry.project.color} className="size-2" />
          {entry.project.name}
          {entry.task ? ` › ${entry.task.name}` : ""}
        </span>
      ) : null}
      <span className="block tabular-nums opacity-80">{times}</span>
    </span>
  );
}

/** The running timer on this day: a live block that grows with the clock. */
function RunningBlock({ dateKey }: { dateKey: string }) {
  const { running, viewer } = useTracker();
  const { elapsedSeconds } = useTrackerClock();
  if (!running) return null;
  const now = new Date(Date.parse(running.start) + elapsedSeconds * 1000);
  const [block] = ribbonBlocks(
    [{ id: running.id, start: running.start, end: null }],
    dateKey,
    viewer.timezone,
    now,
  );
  if (!block) return null;
  return (
    <span data-ribbon-running className={HIT} style={place(block)}>
      <span className={cn(BAR, "bg-live-line")} />
    </span>
  );
}

/**
 * The shape of a day: a 4px strip for 00:00–24:00 in the viewer's timezone,
 * with a block per entry in its project's colour (muted without one), placed
 * by its start and end. Overlapping blocks are see-through, so they read as
 * denser. The strip is hidden from assistive technology and summed up in
 * words instead; a pointer on a block, or the keyboard on the ribbon, opens
 * what it stands for.
 *
 * `entries` is the whole list, not the day's: an entry that crosses midnight
 * shows on both days it touches.
 */
export function DayRibbon({
  dateKey,
  todayKey,
  entries,
  className,
}: {
  dateKey: string;
  todayKey: string;
  entries: readonly TimeEntryDTO[];
  className?: string;
}) {
  const { viewer, running } = useTracker();
  const times = useTimes();
  const [focused, setFocused] = useState(false);
  const tz = viewer.timezone;

  const blocks = useMemo(() => {
    const byId = new Map(entries.map((e) => [e.id, e]));
    return ribbonBlocks(
      entries.filter((e) => e.end !== null),
      dateKey,
      tz,
      EPOCH,
    ).flatMap((block) => {
      const entry = byId.get(block.id);
      return entry ? [{ block, entry }] : [];
    });
  }, [entries, dateKey, tz]);

  // The timer touches every day from the one it started on up to today.
  // (How long it is belongs to the running block; this must not tick.)
  const runningHere =
    running !== null && localDateKey(new Date(running.start), tz) <= dateKey && dateKey <= todayKey;

  const summary =
    ribbonSummary(
      blocks.map((b) => b.block),
      tz,
      viewer,
    ) + (runningHere ? ", timer running" : "");

  return (
    <Tooltip open={focused}>
      <TooltipTrigger asChild>
        {/* One stop for the keyboard per day, not one per entry. */}
        <div
          data-ribbon
          role="img"
          aria-label={summary}
          tabIndex={0}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={cn("relative h-4 min-w-0 rounded-sm", className)}
        >
          <div
            data-ribbon-track
            aria-hidden
            className="bg-muted absolute inset-x-0 top-1.5 h-1 rounded-[1px]"
          >
            {/* 06:00, 12:00 and 18:00: enough to tell a morning from an evening. */}
            {[25, 50, 75].map((at) => (
              <span
                key={at}
                className="bg-card absolute inset-y-0 w-px"
                style={{ left: `${at}%` }}
              />
            ))}
          </div>
          <div aria-hidden className="absolute inset-0">
            {blocks.map(({ block, entry }) => (
              <Tooltip key={block.id}>
                <TooltipTrigger asChild>
                  <span data-ribbon-block className={HIT} style={place(block)}>
                    <span
                      className={cn(BAR, "opacity-75", !entry.project && "bg-muted-foreground")}
                      style={entry.project ? { backgroundColor: entry.project.color } : undefined}
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="text-left">
                  <EntryLine entry={entry} times={times(block)} />
                </TooltipContent>
              </Tooltip>
            ))}
            {runningHere ? <RunningBlock dateKey={dateKey} /> : null}
          </div>
          <span className="sr-only">{summary}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 space-y-2 text-left">
        <span className="block">{summary}</span>
        {blocks.slice(0, 8).map(({ block, entry }) => (
          <EntryLine key={block.id} entry={entry} times={times(block)} />
        ))}
        {blocks.length > 8 ? <span className="block">and {blocks.length - 8} more</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}
