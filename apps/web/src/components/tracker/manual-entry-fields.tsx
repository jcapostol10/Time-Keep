"use client";

import {
  formatDuration,
  formatTimeOfDay,
  localDateKey,
  localTimeParts,
  manualRange,
  parseDuration,
  parseTimeOfDay,
  type TimeOfDay,
  zonedDateTimeToInstant,
} from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import { Input } from "@timekeep/ui/components/input";
import { cn } from "@timekeep/ui/lib/utils";
import { useState } from "react";
import { toast } from "sonner";

import type { EntryDraft } from "@/lib/tracker-types";

import { useTracker } from "./tracker-provider";

/**
 * Manual mode. The canonical state is date + start time + duration; the end
 * time is derived. Editing the end time recomputes the duration, rolling to
 * the next day when the end is not after the start.
 */
interface ManualState {
  date: string;
  start: TimeOfDay;
  durationSeconds: number;
}

function initialState(tz: string): ManualState {
  const now = new Date();
  const { hours, minutes } = localTimeParts(now, tz);
  return { date: localDateKey(now, tz), start: { hours, minutes }, durationSeconds: 0 };
}

export function ManualEntryFields({
  draft,
  onSubmit,
}: {
  draft: EntryDraft;
  onSubmit: (input: EntryDraft & { start: string; end: string }) => Promise<boolean>;
}) {
  const { viewer } = useTracker();
  const tz = viewer.timezone;
  const [state, setState] = useState<ManualState>(() => initialState(tz));
  const [submitting, setSubmitting] = useState(false);

  const startInstant = zonedDateTimeToInstant({ date: state.date, ...state.start }, tz);
  const endInstant = new Date(startInstant.getTime() + state.durationSeconds * 1000);
  const startText = formatTimeOfDay(startInstant, tz, viewer.timeFormat);
  const endText = formatTimeOfDay(endInstant, tz, viewer.timeFormat);
  const durationText = formatDuration(state.durationSeconds, viewer.durationFormat);

  function commitStart(text: string) {
    const parsed = parseTimeOfDay(text);
    if (!parsed) return text.trim() ? toast.error("Enter a time like 9:30 or 2pm") : undefined;
    setState((s) => ({ ...s, start: parsed }));
  }

  function commitEnd(text: string) {
    const parsed = parseTimeOfDay(text);
    if (!parsed) return text.trim() ? toast.error("Enter a time like 5:30 or 5pm") : undefined;
    setState((s) => ({
      ...s,
      durationSeconds: manualRange({ date: s.date, start: s.start, end: parsed }, tz).durationSeconds,
    }));
  }

  function commitDuration(text: string) {
    const seconds = parseDuration(text);
    if (seconds === null) {
      if (text.trim()) toast.error("Enter a duration like 1:30, 1.5 or 90m");
      return;
    }
    setState((s) => ({ ...s, durationSeconds: seconds }));
  }

  async function submit() {
    setSubmitting(true);
    const ok = await onSubmit({
      ...draft,
      start: startInstant.toISOString(),
      end: endInstant.toISOString(),
    });
    setSubmitting(false);
    if (ok) setState((s) => ({ ...s, durationSeconds: 0 }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <CommitInput
          label="Start time"
          value={startText}
          onCommit={commitStart}
          className="w-[5.5rem]"
        />
        <span className="text-muted-foreground" aria-hidden>
          –
        </span>
        <CommitInput
          label="End time"
          value={endText}
          onCommit={commitEnd}
          className="w-[5.5rem]"
        />
      </div>
      <Input
        type="date"
        aria-label="Date"
        value={state.date}
        onChange={(e) => e.target.value && setState((s) => ({ ...s, date: e.target.value }))}
        className="w-[9.5rem]"
      />
      <CommitInput
        label="Duration"
        value={durationText}
        onCommit={commitDuration}
        className="w-[6.5rem] font-medium tabular-nums"
      />
      <Button
        type="button"
        onClick={() => void submit()}
        disabled={submitting || state.durationSeconds <= 0}
      >
        Add
      </Button>
    </div>
  );
}

/**
 * Text input that shows `value` until focused, lets the user type freely, and
 * reports the typed text on blur or Enter. Escape reverts.
 */
export function CommitInput({
  label,
  value,
  onCommit,
  className,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (text: string) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Input
      aria-label={label}
      placeholder={placeholder}
      value={editing ?? value}
      disabled={disabled}
      autoComplete="off"
      className={cn("h-8 px-2 text-center tabular-nums", className)}
      onFocus={(e) => {
        setEditing(value);
        e.currentTarget.select();
      }}
      onChange={(e) => setEditing(e.target.value)}
      onBlur={() => {
        const text = editing;
        setEditing(null);
        if (text !== null && text !== value) onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setEditing(value);
        }
      }}
    />
  );
}
