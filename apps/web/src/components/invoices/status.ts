import type { ComputedInvoiceStatus } from "@timekeep/core";

export const INVOICE_STATUS_LABELS: Record<ComputedInvoiceStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  VOID: "Void",
};

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** 1 → "1st", 22 → "22nd", 13 → "13th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "Weekly on Monday", "Monthly on the 31st". */
export function scheduleText(t: {
  schedule: "WEEKLY" | "MONTHLY";
  weekday: number | null;
  dayOfMonth: number | null;
}): string {
  return t.schedule === "WEEKLY"
    ? `Weekly on ${WEEKDAYS[t.weekday ?? 1]}`
    : `Monthly on the ${ordinal(t.dayOfMonth ?? 1)}`;
}
