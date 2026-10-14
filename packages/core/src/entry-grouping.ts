import { localDateKey } from "./time";

/** The subset of a time entry the list needs to group and total. */
export interface GroupableEntry {
  id: string;
  description: string;
  projectId: string | null;
  tagIds: string[];
  billable: boolean;
  /** ISO instant */
  start: string;
  /** ISO instant; null while running */
  end: string | null;
  durationSeconds: number | null;
}

export interface DayGroup<T extends GroupableEntry> {
  /** `YYYY-MM-DD` in the viewer's zone */
  dateKey: string;
  entries: T[];
  totalSeconds: number;
}

export type CollapsedRow<T extends GroupableEntry> =
  { kind: "single"; entry: T } | { kind: "group"; key: string; entries: T[]; totalSeconds: number };

export function sumDuration(entries: readonly GroupableEntry[]): number {
  let total = 0;
  for (const e of entries) total += e.durationSeconds ?? 0;
  return total;
}

/** Same description + project + tags (order-insensitive) + billable ⇒ same key. */
export function entryGroupKey(e: GroupableEntry): string {
  const tags = [...e.tagIds].sort().join(",");
  return `${e.description}\u0000${e.projectId ?? ""}\u0000${tags}\u0000${e.billable ? 1 : 0}`;
}

/**
 * Groups entries by the calendar date of their START in `tz` (an entry that
 * crosses midnight stays whole and lands on its start day). Days and entries
 * are ordered newest first.
 */
export function groupByDay<T extends GroupableEntry>(
  entries: readonly T[],
  tz: string,
): DayGroup<T>[] {
  const sorted = [...entries].sort((a, b) => b.start.localeCompare(a.start));
  const byDay = new Map<string, T[]>();
  for (const entry of sorted) {
    const key = localDateKey(new Date(entry.start), tz);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(entry);
    else byDay.set(key, [entry]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dateKey, dayEntries]) => ({
      dateKey,
      entries: dayEntries,
      totalSeconds: sumDuration(dayEntries),
    }));
}

/** Collapses runs of adjacent entries that share a group key into one row. */
export function collapseConsecutive<T extends GroupableEntry>(
  entries: readonly T[],
): CollapsedRow<T>[] {
  const rows: CollapsedRow<T>[] = [];
  let run: T[] = [];
  let runKey = "";

  const flush = () => {
    const first = run[0];
    if (!first) return;
    if (run.length === 1) rows.push({ kind: "single", entry: first });
    else rows.push({ kind: "group", key: runKey, entries: run, totalSeconds: sumDuration(run) });
    run = [];
  };

  for (const entry of entries) {
    const key = entryGroupKey(entry);
    if (run.length > 0 && key !== runKey) flush();
    runKey = key;
    run.push(entry);
  }
  flush();
  return rows;
}
