import { TZDate } from "@date-fns/tz";
import { addDays, format, startOfDay, startOfWeek, differenceInCalendarDays } from "date-fns";

import type { TimeFormat, WeekStartDay } from "./schemas";

/**
 * Timezone-aware calendar helpers. Instants are plain `Date`s (UTC); every
 * function that needs a calendar takes an IANA zone explicitly. Built on
 * `TZDate` so day/week arithmetic keeps wall-clock time across DST changes —
 * never add `n * 86_400_000` to an instant.
 */

function zoned(instant: Date, tz: string): TZDate {
  return new TZDate(instant.getTime(), tz);
}

function toInstant(d: Date): Date {
  return new Date(d.getTime());
}

/** Calendar date of `instant` in `tz`, as `YYYY-MM-DD`. */
export function localDateKey(instant: Date, tz: string): string {
  return format(zoned(instant, tz), "yyyy-MM-dd");
}

export function localTimeParts(
  instant: Date,
  tz: string,
): { hours: number; minutes: number; seconds: number } {
  const d = zoned(instant, tz);
  return { hours: d.getHours(), minutes: d.getMinutes(), seconds: d.getSeconds() };
}

export function minutesSinceMidnight(instant: Date, tz: string): number {
  const { hours, minutes } = localTimeParts(instant, tz);
  return hours * 60 + minutes;
}

/** 0 = Sunday … 6 = Saturday, in `tz`. */
export function localWeekday(instant: Date, tz: string): WeekStartDay {
  return zoned(instant, tz).getDay() as WeekStartDay;
}

function parseDateKey(dateKey: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined || !y || !m || !d) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }
  return { year: y, month: m, day: d };
}

/**
 * Wall-clock date + time in `tz` → instant. A time inside a DST gap (e.g.
 * 02:30 on a spring-forward day) resolves to the instant one hour later.
 */
export function zonedDateTimeToInstant(
  parts: { date: string; hours: number; minutes: number; seconds?: number },
  tz: string,
): Date {
  const { year, month, day } = parseDateKey(parts.date);
  return toInstant(
    new TZDate(year, month - 1, day, parts.hours, parts.minutes, parts.seconds ?? 0, 0, tz),
  );
}

export function startOfDayInZone(instant: Date, tz: string): Date {
  return toInstant(startOfDay(zoned(instant, tz)));
}

/** Adds calendar days, keeping the wall-clock time in `tz`. */
export function addDaysInZone(instant: Date, days: number, tz: string): Date {
  return toInstant(addDays(zoned(instant, tz), days));
}

export function startOfWeekInZone(instant: Date, tz: string, weekStart: WeekStartDay): Date {
  return toInstant(startOfWeek(zoned(instant, tz), { weekStartsOn: weekStart }));
}

/** `[weekStart, weekEnd)` of the week containing `instant`, in `tz`. */
export function weekBounds(
  instant: Date,
  tz: string,
  weekStart: WeekStartDay,
): { weekStart: Date; weekEnd: Date } {
  const start = startOfWeekInZone(instant, tz, weekStart);
  return { weekStart: start, weekEnd: addDaysInZone(start, 7, tz) };
}

function dateKeyToLocalDate(dateKey: string): Date {
  const { year, month, day } = parseDateKey(dateKey);
  return new Date(year, month - 1, day);
}

/** "Today" | "Yesterday" | "Mon, Oct 5" (+ ", 2025" when the year differs from today's). */
export function formatDayHeading(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return "Today";
  const today = dateKeyToLocalDate(todayKey);
  const date = dateKeyToLocalDate(dateKey);
  if (format(addDays(today, -1), "yyyy-MM-dd") === dateKey) return "Yesterday";
  const sameYear = today.getFullYear() === date.getFullYear();
  return format(date, sameYear ? "EEE, MMM d" : "EEE, MMM d, yyyy");
}

/** "Oct 5 – Oct 11" for the 7 days starting at `weekStart`. */
export function formatWeekRange(weekStart: Date, tz: string): string {
  const start = zoned(weekStart, tz);
  const end = addDays(start, 6);
  return `${format(start, "MMM d")} – ${format(end, "MMM d")}`;
}

/** "9:30 PM" (12h) or "21:30" (24h) in `tz`. */
export function formatTimeOfDay(instant: Date, tz: string, timeFormat: TimeFormat): string {
  return format(zoned(instant, tz), timeFormat === "12h" ? "h:mm a" : "HH:mm");
}

const TIME_OF_DAY_RE = /^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/;

/** Parses "9", "9:30", "930", "0930", "9:30pm", "9 PM", "21:30", "12am". */
export function parseTimeOfDay(input: string): { hours: number; minutes: number } | null {
  const s = input.trim().toLowerCase().replace(/[\s.]/g, "");
  const match = TIME_OF_DAY_RE.exec(s);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3];
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (hours === 12) hours = 0;
    if (meridiem === "pm") hours += 12;
  } else if (hours > 23) {
    return null;
  }
  return { hours, minutes };
}

/** The viewer's local month containing `instant`, as `[monthStart, monthEnd)` instants. */
export function monthBoundsInZone(instant: Date, tz: string): { monthStart: Date; monthEnd: Date } {
  const local = new TZDate(instant, tz);
  const start = new TZDate(local.getFullYear(), local.getMonth(), 1, tz);
  const end = new TZDate(local.getFullYear(), local.getMonth() + 1, 1, tz);
  return { monthStart: new Date(start.getTime()), monthEnd: new Date(end.getTime()) };
}

/** Whole local days from `from` to `to` in the zone (negative when `to` is earlier); DST-safe. */
export function daysBetweenInZone(from: Date, to: Date, tz: string): number {
  return differenceInCalendarDays(new TZDate(to, tz), new TZDate(from, tz));
}
