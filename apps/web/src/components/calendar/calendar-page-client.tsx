"use client";

import {
  addDaysInZone,
  createdRange,
  formatWeekRange,
  localDateKey,
  movedRange,
  resizedRange,
  zonedDateTimeToInstant,
} from "@timekeep/core";
import { cn } from "@timekeep/ui/lib/utils";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { PeriodNav } from "@/components/period-nav";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { TimeEntryDTO } from "@/lib/tracker-types";

import { useRangeEntries } from "../timesheet/use-timesheet";
import { useIsSaving } from "../tracker/saving-store";
import { useTracker } from "../tracker/tracker-provider";
import { useEntryWrites } from "../tracker/use-entry-writes";
import { CalendarGrid } from "./calendar-grid";
import { EntryDialog, type EntryDialogMode } from "./entry-dialog";

export type CalendarView = "day" | "week";

/** Day or week view with navigation; drags become entry writes here. */
export function CalendarPageClient({
  from,
  to,
  dateKey,
  view: viewParam,
}: {
  from: string;
  to: string;
  dateKey: string;
  view: CalendarView | null;
}) {
  const { slug, viewer, rules } = useTracker();
  const tz = viewer.timezone;
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useHydrated();
  const saving = useIsSaving();
  const wide = useMediaQuery("(min-width: 768px)");
  const view: CalendarView = viewParam ?? (wide ? "week" : "day");
  const weekStart = useMemo(() => new Date(from), [from]);
  const dayStart = useMemo(
    () => zonedDateTimeToInstant({ date: dateKey, hours: 0, minutes: 0 }, tz),
    [dateKey, tz],
  );
  const days = useMemo(
    () =>
      view === "week"
        ? Array.from({ length: 7 }, (_, i) => localDateKey(addDaysInZone(weekStart, i, tz), tz))
        : [dateKey],
    [view, weekStart, dateKey, tz],
  );

  const { data: entries = [] } = useRangeEntries(slug, from, to);
  const writes = useEntryWrites();
  const [dialog, setDialog] = useState<EntryDialogMode | null>(null);

  function go(date: Date | null, nextView: CalendarView = view) {
    const params = new URLSearchParams({ view: nextView });
    if (date) params.set("date", localDateKey(date, tz));
    router.push(`${pathname}?${params.toString()}`);
  }

  const step = view === "week" ? 7 : 1;
  const anchor = view === "week" ? weekStart : dayStart;
  const label =
    view === "week"
      ? formatWeekRange(weekStart, tz)
      : new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          weekday: "long",
          month: "short",
          day: "numeric",
        }).format(dayStart);
  const today = hydrated ? localDateKey(new Date(), tz) : null;

  return (
    <div data-saving={saving} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodNav
          label={label}
          previousLabel="Previous"
          nextLabel="Next"
          onPrevious={() => go(addDaysInZone(anchor, -step, tz))}
          onNext={() => go(addDaysInZone(anchor, step, tz))}
          onToday={() => go(null)}
        />
        <div role="radiogroup" aria-label="View" className="bg-muted flex rounded-md p-0.5 text-sm">
          {(["day", "week"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              onClick={() => go(viewParam || dateKey !== today ? dayStart : null, v)}
              className={cn(
                "rounded px-3 py-1 capitalize",
                view === v ? "bg-background shadow-xs font-medium" : "text-muted-foreground",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <CalendarGrid
        days={days}
        entries={entries}
        today={today}
        hydrated={hydrated}
        onCreate={(dayKey, a, b) => {
          if (!rules.canWriteTimes) return;
          const range = createdRange(dayKey, a, b, tz);
          setDialog({ kind: "create", dayKey, start: range.start, end: range.end });
        }}
        onMove={(entry, dayKey, startMinutes) => {
          if (!entry.end || !rules.canWriteTimes) return; // the running timer is not dragged
          const range = movedRange(
            { start: entry.start, end: entry.end },
            dayKey,
            startMinutes,
            tz,
          );
          void writes.update(entry.id, {
            start: range.start.toISOString(),
            end: range.end.toISOString(),
          });
        }}
        onResize={(entry, edge, dayKey, minutes) => {
          if (!entry.end || !rules.canWriteTimes) return;
          const range = resizedRange(
            { start: entry.start, end: entry.end },
            edge,
            dayKey,
            minutes,
            tz,
          );
          void writes.update(entry.id, {
            start: range.start.toISOString(),
            end: range.end.toISOString(),
          });
        }}
        onEdit={(entry: TimeEntryDTO) => setDialog({ kind: "edit", entry })}
      />

      {dialog ? (
        <EntryDialog
          key={dialog.kind === "edit" ? dialog.entry.id : "new"}
          mode={dialog}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
