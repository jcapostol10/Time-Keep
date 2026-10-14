import { computeDurationSeconds } from "./duration";
import { addDaysInZone, localDateKey, localTimeParts, zonedDateTimeToInstant } from "./time";

/**
 * Pure time maths behind manual mode and inline row edits. Times of day are
 * wall-clock in the viewer's zone; an end at or before the start means the
 * entry runs past midnight, so the end rolls to the next day.
 */

export interface TimeOfDay {
  hours: number;
  minutes: number;
}

export interface EntryTimes {
  start: Date;
  end: Date;
}

function rollPast(start: Date, end: Date, tz: string): Date {
  return end.getTime() <= start.getTime() ? addDaysInZone(end, 1, tz) : end;
}

export function manualRange(
  input: { date: string; start: TimeOfDay; end: TimeOfDay },
  tz: string,
): EntryTimes & { durationSeconds: number } {
  const start = zonedDateTimeToInstant({ date: input.date, ...input.start }, tz);
  const end = rollPast(start, zonedDateTimeToInstant({ date: input.date, ...input.end }, tz), tz);
  return { start, end, durationSeconds: computeDurationSeconds(start, end) };
}

/** New start time on the entry's start date; if it passes the end, the end moves a day later. */
export function withStartTime(entry: EntryTimes, time: TimeOfDay, tz: string): EntryTimes {
  const start = zonedDateTimeToInstant({ date: localDateKey(entry.start, tz), ...time }, tz);
  const end = start.getTime() >= entry.end.getTime() ? addDaysInZone(entry.end, 1, tz) : entry.end;
  return { start, end };
}

/** New end time on the entry's start date, rolling to the next day when it is not after the start. */
export function withEndTime(entry: EntryTimes, time: TimeOfDay, tz: string): EntryTimes {
  const end = zonedDateTimeToInstant({ date: localDateKey(entry.start, tz), ...time }, tz);
  return { start: entry.start, end: rollPast(entry.start, end, tz) };
}

/** Moves the entry to another date, keeping its local start time and its duration. */
export function withDate(entry: EntryTimes, dateKey: string, tz: string): EntryTimes {
  const { hours, minutes, seconds } = localTimeParts(entry.start, tz);
  const start = zonedDateTimeToInstant({ date: dateKey, hours, minutes, seconds }, tz);
  return { start, end: new Date(start.getTime() + (entry.end.getTime() - entry.start.getTime())) };
}

/** Keeps the start; the end becomes start + duration. */
export function withDuration(entry: EntryTimes, seconds: number): EntryTimes {
  return { start: entry.start, end: new Date(entry.start.getTime() + seconds * 1000) };
}
