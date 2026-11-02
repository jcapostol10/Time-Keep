"use client";

import { formatDuration } from "@timekeep/core";
import { useQuery } from "@tanstack/react-query";

import { fetchJson } from "@/lib/fetch-json";
import type { TimeOffRangeDTO } from "@/lib/time-off-types";

import { timeOffKeys, timeOffUrls } from "../tracker/query-keys";
import { useTracker } from "../tracker/tracker-provider";

/** A read-only row of the timesheet or the calendar's all-day band. */
export interface TimeOffBand {
  key: string;
  /** "Time off: Vacation" or "Holiday: Rizal Day". */
  label: string;
  /** dateKey → what the cell shows (hours of time off, or "Holiday"). */
  days: Record<string, string>;
}

/**
 * A person's approved time off and holidays in `[from, to]` (date keys), as
 * labelled rows: one per policy and one per holiday name. Never counted in the
 * tracked totals (decision 8).
 */
export function useTimeOffBands(
  slug: string,
  from: string | null,
  to: string | null,
  userId = "me",
): TimeOffBand[] {
  const { viewer } = useTracker();
  const { data } = useQuery({
    queryKey: timeOffKeys.range(slug, from ?? "", to ?? "", userId),
    queryFn: () => fetchJson<TimeOffRangeDTO>(timeOffUrls.range(slug, from!, to!, userId)),
    enabled: from !== null && to !== null,
  });
  if (!data) return [];
  const bands = new Map<string, TimeOffBand>();
  const band = (key: string, label: string) => {
    let b = bands.get(key);
    if (!b) bands.set(key, (b = { key, label, days: {} }));
    return b;
  };
  for (const t of data.timeOff) {
    band(`off:${t.policyName}`, `Time off: ${t.policyName}`).days[t.dateKey] = formatDuration(
      t.minutes * 60,
      viewer.durationFormat,
    );
  }
  for (const h of data.holidays)
    band(`holiday:${h.name}`, `Holiday: ${h.name}`).days[h.dateKey] = "Holiday";
  return [...bands.values()];
}
