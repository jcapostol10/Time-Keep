/**
 * Report rounding (decision 13 of the Phase 4 design): a workspace rule that
 * rounds each entry's duration in report views, exports and share links.
 * The tracker, timesheet, calendar and dashboard show raw time. The SQL twin
 * lives in packages/db/src/rounding-sql.ts and is tested to agree.
 */

export const ROUNDING_MODES = ["off", "up", "down", "nearest"] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

export const ROUNDING_STEPS = [1, 5, 6, 10, 12, 15, 30, 60] as const;
export type RoundingStep = (typeof ROUNDING_STEPS)[number];

export interface RoundingRule {
  mode: RoundingMode;
  minutes: RoundingStep;
}

/** A duration rounded per the rule; never negative; "nearest" ties round up. */
export function roundDuration(seconds: number, rule: RoundingRule): number {
  const s = Math.max(0, seconds);
  const step = rule.minutes * 60;
  switch (rule.mode) {
    case "off":
      return s;
    case "up":
      return Math.ceil(s / step) * step;
    case "down":
      return Math.floor(s / step) * step;
    case "nearest":
      return Math.floor((s + step / 2) / step) * step;
  }
}

const MODE_LABELS: Record<Exclude<RoundingMode, "off">, string> = {
  up: "Up to",
  down: "Down to",
  nearest: "Nearest",
};

export function roundingLabel(rule: RoundingRule | null): string {
  if (!rule || rule.mode === "off") return "Off";
  return `${MODE_LABELS[rule.mode]} ${rule.minutes} min`;
}
