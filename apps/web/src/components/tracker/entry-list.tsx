"use client";

import {
  collapseConsecutive,
  formatDayHeading,
  formatDuration,
  formatWeekRange,
  groupByDay,
  localDateKey,
  sumDuration,
  weekBounds,
} from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import { Checkbox } from "@timekeep/ui/components/checkbox";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2Icon, TimerIcon, Trash2Icon, XIcon, PencilIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { fetchJson } from "@/lib/fetch-json";
import type { EntriesPage, TimeEntryDTO } from "@/lib/tracker-types";

import { BulkEditDialog } from "./bulk-edit-dialog";
import { EntryGroupRow, EntryRow } from "./entry-row";
import { trackerKeys, trackerUrls } from "./query-keys";
import { useTargetKey } from "./target-context";
import { useTracker, useTrackerClock } from "./tracker-provider";
import { useEntryMutations } from "./use-entry-mutations";

function useSelection() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const set = useCallback((ids: string[], value: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (value) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Set()), []);
  return { selected, set, clear };
}

/** Live seconds the running timer adds to a total, when it started inside `contains`. */
function useRunningContribution(contains: (start: string) => boolean): number {
  const { running } = useTracker();
  const { elapsedSeconds } = useTrackerClock();
  return running && contains(running.start) ? elapsedSeconds : 0;
}

/** Total of a block of entries, plus the running timer's live seconds when it started in [from, to). */
function BlockTotal({
  entries,
  from,
  to,
  label,
}: {
  entries: TimeEntryDTO[];
  from: string;
  to: string | null;
  label: string;
}) {
  const { viewer } = useTracker();
  const live = useRunningContribution((start) => {
    const t = Date.parse(start);
    return t >= Date.parse(from) && (to === null || t < Date.parse(to));
  });
  return (
    <span className="text-sm">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-semibold tabular-nums">
        {formatDuration(sumDuration(entries) + live, viewer.durationFormat)}
      </span>
    </span>
  );
}

interface Block {
  key: string;
  label: string;
  totalLabel: string;
  entries: TimeEntryDTO[];
  from: string;
  to: string | null;
}

/** Each page is one week; the first page can also hold entries dated after it ("Upcoming"). */
function toBlocks(
  pages: EntriesPage[],
  tz: string,
  weekStartsOn: Parameters<typeof weekBounds>[2],
): Block[] {
  const blocks: Block[] = [];
  for (const page of pages) {
    const end = Date.parse(page.weekEnd);
    const upcoming = page.entries.filter((e) => Date.parse(e.start) >= end);
    const inWeek = page.entries.filter((e) => Date.parse(e.start) < end);
    if (upcoming.length > 0) {
      blocks.push({
        key: `upcoming-${page.weekEnd}`,
        label: "Upcoming",
        totalLabel: "Total",
        entries: upcoming,
        from: page.weekEnd,
        to: null,
      });
    }
    if (inWeek.length > 0) {
      blocks.push({
        key: page.weekStart,
        label: weekLabel(page, tz, weekStartsOn),
        totalLabel: "Week total",
        entries: inWeek,
        from: page.weekStart,
        to: page.weekEnd,
      });
    }
  }
  return blocks;
}

function DayTotal({ dateKey, seconds }: { dateKey: string; seconds: number }) {
  const { viewer } = useTracker();
  const live = useRunningContribution(
    (start) => localDateKey(new Date(start), viewer.timezone) === dateKey,
  );
  return (
    <span className="text-sm">
      <span className="text-muted-foreground">Total: </span>
      <span className="font-semibold tabular-nums">
        {formatDuration(seconds + live, viewer.durationFormat)}
      </span>
    </span>
  );
}

function weekLabel(page: EntriesPage, tz: string, weekStartsOn: Parameters<typeof weekBounds>[2]) {
  const current = weekBounds(new Date(), tz, weekStartsOn).weekStart.toISOString();
  const previous = weekBounds(
    new Date(Date.parse(current) - 1),
    tz,
    weekStartsOn,
  ).weekStart.toISOString();
  if (page.weekStart === current) return "This week";
  if (page.weekStart === previous) return "Last week";
  return formatWeekRange(new Date(page.weekStart), tz);
}

function DaySection({
  dateKey,
  todayKey,
  entries,
  totalSeconds,
  selection,
  expandedGroups,
  onToggleGroup,
}: {
  dateKey: string;
  todayKey: string;
  entries: TimeEntryDTO[];
  totalSeconds: number;
  selection: ReturnType<typeof useSelection>;
  expandedGroups: ReadonlySet<string>;
  onToggleGroup: (key: string, expanded: boolean) => void;
}) {
  const heading = formatDayHeading(dateKey, todayKey);
  const ids = entries.map((e) => e.id);
  const count = ids.filter((id) => selection.selected.has(id)).length;
  const rows = collapseConsecutive(entries);

  return (
    <section aria-label={heading} className="bg-card overflow-hidden rounded-lg border">
      <header className="bg-muted/50 flex items-center gap-3 border-b px-3 py-2">
        <Checkbox
          aria-label={`Select all entries for ${heading}`}
          checked={count === 0 ? false : count === ids.length ? true : "indeterminate"}
          onCheckedChange={(v) => selection.set(ids, v === true)}
        />
        <h3 className="text-sm font-semibold">{heading}</h3>
        <span className="ml-auto">
          <DayTotal dateKey={dateKey} seconds={totalSeconds} />
        </span>
      </header>
      <div className="divide-y">
        {rows.map((row) => {
          if (row.kind === "single") {
            return (
              <EntryRow
                key={row.entry.id}
                entry={row.entry}
                selected={selection.selected.has(row.entry.id)}
                onSelectedChange={(v) => selection.set([row.entry.id], v)}
              />
            );
          }
          const groupKey = `${dateKey}:${row.entries[0]?.id ?? row.key}`;
          return (
            <EntryGroupRow
              key={groupKey}
              entries={row.entries}
              totalSeconds={row.totalSeconds}
              expanded={expandedGroups.has(groupKey)}
              onExpandedChange={(v) => onToggleGroup(groupKey, v)}
              selectedIds={selection.selected}
              onSelect={selection.set}
            />
          );
        })}
      </div>
    </section>
  );
}

export function EntryList() {
  const { slug, viewer, running } = useTracker();
  const { remove, bulkUpdate } = useEntryMutations();
  const selection = useSelection();
  const [editing, setEditing] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());
  const sentinel = useRef<HTMLDivElement | null>(null);

  const target = useTargetKey();
  const query = useInfiniteQuery({
    queryKey: trackerKeys.entries(slug, target),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchJson<EntriesPage>(trackerUrls.entries(slug, pageParam, target)),
    getNextPageParam: (last) => last.nextCursor,
  });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (items) => {
        if (items.some((i) => i.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const toggleGroup = useCallback((key: string, expanded: boolean) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (expanded) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const pages = query.data?.pages ?? [];
  const hasEntries = pages.some((p) => p.entries.length > 0);
  const tz = viewer.timezone;
  const todayKey = localDateKey(new Date(), tz);
  const selectedIds = [...selection.selected];

  if (query.isPending) {
    return (
      <div className="text-muted-foreground flex justify-center py-12">
        <Loader2Icon className="animate-spin" aria-label="Loading entries" />
      </div>
    );
  }

  if (!hasEntries && !hasNextPage) {
    return running ? null : (
      <EmptyState
        icon={TimerIcon}
        title="No time entries yet"
        description="Start the timer or switch to manual mode to add your first entry."
      />
    );
  }

  return (
    <div className="space-y-8 pb-20">
      {toBlocks(pages, tz, viewer.weekStart).map((block) => (
        <div key={block.key} className="space-y-3">
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h2 className="text-muted-foreground text-sm font-medium">{block.label}</h2>
            <BlockTotal
              entries={block.entries}
              from={block.from}
              to={block.to}
              label={block.totalLabel}
            />
          </div>
          {groupByDay(block.entries, tz).map((day) => (
            <DaySection
              key={day.dateKey}
              dateKey={day.dateKey}
              todayKey={todayKey}
              entries={day.entries}
              totalSeconds={day.totalSeconds}
              selection={selection}
              expandedGroups={expandedGroups}
              onToggleGroup={toggleGroup}
            />
          ))}
        </div>
      ))}

      <div ref={sentinel} className="flex justify-center">
        {hasNextPage ? (
          <Button
            variant="outline"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage ? <Loader2Icon className="animate-spin" /> : null}
            Load more
          </Button>
        ) : null}
      </div>

      {selectedIds.length > 0 ? (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="bg-popover fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-md items-center gap-2 rounded-lg border p-2 pl-4 shadow-lg"
        >
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setEditing(true)}>
            <PencilIcon /> Edit
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={async () => {
              if (await remove(selectedIds)) selection.clear();
            }}
          >
            <Trash2Icon /> Delete
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Clear selection"
            onClick={selection.clear}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
      <BulkEditDialog
        count={selectedIds.length}
        open={editing}
        onOpenChange={setEditing}
        onApply={async (patch) => {
          const ok = await bulkUpdate(selectedIds, patch);
          if (ok) selection.clear();
          return ok;
        }}
      />
    </div>
  );
}
