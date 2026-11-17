import { computeDurationSeconds } from "@timekeep/core";

import type { TimeEntryDTO } from "@/lib/tracker-types";

/**
 * Pure updates of a range query's entries (timesheet, calendar), applied
 * before a write lands so the change shows at once; the write's settle
 * refetches the real rows.
 */
export function patchRange(
  list: TimeEntryDTO[],
  id: string,
  patch: { start?: string; end?: string },
): TimeEntryDTO[] {
  if (!list.some((e) => e.id === id)) return list;
  return list.map((e) => {
    if (e.id !== id) return e;
    const start = patch.start ?? e.start;
    const end = patch.end ?? e.end;
    return {
      ...e,
      start,
      end,
      durationSeconds: end ? computeDurationSeconds(new Date(start), new Date(end)) : null,
    };
  });
}

export function removeFromRange(list: TimeEntryDTO[], ids: string[]): TimeEntryDTO[] {
  const gone = new Set(ids);
  return list.filter((e) => !gone.has(e.id));
}

/** Adds a new entry to a range whose [from, to) holds its start; replaces one with the same id. */
export function insertIntoRange(
  list: TimeEntryDTO[],
  entry: TimeEntryDTO,
  from: string,
  to: string,
): TimeEntryDTO[] {
  const start = Date.parse(entry.start);
  if (start < Date.parse(from) || start >= Date.parse(to)) return list;
  if (list.some((e) => e.id === entry.id)) return list.map((e) => (e.id === entry.id ? entry : e));
  return [...list, entry];
}
