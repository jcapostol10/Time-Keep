"use client";

import {
  addDaysInZone,
  formatDuration,
  formatMoney,
  localDateKey,
  zonedDateTimeToInstant,
} from "@timekeep/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { Skeleton } from "@timekeep/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { cn } from "@timekeep/ui/lib/utils";
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { detailedHref, detailedParams } from "@/lib/report-links";

import { useTracker } from "../tracker/tracker-provider";
import { useReportQuery } from "./report-url";
import { useReportOptions, useWeekly } from "./use-report";

const noop = () => () => {};

/** Rows (projects, or people for team readers) over the seven days of the range's week. */
export function WeeklyView() {
  const { slug, viewer } = useTracker();
  const { query, params, set } = useReportQuery();
  const { data: options } = useReportOptions(slug);
  const canListPeople = Boolean(options?.users);
  // The rows are part of the query, so the URL, exports and share links carry them.
  const by = canListPeople ? query.weeklyBy : "project";
  const { data } = useWeekly(slug, params);
  const tz = viewer.timezone;
  const fmt = (seconds: number) => formatDuration(seconds, viewer.durationFormat);
  /** The Detailed report for one row's day, within the shown week. */
  const cellHref = (rowId: string | null, day: string, dayKeys: string[], rowsBy: typeof by) => {
    const start = zonedDateTimeToInstant({ date: dayKeys[0] ?? day, hours: 0, minutes: 0 }, tz);
    const week = { from: start, to: addDaysInZone(start, 7, tz) };
    const steps = [
      { key: rowsBy, id: rowId },
      { key: "date" as const, id: day },
    ];
    return detailedHref(slug, detailedParams(query, steps, week, tz));
  };
  // Today is only known in the browser; the server renders without the highlight.
  const todayKey = useSyncExternalStore(
    noop,
    () => localDateKey(new Date(), tz),
    () => null,
  );
  const heading = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">Week of {data?.dayKeys[0] ?? "…"}</p>
          <p className="text-3xl font-semibold tabular-nums" data-testid="report-total">
            {data ? fmt(data.total) : "…"}
          </p>
        </div>
        {canListPeople ? (
          <Select
            value={by}
            onValueChange={(v) => set({ weeklyBy: v === "user" ? "user" : "project" })}
          >
            <SelectTrigger size="sm" aria-label="Rows" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="project">Projects</SelectItem>
              <SelectItem value="user">People</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {!data ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table aria-label="Weekly report">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-40">
                  {data.by === "user" ? "Person" : "Project"}
                </TableHead>
                {data.dayKeys.map((day) => (
                  <TableHead
                    key={day}
                    className={cn("text-right", day === todayKey && "text-foreground")}
                  >
                    {heading.format(
                      zonedDateTimeToInstant({ date: day, hours: 12, minutes: 0 }, tz),
                    )}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
                {data.money ? <TableHead className="text-right">Amount</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={data.money ? 10 : 9}
                    className="text-muted-foreground py-8 text-center"
                  >
                    No time this week.
                  </TableCell>
                </TableRow>
              ) : (
                data.rows.map((row) => (
                  <TableRow key={row.id ?? "none"} aria-label={`${row.label} ${fmt(row.total)}`}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    {row.days.map((seconds, i) => (
                      <TableCell
                        key={data.dayKeys[i]}
                        className={cn(
                          "text-right tabular-nums",
                          seconds === 0 && "text-muted-foreground",
                        )}
                      >
                        {seconds === 0 ? (
                          "—"
                        ) : (
                          <Link
                            href={cellHref(row.id, data.dayKeys[i]!, data.dayKeys, data.by)}
                            className="hover:underline"
                          >
                            {fmt(seconds)}
                          </Link>
                        )}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fmt(row.total)}
                    </TableCell>
                    {data.money ? (
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.amountMinor, data.money.currency)}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                {data.dayTotals.map((seconds, i) => (
                  <TableCell
                    key={data.dayKeys[i]}
                    className="text-right tabular-nums"
                    data-testid={data.dayKeys[i] === todayKey ? "weekly-today-total" : undefined}
                  >
                    {fmt(seconds)}
                  </TableCell>
                ))}
                <TableCell className="text-right font-semibold tabular-nums">
                  {fmt(data.total)}
                </TableCell>
                {data.money ? (
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatMoney(data.amountMinor, data.money.currency)}
                  </TableCell>
                ) : null}
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}
