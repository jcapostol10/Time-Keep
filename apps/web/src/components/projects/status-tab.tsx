"use client";

import {
  addDaysInZone,
  type DurationFormat,
  formatDuration,
  formatMoney,
  localDateKey,
  monthBoundsInZone,
  weekBounds,
  type WeekStartDay,
} from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import { Input } from "@timekeep/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { ProjectStatus } from "@/lib/catalog-types";
import { workspaceRoutes } from "@/lib/routes";

/** Tracked time on the project by task and by member for an inclusive date range. */
export function StatusTab({
  status,
  fromKey,
  toKey,
  timezone,
  weekStart,
  durationFormat,
  reportParams,
  slug,
}: {
  status: ProjectStatus;
  fromKey: string;
  toKey: string;
  timezone: string;
  weekStart: WeekStartDay;
  durationFormat: DurationFormat;
  /** The project and range as a report query, for the export and the reports link. */
  reportParams: string;
  slug: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const fmt = (s: number) => formatDuration(s, durationFormat);

  function go(from: string, to: string) {
    router.replace(`${pathname}?from=${from}&to=${to}`);
  }

  function preset(kind: "this-week" | "last-week" | "this-month" | "last-month") {
    const now = new Date();
    if (kind === "this-week" || kind === "last-week") {
      const anchor = kind === "this-week" ? now : addDaysInZone(now, -7, timezone);
      const { weekStart: ws, weekEnd } = weekBounds(anchor, timezone, weekStart);
      go(localDateKey(ws, timezone), localDateKey(addDaysInZone(weekEnd, -1, timezone), timezone));
    } else {
      const anchor =
        kind === "this-month"
          ? now
          : addDaysInZone(monthBoundsInZone(now, timezone).monthStart, -1, timezone);
      const { monthStart, monthEnd } = monthBoundsInZone(anchor, timezone);
      go(
        localDateKey(monthStart, timezone),
        localDateKey(addDaysInZone(monthEnd, -1, timezone), timezone),
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Range" className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={() => preset("this-week")}>
            This week
          </Button>
          <Button size="sm" variant="outline" onClick={() => preset("last-week")}>
            Last week
          </Button>
          <Button size="sm" variant="outline" onClick={() => preset("this-month")}>
            This month
          </Button>
          <Button size="sm" variant="outline" onClick={() => preset("last-month")}>
            Last month
          </Button>
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium">
          From
          <Input
            type="date"
            aria-label="From"
            value={fromKey}
            onChange={(e) => e.target.value && go(e.target.value, toKey)}
            className="w-40"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          To
          <Input
            type="date"
            aria-label="To"
            value={toKey}
            onChange={(e) => e.target.value && go(fromKey, e.target.value)}
            className="w-40"
          />
        </label>
        <div className="ml-auto flex gap-2">
          <Button asChild size="sm" variant="outline">
            <a
              href={`/api/w/${slug}/reports/export?${reportParams}&report=summary&format=csv`}
              download
            >
              Export CSV
            </a>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={`${workspaceRoutes.reports(slug, "summary")}?${reportParams}`}>
              Open in reports
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total" value={fmt(status.totalSeconds)} testId="status-total" />
        <Stat label="Billable" value={fmt(status.billableSeconds)} />
        <Stat label="Non-billable" value={fmt(status.nonBillableSeconds)} />
        {status.money ? (
          <Stat
            label="Amount"
            value={formatMoney(status.amountMinor, status.money.currency)}
            testId="status-amount"
          />
        ) : null}
      </div>

      {status.weeks ? (
        <figure className="bg-card h-40 rounded-lg border p-3" data-testid="status-weeks">
          <figcaption className="sr-only">Time by week</figcaption>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={status.weeks} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
              />
              <YAxis
                tickFormatter={(s: number) => `${Math.round(s / 360) / 10}h`}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={36}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  borderColor: "var(--border)",
                  color: "var(--popover-foreground)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v) => [fmt(Number(v ?? 0)), "Time"]}
              />
              <Bar dataKey="seconds" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </figure>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Breakdown
          label="Time by task"
          rows={status.byTask.map((t) => ({
            key: t.taskId ?? "none",
            name: t.name,
            seconds: t.seconds,
          }))}
          total={status.totalSeconds}
          fmt={fmt}
        />
        <Breakdown
          label="Time by member"
          rows={status.byMember.map((m) => ({ key: m.userId, name: m.name, seconds: m.seconds }))}
          total={status.totalSeconds}
          fmt={fmt}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-xl font-semibold tabular-nums" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

function Breakdown({
  label,
  rows,
  total,
  fmt,
}: {
  label: string;
  rows: { key: string; name: string; seconds: number }[];
  total: number;
  fmt: (s: number) => string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table aria-label={label}>
        <TableHeader>
          <TableRow>
            <TableHead>
              {label.replace("Time by ", "").replace(/^\w/, (c) => c.toUpperCase())}
            </TableHead>
            <TableHead className="text-right">Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={2} className="text-muted-foreground text-center">
                No time in this range
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell>{r.name}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(r.seconds)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Total</TableCell>
            <TableCell className="text-right tabular-nums">{fmt(total)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
