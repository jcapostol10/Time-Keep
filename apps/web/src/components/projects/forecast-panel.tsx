"use client";

import {
  type DurationFormat,
  type Forecast,
  formatDateKey,
  formatDuration,
  formatMoney,
} from "@timekeep/core";
import { cn } from "@timekeep/ui/lib/utils";

/**
 * The forecast (Phase 7b, decisions 19–21): what was tracked in the
 * estimate's period, the published plan from tomorrow, the projection, the
 * day it reaches the estimate and the overrun, in hours and in money.
 */
export function ForecastPanel({
  forecast,
  currency,
  durationFormat,
}: {
  forecast: Forecast;
  currency: string;
  durationFormat: DurationFormat;
}) {
  const hours = (s: number) => formatDuration(s, durationFormat);
  const money = (m: number) => formatMoney(m, currency);
  const showMoney =
    forecast.kind === "MONEY" || forecast.trackedMinor + forecast.scheduledMinor > 0;
  const both = (s: number, m: number) => (showMoney ? `${hours(s)} · ${money(m)}` : hours(s));
  const over = forecast.overrunSeconds > 0 || forecast.overrunMinor > 0;

  return (
    <section aria-label="Forecast" className="space-y-3">
      <h2 className="text-base font-semibold">Forecast</h2>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-3">
          <dt className="text-muted-foreground text-xs">Tracked</dt>
          <dd className="tabular-nums">{both(forecast.trackedSeconds, forecast.trackedMinor)}</dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-muted-foreground text-xs">Scheduled from tomorrow</dt>
          <dd className="tabular-nums">
            {both(forecast.scheduledSeconds, forecast.scheduledMinor)}
          </dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-muted-foreground text-xs">Projected</dt>
          <dd className="tabular-nums">
            {both(forecast.projectedSeconds, forecast.projectedMinor)}
          </dd>
        </div>
        <div className="rounded-lg border p-3">
          <dt className="text-muted-foreground text-xs">Projected completion</dt>
          <dd
            data-testid="forecast-completion"
            data-date={forecast.completionDate ?? forecast.reachedOn ?? undefined}
          >
            {forecast.completionDate
              ? formatDateKey(forecast.completionDate)
              : forecast.reachedOn
                ? `Reached on ${formatDateKey(forecast.reachedOn)}`
                : "Not reached by the published plan"}
          </dd>
        </div>
        <div className={cn("rounded-lg border p-3", over && "border-destructive/50")}>
          <dt className="text-muted-foreground text-xs">Projected overrun</dt>
          <dd
            data-testid="forecast-overrun"
            className={cn("tabular-nums", over && "text-destructive font-medium")}
          >
            {over
              ? forecast.kind === "TIME"
                ? showMoney
                  ? `${hours(forecast.overrunSeconds)} · about ${money(forecast.overrunMinor)}`
                  : hours(forecast.overrunSeconds)
                : `${money(forecast.overrunMinor)} · about ${hours(forecast.overrunSeconds)}`
              : "None"}
          </dd>
        </div>
      </dl>
      {forecast.unratedSeconds > 0 ? (
        <p role="status" className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm">
          {hours(forecast.unratedSeconds)} of the plan has no billable rate, so it adds no money.
        </p>
      ) : null}
    </section>
  );
}
