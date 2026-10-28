/**
 * Rules for clients, projects, tasks and tags that both the server and the
 * UI apply: whether a set of entry details may still receive new time. Who
 * may manage or see them is the permission matrix (permissions.ts).
 */

export const PROJECT_VISIBILITIES = ["PUBLIC", "PRIVATE"] as const;
export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number];

export const TASK_STATUSES = ["ACTIVE", "DONE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TrackingDetails {
  project: { id: string; archived: boolean; isTemplate?: boolean } | null;
  task: { projectId: string; status: TaskStatus } | null;
  tags: { name: string; archived: boolean }[];
}

/**
 * Why new time cannot be recorded with these details, or null when it can.
 * Existing entries keep archived projects, done tasks and archived tags.
 */
export function trackingBlock(d: TrackingDetails): string | null {
  if (d.project?.isTemplate) return "This project is a template.";
  if (d.project?.archived) return "This project is archived.";
  if (d.task) {
    if (!d.project || d.task.projectId !== d.project.id) {
      return "This task belongs to another project.";
    }
    if (d.task.status === "DONE") return "This task is done.";
  }
  const archivedTag = d.tags.find((t) => t.archived);
  if (archivedTag) return `Tag "${archivedTag.name}" is archived.`;
  return null;
}
