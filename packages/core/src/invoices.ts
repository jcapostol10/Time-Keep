import { addDaysToKey } from "./approvals";
import { weekdayOfKey } from "./time-off";

/**
 * Invoicing (Phase 6d, decisions 20–28). Pure maths: money is integer minor
 * units, percents are hundredths of a percent (bps, 0–10000), dates are keys.
 */

export const INVOICE_STATUSES = ["DRAFT", "SENT", "VOID"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const COMPUTED_INVOICE_STATUSES = [
  "DRAFT",
  "SENT",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "VOID",
] as const;
export type ComputedInvoiceStatus = (typeof COMPUTED_INVOICE_STATUSES)[number];

export const INVOICE_LINE_KINDS = ["TIME", "EXPENSE", "MANUAL"] as const;
export type InvoiceLineKind = (typeof INVOICE_LINE_KINDS)[number];

export const IMPORT_GROUPS = ["project", "task", "user", "entry"] as const;
export type ImportGroup = (typeof IMPORT_GROUPS)[number];

export const RECURRING_SCHEDULES = ["WEEKLY", "MONTHLY"] as const;
export type RecurringScheduleKind = (typeof RECURRING_SCHEDULES)[number];
export const RECURRING_MODES = ["DRAFT", "SEND"] as const;
export type RecurringMode = (typeof RECURRING_MODES)[number];

export const BPS_MAX = 10000;

/**
 * Decision 21: stored DRAFT | SENT | VOID; the rest follows from the total,
 * the payments and today's date (a key in the workspace timezone).
 * `invoiceStatusSql` mirrors this branch for branch.
 */
export function invoiceStatus(
  inv: { status: InvoiceStatus; totalMinor: number; paidMinor: number; dueDate: string },
  todayKey: string,
): ComputedInvoiceStatus {
  if (inv.status !== "SENT") return inv.status;
  if (inv.paidMinor >= inv.totalMinor && (inv.totalMinor > 0 || inv.paidMinor > 0)) return "PAID";
  if (inv.paidMinor > 0) return "PARTIALLY_PAID";
  if (inv.dueDate < todayKey) return "OVERDUE";
  return "SENT";
}

export function balanceMinor(totalMinor: number, paidMinor: number): number {
  return Math.max(0, totalMinor - paidMinor);
}

function divHalfUp(numerator: bigint, denominator: bigint): number {
  return Number((numerator + denominator / BigInt(2)) / denominator);
}

/** A manual line: round_half_up(quantity_centi × unit_price_minor / 100). */
export function lineAmount(quantityCenti: number, unitPriceMinor: number): number {
  return divHalfUp(BigInt(quantityCenti) * BigInt(unitPriceMinor), BigInt(100));
}

/** round_half_up(minor × bps / 10000). */
export function percentOf(minor: number, bps: number): number {
  return divHalfUp(BigInt(minor) * BigInt(bps), BigInt(BPS_MAX));
}

export interface InvoiceRates {
  discountBps: number;
  tax1Bps: number | null;
  tax2Bps: number | null;
}

export interface InvoiceTotals {
  subtotalMinor: number;
  discountMinor: number;
  tax1Minor: number;
  tax2Minor: number;
  totalMinor: number;
}

/**
 * Decision 22: subtotal = Σ lines; discount = a percent of the subtotal; each
 * tax = a percent of (subtotal − discount), rounded alone, never compounded.
 */
export function invoiceTotals(
  lines: readonly { amountMinor: number }[],
  rates: InvoiceRates,
): InvoiceTotals {
  const subtotalMinor = lines.reduce((sum, l) => sum + l.amountMinor, 0);
  const discountMinor = percentOf(subtotalMinor, rates.discountBps);
  const taxable = subtotalMinor - discountMinor;
  const tax1Minor = rates.tax1Bps === null ? 0 : percentOf(taxable, rates.tax1Bps);
  const tax2Minor = rates.tax2Bps === null ? 0 : percentOf(taxable, rates.tax2Bps);
  return {
    subtotalMinor,
    discountMinor,
    tax1Minor,
    tax2Minor,
    totalMinor: taxable + tax1Minor + tax2Minor,
  };
}

/** "7.5" → 750, "12,25" → 1225; null for anything that is not 0–100 with two decimals at most. */
export function parseBps(input: string): number | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const whole = Number(m[1]);
  const fraction = (m[2] ?? "").padEnd(2, "0");
  const bps = whole * 100 + Number(fraction);
  return bps > BPS_MAX ? null : bps;
}

/** 750 → "7.5", 1000 → "10", 1 → "0.01". */
export function formatBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const fraction = String(bps % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return fraction === "" ? String(whole) : `${whole}.${fraction}`;
}

/** Hours to two decimals: 5400 → "1.50". */
export function hoursText(seconds: number): string {
  return (Math.round((seconds / 3600) * 100) / 100).toFixed(2);
}

/** ("INV-", 1, 4) → "INV-0001"; a number longer than the padding is not cut. */
export function formatInvoiceNumber(prefix: string, n: number, padding: number): string {
  return `${prefix}${String(n).padStart(padding, "0")}`;
}

export interface RecurringSchedule {
  kind: RecurringScheduleKind;
  /** WEEKLY: 0 = Sunday … 6 = Saturday. */
  weekday: number | null;
  /** MONTHLY: 1–31, clamped to the month's last day. */
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
}

export interface RecurringPeriod {
  /** The unique key per template: the period's first day. */
  periodKey: string;
  periodStart: string;
  periodEnd: string;
}

function partsOf(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 };
}

function keyOf(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The number of days in the key's month. */
export function lastDayOfMonth(key: string): number {
  const { y, m } = partsOf(key);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The first day of the key's month. */
export function monthStartKey(key: string): string {
  const { y, m } = partsOf(key);
  return keyOf(y, m, 1);
}

/**
 * Decision 27: is the template due today, and for which period? WEEKLY runs on
 * its weekday for the seven days ending yesterday; MONTHLY runs on its day
 * (clamped to the month's last day) for the previous calendar month. Nothing
 * runs before the start, after the end, or for a period that began before the
 * start.
 */
export function recurringDue(s: RecurringSchedule, todayKey: string): RecurringPeriod | null {
  if (todayKey < s.startDate) return null;
  if (s.endDate !== null && todayKey > s.endDate) return null;
  let period: { periodStart: string; periodEnd: string };
  if (s.kind === "WEEKLY") {
    if (s.weekday === null || weekdayOfKey(todayKey) !== s.weekday) return null;
    period = { periodStart: addDaysToKey(todayKey, -7), periodEnd: addDaysToKey(todayKey, -1) };
  } else {
    if (s.dayOfMonth === null) return null;
    const { d } = partsOf(todayKey);
    if (d !== Math.min(s.dayOfMonth, lastDayOfMonth(todayKey))) return null;
    const periodEnd = addDaysToKey(monthStartKey(todayKey), -1);
    period = { periodStart: monthStartKey(periodEnd), periodEnd };
  }
  if (period.periodStart < s.startDate) return null;
  return { periodKey: period.periodStart, ...period };
}
