"use client";

import {
  addDaysInZone,
  localDateKey,
  RANGE_PRESETS,
  type RangePreset,
  type ReportQuery,
  resolveReportRange,
  type ViewerPrefs,
  zonedDateTimeToInstant,
} from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
import { Input } from "@timekeep/ui/components/input";
import { CalendarIcon } from "lucide-react";

const LABELS: Record<RangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "this-week": "This week",
  "last-week": "Last week",
  "this-month": "This month",
  "last-month": "Last month",
  "this-year": "This year",
  "last-year": "Last year",
  custom: "Custom…",
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The range menu; a custom range shows two date inputs (inclusive local dates). */
export function DatePresetMenu({
  query,
  prefs,
  onChange,
}: {
  query: ReportQuery;
  prefs: ViewerPrefs;
  onChange: (patch: Partial<ReportQuery>) => void;
}) {
  const tz = prefs.timezone;
  const custom = query.preset === "custom";

  function pick(preset: RangePreset) {
    if (preset !== "custom") {
      onChange({ preset, from: undefined, to: undefined });
      return;
    }
    // Start the custom range from what is shown now.
    const current = resolveReportRange(query, prefs, new Date());
    onChange({ preset, from: current.from.toISOString(), to: current.to.toISOString() });
  }

  function setDate(which: "from" | "to", value: string) {
    if (!DATE_KEY.test(value)) return;
    const day = zonedDateTimeToInstant({ date: value, hours: 0, minutes: 0 }, tz);
    if (which === "from") {
      const to = query.to ? new Date(query.to) : addDaysInZone(day, 1, tz);
      onChange({
        from: day.toISOString(),
        to: (to > day ? to : addDaysInZone(day, 1, tz)).toISOString(),
      });
    } else {
      const to = addDaysInZone(day, 1, tz);
      const from = query.from ? new Date(query.from) : day;
      onChange({
        from: (from < to ? from : day).toISOString(),
        to: to.toISOString(),
      });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Range: ${LABELS[query.preset]}`}
          >
            <CalendarIcon className="text-muted-foreground size-3.5" />
            {LABELS[query.preset]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {RANGE_PRESETS.filter((p) => p !== "custom").map((preset) => (
            <DropdownMenuItem key={preset} onSelect={() => pick(preset)}>
              {LABELS[preset]}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => pick("custom")}>{LABELS.custom}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {custom ? (
        <>
          <Input
            type="date"
            aria-label="From"
            className="h-8 w-40"
            value={query.from ? localDateKey(new Date(query.from), tz) : ""}
            onChange={(e) => setDate("from", e.target.value)}
          />
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="date"
            aria-label="To"
            className="h-8 w-40"
            value={query.to ? localDateKey(addDaysInZone(new Date(query.to), -1, tz), tz) : ""}
            onChange={(e) => setDate("to", e.target.value)}
          />
        </>
      ) : null}
    </div>
  );
}
