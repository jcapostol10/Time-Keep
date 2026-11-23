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
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
import { Input } from "@timekeep/ui/components/input";
import { cn } from "@timekeep/ui/lib/utils";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CoffeeIcon,
  CopyIcon,
  DollarSignIcon,
  EllipsisVerticalIcon,
  PlayIcon,
  ScissorsIcon,
  LockIcon,
  StarIcon,
  TagIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { TimeEntryDTO } from "@/lib/tracker-types";

import { BillableToggle } from "./billable-toggle";
import { CommitInput } from "./manual-entry-fields";
import { ColorDot, ProjectPicker } from "./project-picker";
import { SplitDialog } from "./split-dialog";
import { TagPicker } from "./tag-picker";
import { useTarget } from "./target-context";
import { useFavorites } from "./use-favorites";
import { useCanWriteTimes, useTracker } from "./tracker-provider";
import { useEntryMutations } from "./use-entry-mutations";

/**
 * A row has no line of its own: 12px above and below, and a hairline only
 * between days. From 1400px every row keeps the same columns (description,
 * project, tags, billable, start–end, duration), whatever it holds, so the
 * eye can run down one of them; narrower, a row wraps onto a second line.
 */
const ROW =
  "group/row flex flex-wrap items-center gap-x-1 gap-y-1 px-3 py-3 min-[1400px]:flex-nowrap hover:bg-muted/40";
/** The columns' widths, shared by entry rows and group rows. */
const DETAILS = "flex min-w-0 items-center gap-1 min-[1400px]:w-[23rem] min-[1400px]:shrink-0";
const PROJECT = "min-w-0 min-[1400px]:w-52 min-[1400px]:shrink-0";
const TAGS = "min-w-0 min-[1400px]:w-32 min-[1400px]:shrink-0";
const BILLABLE = "flex size-8 shrink-0 items-center justify-center";
const TIMES =
  "ml-auto flex flex-wrap items-center justify-end gap-0.5 min-[1400px]:w-[32rem] min-[1400px]:shrink-0 min-[1400px]:flex-nowrap";
const DURATION = "w-[6rem] shrink-0 text-center text-sm font-semibold tabular-nums";
/**
 * Continue and the menu wait for the pointer or the keyboard, and for an open
 * menu. They hide only where a pointer can hover: everywhere else (touch) they
 * are always shown, so nothing invisible can be tapped.
 */
const ACTIONS =
  "flex items-center transition-opacity [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-focus-within/row:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-hover/row:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:has-[[data-state=open]]:opacity-100";

function entryName(entry: TimeEntryDTO) {
  return entry.description || "(no description)";
}

/** A group's first start and last end, in the columns an entry's two time fields have. */
function TimeRange({ start, end, tz }: { start: string; end: string; tz: string }) {
  const { viewer } = useTracker();
  const nextDay = localDateKey(new Date(end), tz) !== localDateKey(new Date(start), tz);
  const slot = "w-[5.25rem] shrink-0 text-center";
  return (
    <span className="text-muted-foreground flex items-center gap-0.5 text-sm tabular-nums">
      <span data-range-start className={slot}>
        {formatTimeOfDay(new Date(start), tz, viewer.timeFormat)}
      </span>
      <span aria-hidden>–</span>
      <span className={slot}>{formatTimeOfDay(new Date(end), tz, viewer.timeFormat)}</span>
      <sup className={cn("w-4", !nextDay && "invisible")}>+1</sup>
      {/* Where an entry's row has its date field. */}
      <span className="w-[9rem] shrink-0 max-[1399px]:hidden" aria-hidden />
    </span>
  );
}

function RowActions({ entry }: { entry: TimeEntryDTO }) {
  const { duplicate, remove, split } = useEntryMutations();
  const { pin } = useFavorites();
  const canWriteTimes = useCanWriteTimes();
  // Favourites are the viewer's own: not offered on someone else's entries.
  const ownEntries = useTarget() === null;
  const [splitting, setSplitting] = useState(false);
  // A locked period (or lock date) takes every write away; an invoice only the
  // ones that change the entry itself (a copy of it is a new, open entry).
  const changeLocked = Boolean(entry.lockedReason);
  const periodLocked = changeLocked && !entry.invoiceNumber;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="More actions">
            <EllipsisVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {entry.lockedReason ? (
            <DropdownMenuLabel className="text-muted-foreground max-w-56 text-xs font-normal">
              {entry.lockedReason}
            </DropdownMenuLabel>
          ) : null}
          <DropdownMenuItem disabled={periodLocked} onSelect={() => void duplicate(entry.id)}>
            <CopyIcon /> Duplicate
          </DropdownMenuItem>
          {ownEntries ? (
            <DropdownMenuItem
              disabled={entry.type === "break"}
              onSelect={() =>
                void pin({
                  description: entry.description,
                  projectId: entry.projectId,
                  taskId: entry.taskId,
                  tagIds: entry.tagIds,
                  billable: entry.billable,
                })
              }
            >
              <StarIcon /> Pin as favourite
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            disabled={!entry.end || !canWriteTimes || changeLocked}
            onSelect={() => setSplitting(true)}
          >
            <ScissorsIcon /> Split…
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={changeLocked}
            onSelect={() => void remove([entry.id])}
          >
            <Trash2Icon /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {splitting ? (
        <SplitDialog
          entry={entry}
          open
          onOpenChange={setSplitting}
          onSplit={(at) => split(entry, at)}
        />
      ) : null}
    </>
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
  const { slug, viewer, canCreate } = useTracker();
  const canWriteTimes = useCanWriteTimes();
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

  // A lock date or a submitted period (Phase 5a): the fields are read-only and say why.
  const locked = Boolean(entry.lockedReason);

  return (
    <div
      role="group"
      aria-label={`Entry ${entryName(entry)}`}
      title={entry.lockedReason ?? undefined}
      className={cn(ROW, nested && "bg-muted/20 pl-8")}
    >
      <Checkbox
        aria-label={`Select ${entryName(entry)}`}
        checked={selected}
        onCheckedChange={(v) => onSelectedChange(v === true)}
        className="mr-1"
      />
      {locked ? (
        <LockIcon
          className="text-muted-foreground size-4 shrink-0"
          role="img"
          aria-label={entry.lockedReason ?? "Locked"}
        />
      ) : null}
      <fieldset disabled={locked} className="contents">
        <CommitInput
          label="Description"
          value={entry.description}
          placeholder="Add description"
          onCommit={(description) => save({ description })}
          className="hover:border-input min-w-0 flex-1 basis-[calc(100%-2rem)] border-transparent text-left shadow-none min-[1400px]:basis-auto dark:bg-transparent"
        />
        <div className={DETAILS}>
          {entry.type === "break" ? (
            <Badge variant="secondary">
              <CoffeeIcon /> Break
            </Badge>
          ) : (
            <>
              <div className={PROJECT}>
                <ProjectPicker
                  slug={slug}
                  value={{ projectId: entry.projectId, taskId: entry.taskId }}
                  current={{ project: entry.project, task: entry.task }}
                  compact
                  canCreate={canCreate.project}
                  className="max-w-full"
                  onChange={(sel) => save({ projectId: sel.projectId, taskId: sel.taskId })}
                />
              </div>
              <div className={TAGS}>
                <TagPicker
                  slug={slug}
                  value={entry.tagIds}
                  current={entry.tags}
                  canCreate={canCreate.tag}
                  className="max-w-full"
                  onChange={(tagIds) => save({ tagIds })}
                />
              </div>
              <BillableToggle value={entry.billable} onChange={(billable) => save({ billable })} />
            </>
          )}
        </div>
      </fieldset>
      <div className={TIMES}>
        <fieldset disabled={locked} className="contents">
          <CommitInput
            label="Start time"
            value={formatTimeOfDay(times.start, tz, viewer.timeFormat)}
            onCommit={(t) => editTime("start", t)}
            disabled={!canWriteTimes}
            className="hover:border-input w-[5.25rem] shrink-0 border-transparent shadow-none dark:bg-transparent"
          />
          <span className="text-muted-foreground" aria-hidden>
            –
          </span>
          <CommitInput
            label="End time"
            value={formatTimeOfDay(times.end, tz, viewer.timeFormat)}
            onCommit={(t) => editTime("end", t)}
            disabled={!canWriteTimes}
            className="hover:border-input w-[5.25rem] shrink-0 border-transparent shadow-none dark:bg-transparent"
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
            disabled={!canWriteTimes}
            defaultValue={localDateKey(times.start, tz)}
            key={entry.start}
            onBlur={(e) => {
              const value = e.currentTarget.value;
              if (value && value !== localDateKey(times.start, tz)) {
                const next = withDate(times, value, tz);
                save({ start: next.start.toISOString(), end: next.end.toISOString() });
              }
            }}
            className="hover:border-input h-8 w-[9rem] shrink-0 border-transparent px-2 shadow-none dark:bg-transparent"
          />
          <CommitInput
            label="Duration"
            value={formatDuration(entry.durationSeconds ?? 0, viewer.durationFormat)}
            onCommit={editDuration}
            disabled={!canWriteTimes}
            className="hover:border-input w-[6rem] shrink-0 border-transparent font-semibold shadow-none dark:bg-transparent"
          />
        </fieldset>
        <div data-row-actions className={ACTIONS}>
          <ContinueButton entry={entry} />
          <RowActions entry={entry} />
        </div>
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
        <span className="min-w-0 flex-1 basis-[calc(100%-6rem)] truncate px-2 text-sm min-[1400px]:basis-auto">
          {first.description || <span className="text-muted-foreground">(no description)</span>}
        </span>
        {/* The same columns as an entry's row, read-only. */}
        <div className={DETAILS}>
          <span className={cn(PROJECT, "flex items-center gap-1.5 px-2.5 text-sm font-medium")}>
            {first.project ? (
              <>
                <ColorDot color={first.project.color} />
                <span className="truncate" style={{ color: first.project.color }}>
                  {first.project.name}
                </span>
              </>
            ) : null}
          </span>
          <span
            className={cn(TAGS, "text-muted-foreground flex items-center gap-1.5 px-2.5 text-sm")}
          >
            {first.tags.length > 0 ? (
              <>
                <TagIcon className="size-4 shrink-0" />
                <span className="truncate">{first.tags.map((t) => t.name).join(", ")}</span>
              </>
            ) : null}
          </span>
          <span className={BILLABLE}>
            {first.billable ? (
              <DollarSignIcon className="text-primary size-4" aria-label="Billable" />
            ) : null}
          </span>
        </div>
        <div className={TIMES}>
          <TimeRange start={earliest} end={latest} tz={tz} />
          <span data-group-total className={DURATION}>
            {formatDuration(totalSeconds, viewer.durationFormat)}
          </span>
          <div data-row-actions className={ACTIONS}>
            <ContinueButton entry={first} />
            <span className="size-8" aria-hidden />
          </div>
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
