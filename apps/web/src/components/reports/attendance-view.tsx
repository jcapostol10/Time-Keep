"use client";

import { formatDateKey, formatDuration, formatTimeOfDay } from "@timekeep/core";
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
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { fetchJson } from "@/lib/fetch-json";
import type { AttendancePerson, AttendanceReport } from "@/lib/report-types";

import { trackerKeys, trackerUrls } from "../tracker/query-keys";
import { useTracker } from "../tracker/tracker-provider";
import { useReportQuery } from "./report-url";

export function useAttendance(slug: string, params: string) {
  return useQuery({
    queryKey: trackerKeys.report(slug, "attendance", params),
    queryFn: () => fetchJson<AttendanceReport>(trackerUrls.report(slug, "attendance", params)),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
}

const MEASURES = [
  ["work", "Work", "workSeconds"],
  ["breaks", "Breaks", "breakSeconds"],
  ["timeOff", "Time off", "timeOffSeconds"],
  ["capacity", "Capacity", "capacitySeconds"],
  ["overtime", "Overtime", "overtimeSeconds"],
  ["undertime", "Undertime", "undertimeSeconds"],
] as const;

type Measured = Record<(typeof MEASURES)[number][2], number>;

/**
 * The Attendance tab (Phase 5b): for each person, their own days (first in,
 * last out, work, breaks, time off, capacity, overtime, undertime), a subtotal
 * per week and a total. Raw time: rounding never applies.
 */
export function AttendanceView() {
  const { slug, viewer } = useTracker();
  const { params } = useReportQuery();
  const { data } = useAttendance(slug, params);
  const fmt = (s: number) => formatDuration(s, viewer.durationFormat);
  if (!data) return <Skeleton className="h-64 w-full" />;
  const work = data.people.reduce((n, p) => n + p.totals.workSeconds, 0);
  return (
    <div className="space-y-6">
      <div className="flex items-baseline gap-2">
        <span className="text-muted-foreground text-sm">{data.label}</span>
        <span data-testid="report-total" className="text-2xl font-semibold tabular-nums">
          {fmt(work)}
        </span>
      </div>
      {data.people.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">Nobody to show.</p>
      ) : (
        data.people.map((p) => <PersonSection key={p.userId} person={p} />)
      )}
    </div>
  );
}

function Measures({ row }: { row: Measured }) {
  const { viewer } = useTracker();
  return MEASURES.map(([col, , field]) => (
    <TableCell key={col} data-col={col} className="text-right tabular-nums">
      {formatDuration(row[field], viewer.durationFormat)}
    </TableCell>
  ));
}

function PersonSection({ person }: { person: AttendancePerson }) {
  const { viewer } = useTracker();
  const time = (iso: string | null) =>
    iso ? formatTimeOfDay(new Date(iso), person.timezone, viewer.timeFormat) : "";
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{person.userName}</h2>
      <div className="rounded-md border">
        <Table aria-label={`Attendance of ${person.userName}`}>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>First in</TableHead>
              <TableHead>Last out</TableHead>
              {MEASURES.map(([col, label]) => (
                <TableHead key={col} className="text-right">
                  {label}
                </TableHead>
              ))}
              <TableHead>Holiday</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {person.weeks.map((week, i) => {
              const next = person.weeks[i + 1]?.weekStart;
              const days = person.days.filter(
                (d) => d.dateKey >= week.weekStart && (!next || d.dateKey < next),
              );
              return [
                ...days.map((d) => (
                  <TableRow key={d.dateKey} data-kind="day">
                    <TableCell className="whitespace-nowrap">{formatDateKey(d.dateKey)}</TableCell>
                    <TableCell className="tabular-nums">{time(d.firstStart)}</TableCell>
                    <TableCell className="tabular-nums">{time(d.lastEnd)}</TableCell>
                    <Measures row={d} />
                    <TableCell>{d.holiday ?? ""}</TableCell>
                  </TableRow>
                )),
                <TableRow key={`week-${week.weekStart}`} data-kind="week" className="bg-muted/30">
                  <TableCell colSpan={3} className="font-medium">
                    Week of {formatDateKey(week.weekStart)}
                  </TableCell>
                  <Measures row={week} />
                  <TableCell />
                </TableRow>,
              ];
            })}
          </TableBody>
          <TableFooter>
            <TableRow data-kind="total">
              <TableCell colSpan={3} className="font-semibold">
                Total
              </TableCell>
              <Measures row={person.totals} />
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </section>
  );
}
