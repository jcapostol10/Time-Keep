"use client";

import { localDateKey, minutesSinceMidnight } from "@timekeep/core";

import { useNow } from "@/hooks/use-now";

import { useTracker } from "../tracker/tracker-provider";
import { minutesToPx } from "./calendar-block";

/** The current time, drawn across today's column. */
export function NowLine({ dayKey }: { dayKey: string }) {
  const { viewer } = useTracker();
  const now = useNow(true);
  if (!now) return null;
  const instant = new Date(now);
  if (localDateKey(instant, viewer.timezone) !== dayKey) return null;
  return (
    <div
      data-testid="now-line"
      aria-hidden
      className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500"
      style={{ top: minutesToPx(minutesSinceMidnight(instant, viewer.timezone)) }}
    >
      <span className="absolute -left-1.5 -top-1.5 size-3 rounded-full bg-red-500" />
    </div>
  );
}
