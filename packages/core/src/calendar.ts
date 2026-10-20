import { MAX_ENTRY_SECONDS } from "./duration";
import { addDaysInZone, minutesSinceMidnight, zonedDateTimeToInstant } from "./time";

/**
 * Geometry and drag maths for the calendar. A day is a 24-hour column of
 * 15-minute slots in the viewer's timezone; positions are wall-clock minutes,
 * so a block at 10:00 sits at the 10:00 line even on a DST day. Pure: the
 * UI converts pixels to minutes and back.
 */

export const SLOT_MINUTES = 15;
export const MINUTES_PER_DAY = 1440;

/** Nearest slot, clamped to the day. */
export function snapMinutes(minutes: number, step = SLOT_MINUTES): number {
  const snapped = Math.round(minutes / step) * step;
  return Math.min(MINUTES_PER_DAY, Math.max(0, snapped));
}

function dayBounds(dayKey: string, tz: string): { start: Date; end: Date } {
  const start = zonedDateTimeToInstant({ date: dayKey, hours: 0, minutes: 0 }, tz);
  return { start, end: addDaysInZone(start, 1, tz) };
}

export interface DayBlock {
  /** Wall-clock minutes from the day's midnight. */
  top: number;
  height: number;
  /** The entry started before this day (drawn from the top). */
  clippedStart: boolean;
  /** The entry ends after this day (drawn to the bottom). */
  clippedEnd: boolean;
}

/** Where an entry sits on a given day, or null when it does not touch it. */
export function blockOnDay(
  range: { start: string; end: string },
  dayKey: string,
  tz: string,
): DayBlock | null {
  const start = new Date(range.start);
  const end = new Date(range.end);
  const day = dayBounds(dayKey, tz);
  if (end <= day.start || start >= day.end) return null;
  const clippedStart = start < day.start;
  const clippedEnd = end > day.end;
  const top = clippedStart ? 0 : minutesSinceMidnight(start, tz);
  const bottom =
    clippedEnd || end.getTime() === day.end.getTime()
      ? MINUTES_PER_DAY
      : minutesSinceMidnight(end, tz);
  return { top, height: Math.max(0, bottom - top), clippedStart, clippedEnd };
}

/**
 * Side-by-side columns for overlapping blocks: blocks that overlap (directly
 * or through others) form a cluster and share its width.
 */
export function layoutColumns<T extends { id: string; top: number; height: number }>(
  blocks: T[],
): Map<string, { column: number; columns: number }> {
  const sorted = [...blocks].sort((a, b) => a.top - b.top || b.height - a.height);
  const result = new Map<string, { column: number; columns: number }>();
  let columnEnds: number[] = [];
  let assigned: { id: string; column: number }[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  const flush = () => {
    for (const a of assigned) result.set(a.id, { column: a.column, columns: columnEnds.length });
    columnEnds = [];
    assigned = [];
  };
  for (const b of sorted) {
    if (b.top >= clusterEnd) flush();
    let column = columnEnds.findIndex((end) => end <= b.top);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(0);
    }
    columnEnds[column] = b.top + b.height;
    assigned.push({ id: b.id, column });
    clusterEnd = Math.max(clusterEnd, b.top + b.height);
  }
  flush();
  return result;
}

/** The instant of a wall-clock minute of the day; 1440 is the next day's midnight. */
export function slotInstant(dayKey: string, minutes: number, tz: string): Date {
  const day = dayBounds(dayKey, tz);
  if (minutes >= MINUTES_PER_DAY) return day.end;
  return zonedDateTimeToInstant(
    { date: dayKey, hours: Math.floor(minutes / 60), minutes: minutes % 60 },
    tz,
  );
}

/** A drag over empty space: sorted, snapped, at least one slot, inside the day. */
export function createdRange(
  dayKey: string,
  a: number,
  b: number,
  tz: string,
): { start: Date; end: Date } {
  let lo = snapMinutes(Math.min(a, b));
  let hi = snapMinutes(Math.max(a, b));
  if (hi - lo < SLOT_MINUTES) hi = Math.min(MINUTES_PER_DAY, lo + SLOT_MINUTES);
  if (hi === lo) lo = hi - SLOT_MINUTES;
  return { start: slotInstant(dayKey, lo, tz), end: slotInstant(dayKey, hi, tz) };
}

/** A block dragged to a day and start minute: same duration, start snapped and kept inside the day. */
export function movedRange(
  range: { start: string; end: string },
  dayKey: string,
  startMinutes: number,
  tz: string,
): { start: Date; end: Date } {
  const durationMs = new Date(range.end).getTime() - new Date(range.start).getTime();
  const durationMinutes = durationMs / 60_000;
  const latestStart = Math.max(0, MINUTES_PER_DAY - durationMinutes);
  const start = slotInstant(dayKey, snapMinutes(Math.min(startMinutes, latestStart)), tz);
  return { start, end: new Date(start.getTime() + durationMs) };
}

/** A block's edge dragged to a minute of the day; the other edge stays. */
export function resizedRange(
  range: { start: string; end: string },
  edge: "start" | "end",
  dayKey: string,
  minutes: number,
  tz: string,
): { start: Date; end: Date } {
  const slotMs = SLOT_MINUTES * 60_000;
  const start = new Date(range.start);
  const end = new Date(range.end);
  if (edge === "end") {
    let newEnd = slotInstant(dayKey, snapMinutes(minutes), tz).getTime();
    newEnd = Math.max(newEnd, start.getTime() + slotMs);
    newEnd = Math.min(newEnd, start.getTime() + MAX_ENTRY_SECONDS * 1000);
    return { start, end: new Date(newEnd) };
  }
  let newStart = slotInstant(dayKey, snapMinutes(minutes), tz).getTime();
  newStart = Math.min(newStart, end.getTime() - slotMs);
  newStart = Math.max(newStart, end.getTime() - MAX_ENTRY_SECONDS * 1000);
  return { start: new Date(newStart), end };
}
