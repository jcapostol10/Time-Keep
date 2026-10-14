"use client";

import {
  formatDuration,
  formatTimeOfDay,
  localDateKey,
  parseDuration,
  parseTimeOfDay,
  withDate,
  withDuration,
  withEndTime,
  withStartTime,
} from "@timekeep/core";
import { Badge } from "@timekeep/ui/components/badge";
import { Button } from "@timekeep/ui/components/button";
import { Checkbox } from "@timekeep/ui/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
import { Input } from "@timekeep/ui/components/input";
import { cn } from "@timekeep/ui/lib/utils";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  DollarSignIcon,
  EllipsisVerticalIcon,
  PlayIcon,
  TagIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import type { TimeEntryDTO } from "@/lib/tracker-types";

import { BillableToggle } from "./billable-toggle";
import { CommitInput } from "./manual-entry-fields";
import { ColorDot, ProjectPicker } from "./project-picker";
import { TagPicker } from "./tag-picker";
import { useTracker } from "./tracker-provider";
import { useEntryMutations } from "./use-entry-mutations";

const ROW =
  "flex flex-wrap items-center gap-x-1 gap-y-1 px-3 py-2 md:flex-nowrap hover:bg-muted/40";

function entryName(entry: TimeEntryDTO) {
  return entry.description || "(no description)";
}

function TimeRange({ start, end, tz }: { start: string; end: string; tz: string }) {
  const { viewer } = useTracker();
  const nextDay = localDateKey(new Date(end), tz) !== localDateKey(new Date(start), tz);
  return (
    <span className="text-muted-foreground text-sm tabular-nums">
      {formatTimeOfDay(new Date(start), tz, viewer.timeFormat)} –{" "}
      {formatTimeOfDay(new Date(end), tz, viewer.timeFormat)}
      {nextDay ? <sup className="ml-0.5">+1</sup> : null}
    </span>
  );
}

function RowActions({ entry }: { entry: TimeEntryDTO }) {
  const { duplicate, remove } = useEntryMutations();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="More actions">
          <EllipsisVerticalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void duplicate(entry.id)}>
          <CopyIcon /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => void remove([entry.id])}>
          <Trash2Icon /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ContinueButton({ entry }: { entry: TimeEntryDTO }) {
  const { continueEntry, pending } = useTracker();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Continue "${entryName(entry)}"`}
      disabled={pending}
      onClick={() => void continueEntry(entry.id)}
    >
      <PlayIcon />
    </Button>
  );
}

/** One stopped entry; every field saves on blur with optimistic UI. */
export function EntryRow({
  entry,
  selected,
  onSelectedChange,
  nested = false,
}: {
  entry: TimeEntryDTO;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  nested?: boolean;
}) {
  const { slug, viewer } = useTracker();
  const { update } = useEntryMutations();
  const tz = viewer.timezone;
  const end = entry.end ?? entry.start;
  const times = { start: new Date(entry.start), end: new Date(end) };
  const crossesMidnight = localDateKey(times.end, tz) !== localDateKey(times.start, tz);

  function save(patch: Parameters<typeof update>[1]) {
    void update(entry, patch);
  }

  function editTime(which: "start" | "end", text: string) {
    const time = parseTimeOfDay(text);
    if (!time) {
      toast.error("Enter a time like 9:30 or 2pm");
      return;
    }
    const next = which === "start" ? withStartTime(times, time, tz) : withEndTime(times, time, tz);
    save({ start: next.start.toISOString(), end: next.end.toISOString() });
  }

  function editDuration(text: string) {
    const seconds = parseDuration(text);
    if (!seconds) {
      toast.error("Enter a duration like 1:30, 1.5 or 90m");
      return;
    }
    save({ end: withDuration(times, seconds).end.toISOString() });
  }

  return (
    <div
      role="group"
      aria-label={`Entry ${entryName(entry)}`}
      className={cn(ROW, nested && "bg-muted/20 pl-8")}
    >
      <Checkbox
        aria-label={`Select ${entryName(entry)}`}
        checked={selected}
        onCheckedChange={(v) => onSelectedChange(v === true)}
        className="mr-1"
      />
      <CommitInput
        label="Description"
        value={entry.description}
        placeholder="Add description"
        onCommit={(description) => save({ description })}
        className="hover:border-input min-w-0 flex-1 basis-[calc(100%-2rem)] border-transparent text-left shadow-none md:basis-auto"
      />
      <ProjectPicker
        slug={slug}
        value={entry.projectId}
        compact
        onChange={(projectId) => save({ projectId })}
      />
      <TagPicker slug={slug} value={entry.tagIds} onChange={(tagIds) => save({ tagIds })} />
      <BillableToggle value={entry.billable} onChange={(billable) => save({ billable })} />
      <div className="ml-auto flex flex-wrap items-center justify-end gap-0.5 md:shrink-0 md:flex-nowrap">
        <CommitInput
          label="Start time"
          value={formatTimeOfDay(times.start, tz, viewer.timeFormat)}
          onCommit={(t) => editTime("start", t)}
          className="hover:border-input w-[5.25rem] shrink-0 border-transparent shadow-none"
        />
        <span className="text-muted-foreground" aria-hidden>
          –
        </span>
        <CommitInput
          label="End time"
          value={formatTimeOfDay(times.end, tz, viewer.timeFormat)}
          onCommit={(t) => editTime("end", t)}
          className="hover:border-input w-[5.25rem] shrink-0 border-transparent shadow-none"
        />
        <sup
          className={cn("text-muted-foreground w-4", !crossesMidnight && "invisible")}
          title="Ends the next day"
        >
          +1
        </sup>
        <Input
          type="date"
          aria-label="Date"
          defaultValue={localDateKey(times.start, tz)}
          key={entry.start}
          onBlur={(e) => {
            const value = e.currentTarget.value;
            if (value && value !== localDateKey(times.start, tz)) {
              const next = withDate(times, value, tz);
              save({ start: next.start.toISOString(), end: next.end.toISOString() });
            }
          }}
          className="hover:border-input h-8 w-[9rem] shrink-0 border-transparent px-2 shadow-none"
        />
        <CommitInput
          label="Duration"
          value={formatDuration(entry.durationSeconds ?? 0, viewer.durationFormat)}
          onCommit={editDuration}
          className="hover:border-input w-[6rem] shrink-0 border-transparent font-semibold shadow-none"
        />
        <ContinueButton entry={entry} />
        <RowActions entry={entry} />
      </div>
    </div>
  );
}

/** Consecutive entries with identical details, collapsed behind a count. */
export function EntryGroupRow({
  entries,
  totalSeconds,
  expanded,
  onExpandedChange,
  selectedIds,
  onSelect,
}: {
  entries: TimeEntryDTO[];
  totalSeconds: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  selectedIds: ReadonlySet<string>;
  onSelect: (ids: string[], selected: boolean) => void;
}) {
  const { viewer } = useTracker();
  const first = entries[0];
  if (!first) return null;
  const tz = viewer.timezone;
  const ids = entries.map((e) => e.id);
  const selectedCount = ids.filter((id) => selectedIds.has(id)).length;
  const earliest = entries.reduce((a, e) => (e.start < a ? e.start : a), first.start);
  const latest = entries.reduce(
    (a, e) => ((e.end ?? e.start) > a ? (e.end ?? e.start) : a),
    first.end ?? first.start,
  );

  return (
    <div>
      <div role="group" aria-label={`Group ${entryName(first)}`} className={ROW}>
        <Checkbox
          aria-label={`Select all ${entries.length} "${entryName(first)}" entries`}
          checked={
            selectedCount === 0 ? false : selectedCount === ids.length ? true : "indeterminate"
          }
          onCheckedChange={(v) => onSelect(ids, v === true)}
          className="mr-1"
        />
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-label={`${entries.length} entries`}
          onClick={() => onExpandedChange(!expanded)}
          className="px-1.5"
        >
          {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          <Badge variant="secondary" className="tabular-nums">
            {entries.length}
          </Badge>
        </Button>
        <span className="min-w-0 flex-1 basis-[calc(100%-6rem)] truncate px-2 text-sm md:basis-auto">
          {first.description || <span className="text-muted-foreground">(no description)</span>}
        </span>
        {first.project ? (
          <span
            className="flex items-center gap-1.5 px-2 text-sm"
            style={{ color: first.project.color }}
          >
            <ColorDot color={first.project.color} />
            {first.project.name}
          </span>
        ) : null}
        {first.tags.length > 0 ? (
          <span className="text-muted-foreground flex items-center gap-1 px-2 text-sm">
            <TagIcon className="size-3.5" />
            {first.tags.map((t) => t.name).join(", ")}
          </span>
        ) : null}
        {first.billable ? (
          <DollarSignIcon className="text-primary size-4" aria-label="Billable" />
        ) : null}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-0.5 md:shrink-0 md:flex-nowrap">
          <span className="px-2">
            <TimeRange start={earliest} end={latest} tz={tz} />
          </span>
          <span className="w-[6rem] text-center text-sm font-semibold tabular-nums">
            {formatDuration(totalSeconds, viewer.durationFormat)}
          </span>
          <ContinueButton entry={first} />
          <span className="size-8" aria-hidden />
        </div>
      </div>
      {expanded
        ? entries.map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              nested
              selected={selectedIds.has(e.id)}
              onSelectedChange={(v) => onSelect([e.id], v)}
            />
          ))
        : null}
    </div>
  );
}
