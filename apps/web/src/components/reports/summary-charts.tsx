"use client";

import { type DurationFormat, formatDuration, type ReportGroup } from "@timekeep/core";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { SummaryReport } from "@/lib/report-types";

const MAX_SLICES = 8;

/** The first grouping's largest groups, the rest folded into "Other". */
export function donutSlices(groups: ReportGroup[]): { label: string; value: number }[] {
  const sorted = [...groups].sort((a, b) => b.totals.durationSeconds - a.totals.durationSeconds);
  const top = sorted
    .slice(0, MAX_SLICES)
    .map((g) => ({ label: g.label, value: g.totals.durationSeconds }));
  const rest = sorted.slice(MAX_SLICES).reduce((n, g) => n + g.totals.durationSeconds, 0);
  return rest > 0 ? [...top, { label: "Other", value: rest }] : top;
}

const tooltipStyle = {
  background: "var(--popover)",
  borderColor: "var(--border)",
  color: "var(--popover-foreground)",
  borderRadius: 8,
  fontSize: 12,
};

/** Time per bucket (billable stacked on non-billable) and a donut by the first grouping. */
export function SummaryCharts({
  report,
  durationFormat,
}: {
  report: SummaryReport;
  durationFormat: DurationFormat;
}) {
  const bars = report.series.map((p) => ({
    label: p.label,
    billable: p.billableSeconds,
    nonBillable: p.nonBillableSeconds,
  }));
  const slices = donutSlices(report.groups);
  const fmt = (value: unknown) => formatDuration(Number(value ?? 0), durationFormat);
  const hours = (seconds: number) => `${Math.round(seconds / 360) / 10}h`;

  return (
    <div data-testid="summary-chart" className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="bg-card h-64 rounded-lg border p-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={hours}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip
              cursor={{ fill: "var(--accent)", opacity: 0.4 }}
              contentStyle={tooltipStyle}
              formatter={(value, name) => [
                fmt(value),
                name === "billable" ? "Billable" : "Non-billable",
              ]}
            />
            <Bar dataKey="nonBillable" stackId="time" fill="var(--chart-2)" radius={[0, 0, 0, 0]} />
            <Bar dataKey="billable" stackId="time" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="bg-card h-64 rounded-lg border p-3">
        {slices.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="label"
                innerRadius="55%"
                outerRadius="85%"
                paddingAngle={2}
                stroke="var(--card)"
              >
                {slices.map((s, i) => (
                  <Cell key={s.label} fill={`var(--chart-${(i % 5) + 1})`} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => fmt(value)} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-muted-foreground flex h-full items-center justify-center text-sm">
            No time in this range
          </p>
        )}
      </div>
    </div>
  );
}
