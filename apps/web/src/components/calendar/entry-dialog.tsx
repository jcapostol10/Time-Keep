"use client";

import {
  formatTimeOfDay,
  localDateKey,
  localTimeParts,
  manualRange,
  parseTimeOfDay,
  zonedDateTimeToInstant,
} from "@timekeep/core";
import { Button } from "@timekeep/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import { Input } from "@timekeep/ui/components/input";
import { Loader2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EMPTY_DRAFT, type EntryDraft, type TimeEntryDTO } from "@/lib/tracker-types";

import { BillableToggle } from "../tracker/billable-toggle";
import { DescriptionInput } from "../tracker/description-input";
import { ProjectPicker } from "../tracker/project-picker";
import { TagPicker } from "../tracker/tag-picker";
import { useTracker } from "../tracker/tracker-provider";
import { type UpdateEntryPatch, useEntryWrites } from "../tracker/use-entry-writes";
import { draftChanges, timesChanged } from "./entry-dialog-model";

export type EntryDialogMode =
  | { kind: "create"; dayKey: string; start: Date; end: Date }
  | { kind: "edit"; entry: TimeEntryDTO };

/** Create an entry from a drag, or edit one from a click. */
export function EntryDialog({ mode, onClose }: { mode: EntryDialogMode; onClose: () => void }) {
  const { slug, viewer, canCreate, rules } = useTracker();
  const tz = viewer.timezone;
  const writes = useEntryWrites();
  const initialStart = mode.kind === "create" ? mode.start : new Date(mode.entry.start);
  const initialEnd =
    mode.kind === "create" ? mode.end : new Date(mode.entry.end ?? mode.entry.start);
  const dayKey = mode.kind === "create" ? mode.dayKey : localDateKey(initialStart, tz);

  const initialDraft: EntryDraft =
    mode.kind === "create"
      ? EMPTY_DRAFT
      : {
          description: mode.entry.description,
          projectId: mode.entry.projectId,
          taskId: mode.entry.taskId,
          tagIds: mode.entry.tagIds,
          billable: mode.entry.billable,
        };
  const initialTexts = {
    startText: formatTimeOfDay(initialStart, tz, viewer.timeFormat),
    endText: formatTimeOfDay(initialEnd, tz, viewer.timeFormat),
  };
  const [draft, setDraft] = useState<EntryDraft>(initialDraft);
  const [startText, setStartText] = useState(initialTexts.startText);
  const [endText, setEndText] = useState(initialTexts.endText);
  const [busy, setBusy] = useState(false);

  function patchDraft(patch: Partial<EntryDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  function times(): { start: Date; end: Date } | null {
    const start = parseTimeOfDay(startText);
    const end = parseTimeOfDay(endText);
    if (!start || !end) {
      toast.error("Enter times like 9:30 or 2pm");
      return null;
    }
    // An end at or before the start rolls over to the next day, as in manual mode.
    const range = manualRange({ date: dayKey, start, end }, tz);
    const startInstant = zonedDateTimeToInstant({ date: dayKey, ...start }, tz);
    return {
      start: startInstant,
      end: new Date(startInstant.getTime() + range.durationSeconds * 1000),
    };
  }

  async function submit() {
    if (mode.kind === "create") {
      const t = times();
      if (!t) return;
      setBusy(true);
      const ok = await writes.createManual({
        ...draft,
        start: t.start.toISOString(),
        end: t.end.toISOString(),
      });
      setBusy(false);
      if (ok) onClose();
      return;
    }
    // Only what changed: a re-sent project reads as an assignment (refused when
    // archived), and re-parsed times would drop a timer-recorded entry's seconds.
    const patch: UpdateEntryPatch = draftChanges(initialDraft, draft);
    if (timesChanged(initialTexts, { startText, endText })) {
      const t = times();
      if (!t) return;
      patch.start = t.start.toISOString();
      patch.end = t.end.toISOString();
    }
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    const ok = await writes.update(mode.entry.id, patch);
    setBusy(false);
    if (ok) onClose();
  }

  async function remove() {
    if (mode.kind !== "edit") return;
    setBusy(true);
    const ok = await writes.remove([mode.entry.id]);
    setBusy(false);
    if (ok) onClose();
  }

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(zonedDateTimeToInstant({ date: dayKey, hours: 12, minutes: 0 }, tz));
  const nowParts = localTimeParts(new Date(), tz);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode.kind === "create" ? "New entry" : "Edit entry"}</DialogTitle>
          <DialogDescription>{dateLabel}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DescriptionInput
            slug={slug}
            value={draft.description}
            onChange={(description) => patchDraft({ description })}
            onPick={(s) =>
              patchDraft({
                description: s.description,
                projectId: s.projectId,
                taskId: s.taskId,
                tagIds: s.tagIds,
                billable: s.billable,
              })
            }
            className="rounded-md border"
          />
          <div className="flex flex-wrap items-center gap-1">
            <ProjectPicker
              slug={slug}
              value={{ projectId: draft.projectId, taskId: draft.taskId }}
              current={
                mode.kind === "edit" ? { project: mode.entry.project, task: mode.entry.task } : null
              }
              canCreate={canCreate.project}
              onChange={(sel) => patchDraft({ projectId: sel.projectId, taskId: sel.taskId })}
            />
            <TagPicker
              slug={slug}
              value={draft.tagIds}
              current={mode.kind === "edit" ? mode.entry.tags : []}
              canCreate={canCreate.tag}
              onChange={(tagIds) => patchDraft({ tagIds })}
            />
            <BillableToggle
              value={draft.billable}
              onChange={(billable) => patchDraft({ billable })}
            />
          </div>
          <div className="flex items-center gap-2">
            <Input
              aria-label="Start time"
              readOnly={!rules.canWriteTimes}
              value={startText}
              onChange={(e) => setStartText(e.target.value)}
              className="w-28 tabular-nums"
              placeholder={formatTimeOfDay(
                zonedDateTimeToInstant({ date: dayKey, ...nowParts }, tz),
                tz,
                viewer.timeFormat,
              )}
            />
            <span className="text-muted-foreground">–</span>
            <Input
              aria-label="End time"
              readOnly={!rules.canWriteTimes}
              value={endText}
              onChange={(e) => setEndText(e.target.value)}
              className="w-28 tabular-nums"
            />
          </div>
          <DialogFooter className="sm:justify-between">
            {mode.kind === "edit" ? (
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void remove()}
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2Icon className="animate-spin" /> : null}
                {mode.kind === "create" ? "Create" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
