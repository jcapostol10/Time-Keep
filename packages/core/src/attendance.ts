import { addDaysToKey } from "./approvals";
import { dateKeysBetween, weekdayOfKey, type Capacity } from "./time-off";

/**
 * Attendance (Phase 5b, decision 13). A day is the person's own local day;
 * work and breaks are raw seconds (rounding never applies). Capacity is the
 * daily capacity on a working day that is not a holiday, less the time off
 * taken that day; overtime and undertime are measured against it.
 */

/** One person's tracked time on one local day (instants as ISO strings). */
export interface DayWork {
  dateKey: string;
  firstStart: string | null;
  lastEnd: string | null;
  workSeconds: number;
  breakSeconds: number;
}

export interface AttendanceDay extends DayWork {
  holiday: string | null;
  timeOffSeconds: number;
  capacitySeconds: number;
  overtimeSeconds: number;
  undertimeSeconds: number;
  workingDay: boolean;
}

export interface AttendanceWeek {
  weekStart: string;
  workSeconds: number;
  breakSeconds: number;
  timeOffSeconds: number;
  capacitySeconds: number;
  overtimeSeconds: number;
  undertimeSeconds: number;
}

export interface AttendanceDaysInput {
  from: string;
  to: string;
  work: ReadonlyMap<string, DayWork>;
  capacity: Capacity;
  /** dateKey → holiday name, for the holidays that apply to the person */
  holidays: ReadonlyMap<string, string>;
  /** dateKey → minutes of approved time off */
  timeOffMinutes: ReadonlyMap<string, number>;
}

/** A row for each day with capacity, work, breaks, time off or a holiday. */
export function attendanceDays(input: AttendanceDaysInput): AttendanceDay[] {
  const out: AttendanceDay[] = [];
  for (const dateKey of dateKeysBetween(input.from, input.to)) {
    const work = input.work.get(dateKey);
    const holiday = input.holidays.get(dateKey) ?? null;
    const workingDay = input.capacity.workingDays.includes(weekdayOfKey(dateKey)) && !holiday;
    const timeOffSeconds = (input.timeOffMinutes.get(dateKey) ?? 0) * 60;
    const base = workingDay ? input.capacity.dailyMinutes * 60 : 0;
    const capacitySeconds = Math.max(0, base - timeOffSeconds);
    const workSeconds = work?.workSeconds ?? 0;
    const breakSeconds = work?.breakSeconds ?? 0;
    if (!capacitySeconds && !workSeconds && !breakSeconds && !timeOffSeconds && !holiday) continue;
    out.push({
      dateKey,
      firstStart: work?.firstStart ?? null,
      lastEnd: work?.lastEnd ?? null,
      workSeconds,
      breakSeconds,
      holiday,
      timeOffSeconds,
      capacitySeconds,
      overtimeSeconds: Math.max(0, workSeconds - capacitySeconds),
      undertimeSeconds: Math.max(0, capacitySeconds - workSeconds),
      workingDay,
    });
  }
  return out;
}

/** The first day of the week containing `dateKey`; `weekStart` 0 = Sunday. */
export function weekStartKey(dateKey: string, weekStart: number): string {
  return addDaysToKey(dateKey, -((weekdayOfKey(dateKey) - weekStart + 7) % 7));
}

/**
 * Weekly subtotals. A whole week inside the range is measured against the
 * weekly capacity less that week's time off and holiday capacity; a week the
 * range cuts uses the sum of its days' capacity instead.
 */
export function attendanceWeeks(
  days: readonly AttendanceDay[],
  capacity: Capacity,
  weekStart: number,
  range: { from: string; to: string },
): AttendanceWeek[] {
  const weeks = new Map<string, AttendanceDay[]>();
  for (const d of days) {
    const key = weekStartKey(d.dateKey, weekStart);
    weeks.set(key, [...(weeks.get(key) ?? []), d]);
  }
  const out: AttendanceWeek[] = [];
  for (const [key, list] of [...weeks].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const sum = (f: (d: AttendanceDay) => number) => list.reduce((n, d) => n + f(d), 0);
    const whole = key >= range.from && addDaysToKey(key, 6) <= range.to;
    const timeOffSeconds = sum((d) => d.timeOffSeconds);
    const holidayDays = list.filter(
      (d) => d.holiday && capacity.workingDays.includes(weekdayOfKey(d.dateKey)),
    ).length;
    const capacitySeconds = whole
      ? Math.max(
          0,
          capacity.weeklyMinutes * 60 - timeOffSeconds - holidayDays * capacity.dailyMinutes * 60,
        )
      : sum((d) => d.capacitySeconds);
    const workSeconds = sum((d) => d.workSeconds);
    out.push({
      weekStart: key,
      workSeconds,
      breakSeconds: sum((d) => d.breakSeconds),
      timeOffSeconds,
      capacitySeconds,
      overtimeSeconds: Math.max(0, workSeconds - capacitySeconds),
      undertimeSeconds: Math.max(0, capacitySeconds - workSeconds),
    });
  }
  return out;
}

/** The weeks added up (the person's total row). */
export function sumAttendanceWeeks(weeks: readonly AttendanceWeek[], from: string): AttendanceWeek {
  const sum = (f: (w: AttendanceWeek) => number) => weeks.reduce((n, w) => n + f(w), 0);
  return {
    weekStart: from,
    workSeconds: sum((w) => w.workSeconds),
    breakSeconds: sum((w) => w.breakSeconds),
    timeOffSeconds: sum((w) => w.timeOffSeconds),
    capacitySeconds: sum((w) => w.capacitySeconds),
    overtimeSeconds: sum((w) => w.overtimeSeconds),
    undertimeSeconds: sum((w) => w.undertimeSeconds),
  };
}
