"use client";

import { formatClock } from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import { cn } from "@timekeep/ui/lib/utils";
import { ListPlusIcon, Loader2Icon, PlayIcon, SquareIcon, TimerIcon, CoffeeIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useHydrated } from "@/hooks/use-hydrated";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { EMPTY_DRAFT, type EntryDraft, type RecentDescription } from "@/lib/tracker-types";

import { BillableToggle } from "./billable-toggle";
import { DescriptionInput } from "./description-input";
import { ManualEntryFields } from "./manual-entry-fields";
import { ProjectPicker } from "./project-picker";
import { TagPicker } from "./tag-picker";
import { TargetProvider } from "./target-context";
import { useCanWriteTimes, useTracker, useTrackerClock } from "./tracker-provider";
import { useEntryMutations } from "./use-entry-mutations";

type Mode = "timer" | "manual";

function detailsOf(s: RecentDescription): EntryDraft {
  return {
    description: s.description,
    projectId: s.projectId,
    taskId: s.taskId,
    tagIds: s.tagIds,
    billable: s.billable,
    type: "work",
  };
}

function LiveClock() {
  const { elapsedSeconds } = useTrackerClock();
  return (
    <span
      role="timer"
      aria-label="Elapsed time"
      className="min-w-[5.5rem] px-2 text-right text-lg font-semibold tabular-nums"
    >
      {formatClock(elapsedSeconds)}
    </span>
  );
}

/** Running entry's description: local text, saved on blur. Keyed by id + saved text. */
function RunningDescription({
  slug,
  saved,
  onSave,
  onPick,
  inputRef,
  invalid,
}: {
  slug: string;
  saved: string;
  onSave: (description: string) => void;
  onPick: (s: RecentDescription) => void;
  inputRef: (el: HTMLInputElement | null) => void;
  invalid?: boolean;
}) {
  const [text, setText] = useState(saved);
  return (
    <DescriptionInput
      slug={slug}
      value={text}
      onChange={setText}
      onPick={(s) => {
        setText(s.description);
        onPick(s);
      }}
      onCommit={(value) => {
        if (value.trim() !== saved) onSave(value);
      }}
      onEnter={() => {
        if (text.trim() !== saved) onSave(text);
      }}
      inputRef={inputRef}
      invalid={invalid}
      className="basis-full md:flex-1 md:basis-auto"
    />
  );
}

export function TimerBar({ autoFocus = false }: { autoFocus?: boolean }) {
  const tracker = useTracker();
  const { slug, running, draft, setDraft, settledDraft, pending, canCreate, rules, stopProblem } =
    tracker;
  const { createManual } = useEntryMutations();
  const [storedMode, setMode] = useLocalStorage<Mode>("timekeep:tracker-mode", "timer");
  // The shown person's rule: a manager under force timer still types time for their people.
  const canWriteTimes = useCanWriteTimes();
  // Force timer (decision 7): the timer is the only way to add time.
  const mode: Mode = running || !canWriteTimes ? "timer" : storedMode;

  const values: EntryDraft = running
    ? {
        description: running.description,
        projectId: running.projectId,
        taskId: running.taskId,
        tagIds: running.tagIds,
        billable: running.billable,
        type: running.type,
      }
    : draft;

  function change(patch: Partial<EntryDraft>) {
    if (running) void tracker.updateRunning(patch);
    else setDraft(patch);
  }

  const hydrated = useHydrated();
  const { focusDescription } = tracker;
  useEffect(() => {
    if (autoFocus) focusDescription();
  }, [autoFocus, focusDescription]);

  return (
    <TargetProvider target={null}>
    <section
      aria-label="Timer"
      data-hydrated={hydrated}
      className="bg-card shadow-xs flex flex-wrap items-center gap-1 rounded-lg border p-2 md:flex-nowrap"
    >
      {running ? (
        <RunningDescription
          key={`${running.id}:${running.description}`}
          slug={slug}
          saved={running.description}
          onSave={(description) => change({ description })}
          onPick={(s) => change(detailsOf(s))}
          inputRef={tracker.registerDescriptionInput}
          invalid={stopProblem?.field === "description"}
        />
      ) : (
        <DescriptionInput
          slug={slug}
          value={draft.description}
          onChange={(description) => setDraft({ description })}
          onPick={(s) => setDraft(detailsOf(s))}
          onEnter={() => {
            if (mode === "timer") void tracker.start();
          }}
          inputRef={tracker.registerDescriptionInput}
          className="basis-full md:flex-1 md:basis-auto"
        />
      )}

      <div className="flex min-w-0 flex-wrap items-center gap-1 md:flex-nowrap">
        {rules.allowBreaks ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Break"
            aria-pressed={values.type === "break"}
            disabled={Boolean(running)}
            onClick={() =>
              setDraft(
                values.type === "break"
                  ? { type: "work" }
                  : { type: "break", projectId: null, taskId: null, tagIds: [], billable: false },
              )
            }
            className={cn(
              values.type === "break" ? "text-primary bg-primary/10" : "text-muted-foreground",
            )}
          >
            <CoffeeIcon /> Break
          </Button>
        ) : null}
        {values.type === "break" ? null : (
          <>
        <ProjectPicker
          slug={slug}
          value={{ projectId: values.projectId, taskId: values.taskId }}
          current={running ? { project: running.project, task: running.task } : null}
          canCreate={canCreate.project}
          invalid={stopProblem?.field === "project" || stopProblem?.field === "task"}
          onChange={(sel) => change({ projectId: sel.projectId, taskId: sel.taskId })}
        />
        <TagPicker
          key={running?.id ?? "draft"}
          slug={slug}
          value={values.tagIds}
          current={running?.tags ?? []}
          canCreate={canCreate.tag}
          invalid={stopProblem?.field === "tag"}
          onChange={(tagIds) => change({ tagIds })}
        />
        <BillableToggle value={values.billable} onChange={(billable) => change({ billable })} />
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        {mode === "timer" ? (
          <>
            <LiveClock />
            <Button
              type="button"
              onClick={() => void tracker.toggle()}
              disabled={pending}
              variant={running ? "destructive" : "default"}
              className="min-w-24"
            >
              {pending ? (
                <Loader2Icon className="animate-spin" />
              ) : running ? (
                <SquareIcon />
              ) : (
                <PlayIcon />
              )}
              {running ? "Stop" : "Start"}
            </Button>
          </>
        ) : (
          <ManualEntryFields
            draft={draft}
            onSubmit={async (input) => {
              // A project or tag still being created belongs on this entry, as on Start.
              const details = await settledDraft();
              const ok = await createManual({ ...input, ...details });
              if (ok) setDraft(EMPTY_DRAFT);
              return ok;
            }}
          />
        )}
        {canWriteTimes ? (
        <div className="flex flex-col" role="group" aria-label="Entry mode">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Timer mode"
            aria-pressed={mode === "timer"}
            onClick={() => setMode("timer")}
            className={cn(mode === "timer" ? "text-primary" : "text-muted-foreground")}
          >
            <TimerIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Manual mode"
            aria-pressed={mode === "manual"}
            disabled={Boolean(running)}
            onClick={() => setMode("manual")}
            className={cn(mode === "manual" ? "text-primary" : "text-muted-foreground")}
          >
            <ListPlusIcon />
          </Button>
        </div>
        ) : null}
      </div>
      {stopProblem ? (
        <p role="alert" className="text-destructive basis-full px-1 text-sm">
          {stopProblem.message}
        </p>
      ) : null}
    </section>
    </TargetProvider>
  );
}
