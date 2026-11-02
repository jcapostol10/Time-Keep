import { addDaysToKey } from "./approvals";

/**
 * Time off (Phase 5b). Amounts are integer hundredths of the policy's unit
 * (150 = 1.5 days or 1.5 hours). Balances are computed, never stored
 * (decision 9), and reckon per calendar year in the workspace timezone
 * (ruling R1). Dates are inclusive `YYYY-MM-DD` keys.
 */

export const TIME_OFF_UNITS = ["DAYS", "HOURS"] as const;
export type TimeOffUnit = (typeof TIME_OFF_UNITS)[number];

export const TIME_OFF_ACCRUALS = ["NONE", "YEARLY", "MONTHLY"] as const;
export type TimeOffAccrual = (typeof TIME_OFF_ACCRUALS)[number];

export const TIME_OFF_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type TimeOffStatus = (typeof TIME_OFF_STATUSES)[number];

/** A member's working pattern. `workingDays` are weekdays, 0 = Sunday. */
export interface Capacity {
  dailyMinutes: number;
  weeklyMinutes: number;
  workingDays: readonly number[];
}

export const DEFAULT_CAPACITY: Capacity = {
  dailyMinutes: 480,
  weeklyMinutes: 2400,
  workingDays: [1, 2, 3, 4, 5],
};

/** `minutes`: HOURS only — per day for one day, the total for a range. */
export interface TimeOffSpan {
  start: string;
  end: string;
  halfDay: boolean;
  minutes: number | null;
}

export const HALF_DAY_MESSAGE = "A half day is for a one-day request.";
export const SPANS_YEARS_MESSAGE = "Time off cannot span two years: split the request.";
export const END_BEFORE_START_MESSAGE = "The end date is before the start date.";
export const HOURS_REQUIRED_MESSAGE = "Enter the hours.";

/** Weekday of a date key, 0 = Sunday (calendar arithmetic, no zone). */
export function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** Every date key from `from` to `to`, inclusive. */
export function dateKeysBetween(from: string, to: string): string[] {
  const keys: string[] = [];
  for (let k = from; k <= to; k = addDaysToKey(k, 1)) keys.push(k);
  return keys;
}

export function isWorkingDay(
  dateKey: string,
  capacity: Capacity,
  holidayKeys: ReadonlySet<string>,
): boolean {
  return capacity.workingDays.includes(weekdayOfKey(dateKey)) && !holidayKeys.has(dateKey);
}

function assertSpan(span: TimeOffSpan): void {
  if (span.end < span.start) throw new Error(END_BEFORE_START_MESSAGE);
  if (span.start.slice(0, 4) !== span.end.slice(0, 4)) throw new Error(SPANS_YEARS_MESSAGE);
  if (span.halfDay && span.start !== span.end) throw new Error(HALF_DAY_MESSAGE);
}

function workingKeys(span: TimeOffSpan, capacity: Capacity, holidayKeys: ReadonlySet<string>) {
  return dateKeysBetween(span.start, span.end).filter((k) =>
    isWorkingDay(k, capacity, holidayKeys),
  );
}

/** round_half_up(minutes × 100 / 60): minutes as hundredths of an hour. */
function minutesToCenti(minutes: number): number {
  return Math.floor((minutes * 100 + 30) / 60);
}

/** What a request takes from the balance, in hundredths (decision 10). */
export function countRequestCenti(
  unit: TimeOffUnit,
  span: TimeOffSpan,
  capacity: Capacity,
  holidayKeys: ReadonlySet<string>,
): number {
  assertSpan(span);
  if (unit === "HOURS") {
    if (span.minutes === null || span.minutes <= 0) throw new Error(HOURS_REQUIRED_MESSAGE);
    return minutesToCenti(span.minutes);
  }
  const days = workingKeys(span, capacity, holidayKeys).length;
  return span.halfDay ? days * 50 : days * 100;
}

/** Minutes of time off on each day of a request (for attendance and the timesheet). */
export function timeOffMinutesByDay(
  unit: TimeOffUnit,
  span: TimeOffSpan,
  capacity: Capacity,
  holidayKeys: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  if (unit === "HOURS" && span.start === span.end) {
    if (span.minutes) out.set(span.start, span.minutes);
    return out;
  }
  const keys = workingKeys(span, capacity, holidayKeys);
  if (unit === "DAYS") {
    const minutes = span.halfDay ? Math.floor(capacity.dailyMinutes / 2) : capacity.dailyMinutes;
    for (const k of keys) out.set(k, minutes);
    return out;
  }
  const total = span.minutes ?? 0;
  if (keys.length === 0 || total <= 0) return out;
  const each = Math.floor(total / keys.length);
  let remainder = total - each * keys.length;
  for (const k of keys) {
    out.set(k, each + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder -= 1;
  }
  return out;
}

export interface BalanceInput {
  accrual: TimeOffAccrual;
  allowanceCenti: number;
  allowNegative: boolean;
  year: number;
  /** The later of the person's join date and the policy assignment date. */
  startedOn: string;
  /** Today in the workspace timezone. */
  today: string;
  adjustmentsCenti: number;
  approvedCenti: number;
  pendingCenti: number;
}

export interface Balance {
  grantedCenti: number;
  adjustmentsCenti: number;
  usedCenti: number;
  pendingCenti: number;
  /** Granted + adjustments − approved; pending is shown apart. */
  balanceCenti: number;
  unlimited: boolean;
}

/** Months granted in `year` by a MONTHLY policy: the 1st of each month on or after `startedOn`, up to today. */
function monthsGranted(year: number, startedOn: string, today: string): number {
  let count = 0;
  for (let m = 1; m <= 12; m += 1) {
    const first = `${year}-${String(m).padStart(2, "0")}-01`;
    if (first >= startedOn && first <= today) count += 1;
  }
  return count;
}

function grantedCenti(input: BalanceInput): number {
  const yearStart = `${input.year}-01-01`;
  const yearEnd = `${input.year}-12-31`;
  if (input.startedOn > yearEnd || input.today < yearStart) return 0;
  if (input.accrual === "YEARLY") return input.allowanceCenti;
  if (input.accrual === "MONTHLY") {
    const months = monthsGranted(input.year, input.startedOn, input.today);
    return Math.floor((input.allowanceCenti * months * 2 + 12) / 24);
  }
  return 0;
}

export function policyBalance(input: BalanceInput): Balance {
  const granted = grantedCenti(input);
  return {
    grantedCenti: granted,
    adjustmentsCenti: input.adjustmentsCenti,
    usedCenti: input.approvedCenti,
    pendingCenti: input.pendingCenti,
    balanceCenti: granted + input.adjustmentsCenti - input.approvedCenti,
    unlimited: input.accrual === "NONE" && input.allowNegative,
  };
}

/** Pending requests count here, so two requests cannot both spend the last days. */
export function wouldGoNegative(b: Balance, requestCenti: number, allowNegative: boolean): boolean {
  return !allowNegative && !b.unlimited && b.balanceCenti - b.pendingCenti - requestCenti < 0;
}

/** 150, "DAYS" → "1.5 days"; 100 → "1 day"; 750, "HOURS" → "7.5 hours". */
export function formatCenti(centi: number, unit: TimeOffUnit): string {
  const sign = centi < 0 ? "-" : "";
  const abs = Math.abs(centi);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  const number = `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
  const word = unit === "DAYS" ? "day" : "hour";
  return `${number} ${word}${abs === 100 ? "" : "s"}`;
}

/** "1.5" → 150, "-2" → -200: digits with at most two decimals (never parseFloat). */
export function parseCenti(text: string): number | null {
  const m = /^(-)?(\d{1,6})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const centi = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] && centi !== 0 ? -centi : centi;
}
