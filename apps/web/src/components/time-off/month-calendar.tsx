"use client";

import { localDateKey, weekdayOfKey } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import { Skeleton } from "@timekeep/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { fetchJson } from "@/lib/fetch-json";
import type { TimeOffCalendarDTO } from "@/lib/time-off-types";

import { useHydrated } from "@/hooks/use-hydrated";
import { timeOffKeys, timeOffUrls } from "../tracker/query-keys";
import { useTracker } from "../tracker/tracker-provider";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function shiftMonth(month: string, by: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5)) - 1 + by;
  const date = new Date(Date.UTC(y, m, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-15T00:00:00Z`));
}

/** Who is away in a month and the holidays; at 375 px the grid becomes a list of days. */
export function MonthCalendar({ slug }: { slug: string }) {
  const { viewer } = useTracker();
  const hydrated = useHydrated();
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked ?? (hydrated ? localDateKey(new Date(), viewer.timezone).slice(0, 7) : null);
  const { data, isPending } = useQuery({
    queryKey: timeOffKeys.calendar(slug, month ?? ""),
    queryFn: () => fetchJson<TimeOffCalendarDTO>(timeOffUrls.calendar(slug, month!)),
    enabled: month !== null,
  });
  if (!month) return <Skeleton className="h-64 w-full" />;
  const days = data?.days ?? [];
  const lead = days.length ? (weekdayOfKey(days[0]!.dateKey) - viewer.weekStart + 7) % 7 : 0;
  const order = Array.from({ length: 7 }, (_, i) => WEEKDAYS[(viewer.weekStart + i) % 7]!);
  const busy = days.filter((d) => d.away.length > 0 || d.holidays.length > 0);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous month"
          onClick={() => setPicked(shiftMonth(month, -1))}
        >
          <ChevronLeftIcon />
        </Button>
        <h2 className="min-w-40 text-center font-semibold">{monthLabel(month)}</h2>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next month"
          onClick={() => setPicked(shiftMonth(month, 1))}
        >
          <ChevronRightIcon />
        </Button>
      </div>
      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div
            role="grid"
            aria-label={`Time off in ${monthLabel(month)}`}
            className="hidden grid-cols-7 overflow-hidden rounded-md border sm:grid"
          >
            {order.map((d) => (
              <div key={d} className="bg-muted/40 border-b px-2 py-1 text-xs font-medium">
                {d}
              </div>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <div key={`lead-${i}`} className="border-b border-r" />
            ))}
            {days.map((d) => (
              <div
                key={d.dateKey}
                role="gridcell"
                aria-label={d.dateKey}
                className="min-h-24 space-y-1 border-b border-r p-1.5 text-xs"
              >
                <div className="text-muted-foreground font-medium">
                  {Number(d.dateKey.slice(8))}
                </div>
                {d.holidays.map((h) => (
                  <div key={h} className="bg-accent text-accent-foreground truncate rounded px-1">
                    {h}
                  </div>
                ))}
                {d.away.map((a) => (
                  <div
                    key={`${a.userId}-${a.policyName}`}
                    className={
                      a.status === "PENDING"
                        ? "text-muted-foreground truncate rounded border border-dashed px-1"
                        : "bg-primary/10 truncate rounded px-1"
                    }
                    title={`${a.userName}: ${a.policyName}${a.halfDay ? " (half day)" : ""}${a.status === "PENDING" ? ", pending" : ""}`}
                  >
                    {a.userName}
                    {a.halfDay ? " ½" : ""}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <ul
            aria-label={`Days with time off in ${monthLabel(month)}`}
            className="space-y-2 sm:hidden"
          >
            {busy.length === 0 ? (
              <li className="text-muted-foreground text-sm">Nobody is away this month.</li>
            ) : (
              busy.map((d) => (
                <li key={d.dateKey} className="rounded-md border p-2 text-sm">
                  <div className="font-medium">{d.dateKey}</div>
                  {d.holidays.map((h) => (
                    <div key={h}>Holiday: {h}</div>
                  ))}
                  {d.away.map((a) => (
                    <div key={`${a.userId}-${a.policyName}`}>
                      {a.userName}: {a.policyName}
                      {a.halfDay ? " (half day)" : ""}
                      {a.status === "PENDING" ? " (pending)" : ""}
                    </div>
                  ))}
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </div>
  );
}
