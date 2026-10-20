/**
 * Isomorphic DTOs for the time tracker. Everything that crosses the
 * server/client boundary (server actions, route handlers, react-query cache)
 * uses these shapes: instants are ISO strings, never `Date`s.
 */

export interface EntryProject {
  id: string;
  name: string;
  color: string;
  clientName: string | null;
}

export interface EntryTask {
  id: string;
  name: string;
}

export interface PickerTask {
  id: string;
  name: string;
}

/** A project the viewer may track on, with its active tasks, as the pickers list it. */
export interface PickerProject {
  id: string;
  name: string;
  color: string;
  clientId: string | null;
  clientName: string | null;
  /** Default for new entries on this project. */
  billable: boolean;
  favorite: boolean;
  tasks: PickerTask[];
}

export interface EntryTag {
  id: string;
  name: string;
  color: string;
}

export interface TimeEntryDTO {
  id: string;
  description: string;
  projectId: string | null;
  project: EntryProject | null;
  taskId: string | null;
  task: EntryTask | null;
  tags: EntryTag[];
  tagIds: string[];
  billable: boolean;
  /** ISO instant */
  start: string;
  /** ISO instant; null while running */
  end: string | null;
  durationSeconds: number | null;
  updatedAt: string;
}

/** One week of entries (in the viewer's timezone), newest first. */
export interface EntriesPage {
  weekStart: string;
  weekEnd: string;
  entries: TimeEntryDTO[];
  /** ISO instant to pass as `before` for the next (older) page, or null. */
  nextCursor: string | null;
}

export interface RecentDescription {
  description: string;
  projectId: string | null;
  taskId: string | null;
  tagIds: string[];
  billable: boolean;
  lastUsedAt: string;
}

/** What the timer bar holds before a timer starts. */
export interface EntryDraft {
  description: string;
  projectId: string | null;
  taskId: string | null;
  tagIds: string[];
  billable: boolean;
}

export const EMPTY_DRAFT: EntryDraft = {
  description: "",
  projectId: null,
  taskId: null,
  tagIds: [],
  billable: false,
};
