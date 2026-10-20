import type { Role } from "./roles";

/**
 * Rules for clients, projects, tasks and tags that both the server and the
 * UI apply: who may manage them, who may see a project, and whether a set of
 * entry details may still receive new time.
 */

export const PROJECT_VISIBILITIES = ["PUBLIC", "PRIVATE"] as const;
export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number];

export const TASK_STATUSES = ["ACTIVE", "DONE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Creating and editing clients, projects, tasks and tags. Phase 4 adds a workspace setting. */
export function canManageCatalog(role: Role): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Admins see every project. Everyone else sees public projects and the
 * private ones they are a member of. Managers gain delegated scope in Phase 4.
 */
export function canSeeProject(args: {
  role: Role;
  visibility: ProjectVisibility;
  isMember: boolean;
}): boolean {
  if (canManageCatalog(args.role)) return true;
  return args.visibility === "PUBLIC" || args.isMember;
}

export interface TrackingDetails {
  project: { id: string; archived: boolean } | null;
  task: { projectId: string; status: TaskStatus } | null;
  tags: { name: string; archived: boolean }[];
}

/**
 * Why new time cannot be recorded with these details, or null when it can.
 * Existing entries keep archived projects, done tasks and archived tags.
 */
export function trackingBlock(d: TrackingDetails): string | null {
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
