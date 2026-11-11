"use client";

import { type DurationFormat, formatDateKey, formatDuration, formatMoney } from "@timekeep/core";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import Link from "next/link";
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { BudgetDTO } from "@/lib/catalog-types";

import { EstimateForm } from "./estimate-form";
import { ForecastPanel } from "./forecast-panel";
import { ProgressBar } from "./progress-bar";

/**
 * The Budget tab (Phase 6b, decision 12): the estimate's settings, the bar,
 * the cumulative chart against the estimate over the period, and the tasks
 * with estimates.
 */
export function BudgetTab({
  slug,
  projectId,
  budget,
  durationFormat,
  settingsHref,
}: {
  slug: string;
  projectId: string;
  budget: BudgetDTO;
  durationFormat: DurationFormat;
  settingsHref: string;
}) {
  const { progress, forecast } = budget;
  // The forecast shows once the published plan holds something in the period, or the estimate is reached.
  const showForecast = forecast && (forecast.scheduledSeconds > 0 || forecast.reachedOn !== null);
  // The chart: tracked to today, then the plan's cumulative projection as a dashed area.
  const chart: { label: string; value?: number; scheduled?: number }[] = budget.series.map((p) => ({
    label: p.label,
    value: p.value,
  }));
  if (showForecast && forecast.scheduledSeconds > 0 && chart.length > 0) {
    const last = chart[chart.length - 1]!;
    last.scheduled = last.value;
    for (const p of forecast.series) {
      if (p.dateKey) chart.push({ label: formatDateKey(p.dateKey), scheduled: p.value });
    }
  }
  const fmt = (value: number) =>
    progress?.kind === "MONEY"
      ? formatMoney(value, budget.currency)
      : formatDuration(value, durationFormat);
  const axis = (value: number) =>
    progress?.kind === "MONEY"
      ? formatMoney(value, budget.currency)
      : `${Math.round(value / 360) / 10}h`;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Estimate</h2>
        <EstimateForm
          slug={slug}
          projectId={projectId}
          estimate={budget.estimate}
          currency={budget.currency}
          thresholds={budget.thresholds}
        />
        <p className="text-muted-foreground text-xs">
          Alert thresholds are a workspace setting:{" "}
          <Link href={settingsHref} className="underline">
            change them in Settings
          </Link>
          .
        </p>
      </section>

      <section className="space-y-3" data-testid="budget-progress">
        <h2 className="text-base font-semibold">Progress</h2>
        {progress ? (
          <ProgressBar progress={progress} durationFormat={durationFormat} size="lg" />
        ) : (
          <p className="text-muted-foreground text-sm">No estimate yet.</p>
        )}
        {progress?.kind === "MONEY" && !budget.hasRates ? (
          <p role="status" className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm">
            This project has no rate in {budget.currency} yet, so a money estimate cannot fill.
          </p>
        ) : null}
      </section>

      {showForecast ? (
        <ForecastPanel
          forecast={forecast}
          currency={budget.currency}
          durationFormat={durationFormat}
        />
      ) : null}

      {progress && chart.length > 1 ? (
        <figure className="bg-card h-56 rounded-lg border p-3" data-testid="budget-chart">
          <figcaption className="sr-only">Tracked against the estimate</figcaption>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={axis}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={64}
                domain={[0, (max: number) => Math.max(max, progress.estimate)]}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  borderColor: "var(--border)",
                  color: "var(--popover-foreground)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v, name) => [
                  fmt(Number(v ?? 0)),
                  name === "scheduled" ? "Scheduled" : "Tracked",
                ]}
              />
              <ReferenceLine
                y={progress.estimate}
                stroke="var(--destructive)"
                strokeDasharray="4 4"
                label={{ value: "Estimate", fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--chart-1)"
                fill="var(--chart-1)"
                fillOpacity={0.2}
              />
              <Area
                type="monotone"
                dataKey="scheduled"
                stroke="var(--chart-2)"
                strokeDasharray="5 4"
                fill="var(--chart-2)"
                fillOpacity={0.1}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </figure>
      ) : null}

      {budget.tasks.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Tasks with estimates</h2>
          <div className="overflow-hidden rounded-lg border">
            <Table aria-label="Tasks with estimates">
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead className="text-right">Estimate</TableHead>
                  <TableHead className="text-right">Tracked</TableHead>
                  <TableHead className="w-48">Progress</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budget.tasks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">
                      {t.name}
                      {t.status === "DONE" ? (
                        <span className="text-muted-foreground ml-2 text-xs">Done</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDuration(t.estimateSeconds, durationFormat)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDuration(t.trackedSeconds, durationFormat)}
                    </TableCell>
                    <TableCell>
                      <ProgressBar
                        durationFormat={durationFormat}
                        progress={{
                          kind: "TIME",
                          used: t.trackedSeconds,
                          estimate: t.estimateSeconds,
                          percent: Math.floor((t.trackedSeconds * 100) / t.estimateSeconds),
                          currency: null,
                          period: { key: "all", from: null, to: null, label: null },
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
