"use client";

import {
  addDaysInZone,
  buildTimesheet,
  formatDuration,
  formatWeekRange,
  localDateKey,
  rowKeyString,
  type TimesheetRowKey,
} from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import { CopyIcon, PlusIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { PeriodNav } from "@/components/period-nav";
import { useHydrated } from "@/hooks/use-hydrated";

import { useIsSaving } from "../tracker/saving-store";
import { useTracker } from "../tracker/tracker-provider";
import { PersonPicker } from "../tracker/person-picker";
import { useTarget } from "../tracker/target-context";
import { useTrackerOptions } from "../tracker/use-tracker-cache";
import { AddRowDialog } from "./add-row-dialog";
import { CopyLastWeekDialog } from "./copy-last-week-dialog";
import { buildNameLookup, compareRows, rowLabel, toTimesheetEntries } from "./model";
import { TemplatesMenu } from "./templates-menu";
import { TimesheetGrid } from "./timesheet-grid";
import { useRangeEntries } from "./use-timesheet";

/** The weekly grid page: week navigation, rows the user added this visit, and the toolbar. */
export function TimesheetPageClient({ from, to }: { from: string; to: string }) {
  const { slug, viewer, rules } = useTracker();
  const target = useTarget();
  const targetKey = target?.userId ?? "me";
  const tz = viewer.timezone;
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useHydrated();
  const saving = useIsSaving();
  const weekStart = useMemo(() => new Date(from), [from]);
  const weekKey = localDateKey(weekStart, tz);

  const { data: entries = [] } = useRangeEntries(slug, from, to, true, targetKey);
  const { data: options } = useTrackerOptions(slug, targetKey);
  // Rows added this visit, per week; they vanish on a full reload (templates persist).
  const [extraRowsByWeek, setExtraRowsByWeek] = useState<Record<string, TimesheetRowKey[]>>({});
  const extraRows = useMemo(() => extraRowsByWeek[weekKey] ?? [], [extraRowsByWeek, weekKey]);
  const [adding, setAdding] = useState(false);
  const [copying, setCopying] = useState(false);

  const names = useMemo(
    () => buildNameLookup(entries, options?.projects ?? []),
    [entries, options],
  );
  const sheet = useMemo(
    () => buildTimesheet({ entries: toTimesheetEntries(entries), weekStart, tz, extraRows }),
    [entries, weekStart, tz, extraRows],
  );
  const rows = useMemo(() => [...sheet.rows].sort(compareRows(names)), [sheet.rows, names]);

  function addRows(keys: TimesheetRowKey[]) {
    setExtraRowsByWeek((prev) => {
      const present = new Set([...(prev[weekKey] ?? []), ...sheet.rows].map(rowKeyString));
      const fresh = keys.filter((k) => !present.has(rowKeyString(k)));
      return fresh.length ? { ...prev, [weekKey]: [...(prev[weekKey] ?? []), ...fresh] } : prev;
    });
  }

  /** A row whose last entry is being cleared stays for the visit, like an added one. */
  function keepRow(key: TimesheetRowKey) {
    setExtraRowsByWeek((prev) => {
      const current = prev[weekKey] ?? [];
      if (current.some((k) => rowKeyString(k) === rowKeyString(key))) return prev;
      return { ...prev, [weekKey]: [...current, key] };
    });
  }

  function goToWeek(anchor: Date | null) {
    router.push(anchor ? `${pathname}?week=${localDateKey(anchor, tz)}` : pathname);
  }

  const today = hydrated ? localDateKey(new Date(), tz) : null;

  return (
    <div data-saving={saving} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodNav
          label={formatWeekRange(weekStart, tz)}
          previousLabel="Previous week"
          nextLabel="Next week"
          onPrevious={() => goToWeek(addDaysInZone(weekStart, -7, tz))}
          onNext={() => goToWeek(addDaysInZone(weekStart, 7, tz))}
          onToday={() => goToWeek(null)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <PersonPicker />
          <Button
            variant="outline"
            size="sm"
            disabled={!rules.canWriteTimes}
            onClick={() => setAdding(true)}
          >
            <PlusIcon /> Add new row
          </Button>
          {target ? null : (
            <>
          <Button
            variant="outline"
            size="sm"
            disabled={!rules.canWriteTimes}
            onClick={() => setCopying(true)}
          >
            <CopyIcon /> Copy last week
          </Button>
          <TemplatesMenu
            slug={slug}
            currentRows={rows.map((r) => ({
              projectId: r.projectId,
              taskId: r.taskId,
              description: r.description,
            }))}
            onApply={addRows}
          />
            </>
          )}
          <span className="text-muted-foreground ml-2 text-sm">
            Week total{" "}
            <span data-testid="grand-total" className="text-foreground font-semibold tabular-nums">
              {formatDuration(sheet.totalSeconds, viewer.durationFormat)}
            </span>
          </span>
        </div>
      </div>

      <TimesheetGrid
        sheet={{ ...sheet, rows }}
        entries={entries}
        names={names}
        weekStart={weekStart}
        today={today}
        hydrated={hydrated}
        labelOf={(row) => rowLabel(row, names)}
        onKeepRow={keepRow}
      />

      {adding ? (
        <AddRowDialog
          slug={slug}
          open
          onOpenChange={(open) => !open && setAdding(false)}
          onAdd={(key) => {
            addRows([key]);
            setAdding(false);
          }}
        />
      ) : null}
      {copying ? (
        <CopyLastWeekDialog
          slug={slug}
          weekStart={weekStart}
          tz={tz}
          open
          onOpenChange={(open) => !open && setCopying(false)}
          onRows={addRows}
        />
      ) : null}
    </div>
  );
}
