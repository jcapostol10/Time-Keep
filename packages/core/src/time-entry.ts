import { MAX_ENTRY_SECONDS } from "./duration";

export type EntryRangeMode = "timer-stop" | "manual";

/** How far in the future a timer may be stopped (clock skew allowance). */
export const TIMER_STOP_FUTURE_GRACE_MS = 60_000;

export type RangeValidation = { ok: true } | { ok: false; error: string };

/**
 * Shared server/client validation for an entry's time range:
 * end > start, at most 999 hours, and timers may not stop more than a minute
 * in the future. Manual entries may be scheduled in the future.
 */
export function validateEntryRange(args: {
  start: Date;
  end: Date;
  now: Date;
  mode: EntryRangeMode;
}): RangeValidation {
  const { start, end, now, mode } = args;
  if (end.getTime() <= start.getTime()) {
    return { ok: false, error: "The end time must be after the start time." };
  }
  if (end.getTime() - start.getTime() > MAX_ENTRY_SECONDS * 1000) {
    return { ok: false, error: "An entry cannot be longer than 999 hours." };
  }
  if (mode === "timer-stop" && end.getTime() > now.getTime() + TIMER_STOP_FUTURE_GRACE_MS) {
    return { ok: false, error: "A timer cannot be stopped in the future." };
  }
  return { ok: true };
}
