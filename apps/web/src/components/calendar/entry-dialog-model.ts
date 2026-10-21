import type { EntryDraft } from "@/lib/tracker-types";

function sameSet(a: string[], b: string[]): boolean {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((id, i) => id === y[i]);
}

/**
 * The parts of the dialog's draft that differ from what the entry has. Only
 * those are sent: the service reads a re-sent project as an assignment (and
 * refuses an archived one), and tags compare as a set. A task implies its
 * project, so the two always travel together.
 */
export function draftChanges(initial: EntryDraft, current: EntryDraft): Partial<EntryDraft> {
  const patch: Partial<EntryDraft> = {};
  if (current.description !== initial.description) patch.description = current.description;
  if (current.projectId !== initial.projectId || current.taskId !== initial.taskId) {
    patch.projectId = current.projectId;
    patch.taskId = current.taskId;
  }
  if (!sameSet(current.tagIds, initial.tagIds)) patch.tagIds = current.tagIds;
  if (current.billable !== initial.billable) patch.billable = current.billable;
  return patch;
}

/**
 * Times are re-parsed from their text at minute precision, so a
 * timer-recorded entry would lose its seconds on every save; they are sent
 * only when their text was edited.
 */
export function timesChanged(
  initial: { startText: string; endText: string },
  current: { startText: string; endText: string },
): boolean {
  return initial.startText !== current.startText || initial.endText !== current.endText;
}
