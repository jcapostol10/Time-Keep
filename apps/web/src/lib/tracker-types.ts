/**
 * Isomorphic DTOs for the time tracker. Everything that crosses the
 * server/client boundary (server actions, route handlers, react-query cache)
 * uses these shapes: instants are ISO strings, never `Date`s.
 */

export interface EntryProject {
  id: string;
  name: string;
  color: string;
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
