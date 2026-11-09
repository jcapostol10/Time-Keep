import { type Estimate, minorToDecimal, parseDuration } from "@timekeep/core";

/**
 * The estimate forms' text fields (Phase 6b): hours typed as a duration and
 * money typed in the project's currency, both read back exactly.
 */

/**
 * Hours typed as a duration ("40", "1.5", "1:30", "90m") or, past the
 * duration parser's 999-hour ceiling, as a plain number of hours.
 */
export function parseHours(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  const parsed = parseDuration(text);
  if (parsed !== null) return parsed > 0 ? parsed : null;
  if (!/^\d+(?:[.,]\d+)?$/.test(text)) return null;
  const hours = Number(text.replace(",", "."));
  return hours > 0 ? Math.round(hours * 3600) : null;
}

/** Seconds for the input: whole hours as "10", otherwise "h:mm" (parseHours reads both back). */
export function hoursText(seconds: number | null): string {
  if (seconds === null) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return minutes === 0 ? String(hours) : `${hours}:${String(minutes).padStart(2, "0")}`;
}

/** The estimate as the form shows it: hours, or the amount in the currency's own decimals. */
export function estimateAmountText(
  estimate: Pick<Estimate, "kind" | "seconds" | "minor">,
  currency: string,
): string {
  if (estimate.kind === "MONEY" && estimate.minor !== null) {
    return minorToDecimal(estimate.minor, currency);
  }
  if (estimate.kind === "TIME") return hoursText(estimate.seconds);
  return "";
}
