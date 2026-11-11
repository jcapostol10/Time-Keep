/**
 * The forecast on the Budget tab (Phase 7 design, decisions 19–21): what was
 * tracked in the estimate's period plus the published plan from tomorrow,
 * against the estimate. The overrun is measured in the estimate's own unit;
 * the other unit is its value at the rated work's average: a share over the
 * rated part of the projection only (integers, half up), so unrated or
 * non-billable hours never dilute it.
 */

export interface ForecastDay {
  dateKey: string;
  seconds: number;
  /** Minor units of the project's currency; 0 when unrated. */
  minor: number;
}

export interface Forecast {
  kind: "TIME" | "MONEY";
  /** Seconds or minor units. */
  estimate: number;
  trackedSeconds: number;
  trackedMinor: number;
  scheduledSeconds: number;
  scheduledMinor: number;
  /** Scheduled time with no rate in force (or on a non-billable project). */
  unratedSeconds: number;
  projectedSeconds: number;
  projectedMinor: number;
  /** The day tracked time reached the estimate, when it already has. */
  reachedOn: string | null;
  /** The first scheduled day the projection reaches the estimate; null if reached or never. */
  completionDate: string | null;
  overrunSeconds: number;
  overrunMinor: number;
  /** The cumulative projection in the estimate's unit, from the tracked total. */
  series: { dateKey: string | null; value: number }[];
}

/** `value × part / whole`, half up, in integers; 0 when `whole` is 0. */
export function proportion(value: number, part: number, whole: number): number {
  if (whole === 0) return 0;
  const two = BigInt(2);
  const n = BigInt(value) * BigInt(part) * two + BigInt(whole);
  return Number(n / (two * BigInt(whole)));
}

export function forecast(input: {
  kind: "TIME" | "MONEY";
  estimate: number;
  trackedSeconds: number;
  trackedMinor: number;
  /** Tracked seconds whose amount counts (billable, rated in the project's currency). */
  trackedRatedSeconds: number;
  trackedReachedOn: string | null;
  scheduled: readonly ForecastDay[];
  unratedSeconds: number;
}): Forecast {
  const days = [...input.scheduled].sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
  const scheduledSeconds = days.reduce((n, d) => n + d.seconds, 0);
  const scheduledMinor = days.reduce((n, d) => n + d.minor, 0);
  const projectedSeconds = input.trackedSeconds + scheduledSeconds;
  const projectedMinor = input.trackedMinor + scheduledMinor;
  const time = input.kind === "TIME";
  const tracked = time ? input.trackedSeconds : input.trackedMinor;
  const reached = tracked >= input.estimate;

  let running = tracked;
  let completionDate: string | null = null;
  const series: Forecast["series"] = [{ dateKey: null, value: tracked }];
  for (const d of days) {
    running += time ? d.seconds : d.minor;
    series.push({ dateKey: d.dateKey, value: running });
    if (!reached && completionDate === null && running >= input.estimate)
      completionDate = d.dateKey;
  }

  const ratedSeconds = input.trackedRatedSeconds + scheduledSeconds - input.unratedSeconds;
  const projected = time ? projectedSeconds : projectedMinor;
  const overrun = Math.max(0, projected - input.estimate);
  return {
    kind: input.kind,
    estimate: input.estimate,
    trackedSeconds: input.trackedSeconds,
    trackedMinor: input.trackedMinor,
    scheduledSeconds,
    scheduledMinor,
    unratedSeconds: input.unratedSeconds,
    projectedSeconds,
    projectedMinor,
    reachedOn: reached ? input.trackedReachedOn : null,
    completionDate,
    overrunSeconds: time ? overrun : proportion(ratedSeconds, overrun, projectedMinor),
    overrunMinor: time ? proportion(projectedMinor, overrun, ratedSeconds) : overrun,
    series,
  };
}
