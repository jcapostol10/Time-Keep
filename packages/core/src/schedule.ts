import { addDaysToKey } from "./approvals";
import { type Capacity, dateKeysBetween, weekdayOfKey } from "./time-off";

/**
 * Scheduling (Phase 7 design, decisions 1–4, 11–12). An assignment is a span
 * of local dates (no time zone) with an amount of time per day or in total; a
 * person's working days and holidays decide where its minutes fall. Approved
 * time off never removes a day: it lowers capacity, so the clash shows.
 */

export const HOURS_MODES = ["PER_DAY", "TOTAL"] as const;
export type HoursMode = (typeof HOURS_MODES)[number];

export const SCHEDULE_RANGE_MAX_DAYS = 91;
export const ASSIGNMENT_SPAN_MAX_DAYS = 366;
export const REPEAT_WEEKS_MAX = 4;
export const MINUTES_PER_DAY_MAX = 1440;

export interface AssignmentShape {
  startDate: string;
  endDate: string;
  mode: HoursMode;
  minutesPerDay: number | null;
  totalMinutes: number | null;
  includeNonWorking: boolean;
  repeatWeeks: number | null;
  repeatUntil: string | null;
}

/** The person's working weekdays (0 = Sunday) and the holidays that apply to them. */
export interface DayRules {
  workingDays: readonly number[];
  holidayKeys: ReadonlySet<string>;
}

export interface DateSpan {
  startDate: string;
  endDate: string;
}

/** Days from `a` to `b` (date keys), b − a. */
export function daysBetweenKeys(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** The spans of a series: one without a repeat, else every `7 × repeatWeeks` days until the date. */
export function occurrences(a: AssignmentShape): DateSpan[] {
  if (!a.repeatWeeks || !a.repeatUntil) return [{ startDate: a.startDate, endDate: a.endDate }];
  const length = daysBetweenKeys(a.startDate, a.endDate);
  const out: DateSpan[] = [];
  for (let k = 0; ; k += 1) {
    const startDate = addDaysToKey(a.startDate, 7 * a.repeatWeeks * k);
    if (startDate > a.repeatUntil) break;
    out.push({ startDate, endDate: addDaysToKey(startDate, length) });
  }
  return out;
}

/** The last day any occurrence covers. */
export function spanLastDay(a: AssignmentShape): string {
  const all = occurrences(a);
  return all[all.length - 1]?.endDate ?? a.endDate;
}

export function fallsOn(dateKey: string, rules: DayRules, includeNonWorking: boolean): boolean {
  if (includeNonWorking) return true;
  return rules.workingDays.includes(weekdayOfKey(dateKey)) && !rules.holidayKeys.has(dateKey);
}

/** The minutes of one occurrence on each day it falls on (the whole span, uncut). */
function occurrenceDays(a: AssignmentShape, span: DateSpan, rules: DayRules): [string, number][] {
  const keys = dateKeysBetween(span.startDate, span.endDate).filter((k) =>
    fallsOn(k, rules, a.includeNonWorking),
  );
  if (a.mode === "PER_DAY") return keys.map((k) => [k, a.minutesPerDay ?? 0]);
  const total = a.totalMinutes ?? 0;
  if (keys.length === 0 || total <= 0) return [];
  const each = Math.floor(total / keys.length);
  let remainder = total - each * keys.length;
  return keys.map((k) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return [k, each + extra];
  });
}

/** Date key → minutes inside `range`, every occurrence spread over its whole span first. */
export function assignmentDays(
  a: AssignmentShape,
  rules: DayRules,
  range: { from: string; to: string },
): Map<string, number> {
  const out = new Map<string, number>();
  for (const span of occurrences(a)) {
    if (span.endDate < range.from || span.startDate > range.to) continue;
    for (const [k, m] of occurrenceDays(a, span, rules)) {
      if (k < range.from || k > range.to || m <= 0) continue;
      out.set(k, (out.get(k) ?? 0) + m);
    }
  }
  return out;
}

/** Capacity per day: the daily capacity on a working, non-holiday day less time off. */
export function capacityByDay(
  range: { from: string; to: string },
  capacity: Capacity,
  holidayKeys: ReadonlySet<string>,
  timeOffMinutes: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const k of dateKeysBetween(range.from, range.to)) {
    const working = capacity.workingDays.includes(weekdayOfKey(k)) && !holidayKeys.has(k);
    out.set(k, working ? Math.max(0, capacity.dailyMinutes - (timeOffMinutes.get(k) ?? 0)) : 0);
  }
  return out;
}

export const HEATS = ["under", "at", "over"] as const;
export type Heat = (typeof HEATS)[number];

/** Over when more is scheduled than fits; at when it fills the day; under when there is room. */
export function heatOf(scheduled: number, capacity: number): Heat | null {
  if (scheduled > capacity) return "over";
  if (capacity <= 0) return null;
  return scheduled === capacity ? "at" : "under";
}

/** The same assignment starting on `newStart`; the repeat's end moves with it. */
export function moveAssignment(a: AssignmentShape, newStart: string): AssignmentShape {
  const delta = daysBetweenKeys(a.startDate, newStart);
  return {
    ...a,
    startDate: newStart,
    endDate: addDaysToKey(a.endDate, delta),
    repeatUntil: a.repeatUntil ? addDaysToKey(a.repeatUntil, delta) : null,
  };
}

/** One edge dragged to `dateKey`; the span never turns inside out. */
export function resizeAssignment(
  a: AssignmentShape,
  edge: "start" | "end",
  dateKey: string,
): AssignmentShape {
  if (edge === "start") {
    const startDate = dateKey > a.endDate ? a.endDate : dateKey;
    return { ...a, startDate };
  }
  return { ...a, endDate: dateKey < a.startDate ? a.startDate : dateKey };
}

/** Two assignments, the second starting on `at`; a total is split where its minutes fall. */
export function splitAssignment(
  a: AssignmentShape,
  at: string,
  rules: DayRules,
): [AssignmentShape, AssignmentShape] {
  if (a.repeatWeeks) {
    throw new RangeError("Split works on a single assignment; edit the series instead.");
  }
  if (at <= a.startDate || at > a.endDate) throw new RangeError("Split inside the assignment.");
  const firstEnd = addDaysToKey(at, -1);
  const first: AssignmentShape = { ...a, endDate: firstEnd };
  const second: AssignmentShape = { ...a, startDate: at };
  if (a.mode === "TOTAL") {
    const days = assignmentDays(a, rules, { from: a.startDate, to: a.endDate });
    let before = 0;
    for (const [k, m] of days) if (k < at) before += m;
    first.totalMinutes = before;
    second.totalMinutes = (a.totalMinutes ?? 0) - before;
  }
  return [first, second];
}

/** Lanes for overlapping bars in a row: greedy by start date, then id. */
export function stackLanes<T extends { id: string; startDate: string; endDate: string }>(
  bars: readonly T[],
): Map<string, number> {
  const sorted = [...bars].sort((x, y) =>
    x.startDate === y.startDate ? (x.id < y.id ? -1 : 1) : x.startDate < y.startDate ? -1 : 1,
  );
  const laneEnds: string[] = [];
  const out = new Map<string, number>();
  for (const bar of sorted) {
    let lane = laneEnds.findIndex((end) => end < bar.startDate);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(bar.endDate);
    } else {
      laneEnds[lane] = bar.endDate;
    }
    out.set(bar.id, lane);
  }
  return out;
}
