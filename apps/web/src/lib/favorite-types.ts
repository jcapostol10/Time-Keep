import type { EntryProject, EntryTag, EntryTask } from "./tracker-types";

/** A pinned set of entry details the tracker starts timers from (Phase 4b). */
export interface FavoriteDTO {
  id: string;
  description: string;
  projectId: string | null;
  project: EntryProject | null;
  taskId: string | null;
  task: EntryTask | null;
  tags: EntryTag[];
  tagIds: string[];
  billable: boolean;
  /** Why it cannot start now (archived project, done task, a project no longer visible), or null. */
  blocked: string | null;
}
