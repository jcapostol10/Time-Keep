import type { EntryDraft, EntryTag, PickerProject } from "@/lib/tracker-types";

/**
 * The draft without what the options no longer offer: a project archived or
 * made private meanwhile (with its task), a task that was done, tags that
 * were archived. Used after a rejected Start, once the options are refetched,
 * so the next Start does not fail the same way.
 */
export function pruneDraft(
  draft: EntryDraft,
  options: { projects: PickerProject[]; tags: EntryTag[] },
): EntryDraft {
  const project = draft.projectId
    ? options.projects.find((p) => p.id === draft.projectId)
    : undefined;
  const projectId = project ? project.id : null;
  const taskId =
    project && draft.taskId && project.tasks.some((t) => t.id === draft.taskId)
      ? draft.taskId
      : null;
  const known = new Set(options.tags.map((t) => t.id));
  const tagIds = draft.tagIds.filter((id) => known.has(id));
  return { ...draft, projectId, taskId, tagIds };
}
