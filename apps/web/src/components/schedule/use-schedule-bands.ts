"use client";

import type { TimeOffBand } from "../time-off/use-time-off-bands";
import { hm, useMySchedule } from "./use-schedule";

/**
 * The viewer's published assignments as all-day bands on the Calendar
 * (decision 18): one per project, faint and read-only, "Scheduled: Website".
 */
export function useScheduleBands(
  slug: string,
  from: string | null,
  to: string | null,
  enabled = true,
): TimeOffBand[] {
  const { data } = useMySchedule(slug, enabled ? from : null, enabled ? to : null);
  if (!data) return [];
  const bands = new Map<string, TimeOffBand>();
  for (const a of data.assignments) {
    const name = a.project?.name ?? "Another project";
    const key = `scheduled:${a.project?.id ?? a.id}`;
    let band = bands.get(key);
    if (!band)
      bands.set(key, (band = { key, label: `Scheduled: ${name}`, days: {}, variant: "scheduled" }));
    for (const [day, minutes] of Object.entries(a.days)) {
      if (minutes <= 0) continue;
      const before = band.days[day];
      const sum = (before ? toMinutes(before) : 0) + minutes;
      band.days[day] = hm(sum);
    }
  }
  return [...bands.values()];
}

function toMinutes(text: string): number {
  const [h, m] = text.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
