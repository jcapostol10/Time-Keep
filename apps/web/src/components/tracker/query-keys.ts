import type { EntryTag, PickerProject, RecentDescription } from "@/lib/tracker-types";

/** react-query keys shared by the server page (hydration) and client hooks. */
export const trackerKeys = {
  all: (slug: string) => ["tracker", slug] as const,
  running: (slug: string) => ["tracker", slug, "running"] as const,
  entries: (slug: string) => ["tracker", slug, "entries"] as const,
  /** Under the `entries` prefix, so one invalidation refreshes the list, the grid and the calendar. */
  range: (slug: string, from: string, to: string) =>
    ["tracker", slug, "entries", "range", from, to] as const,
  options: (slug: string) => ["tracker", slug, "options"] as const,
  templates: (slug: string) => ["tracker", slug, "templates"] as const,
};

export interface TrackerOptions {
  projects: PickerProject[];
  tags: EntryTag[];
  recent: RecentDescription[];
}

export const trackerUrls = {
  entries: (slug: string, before?: string | null) =>
    `/api/w/${slug}/time-entries${before ? `?before=${encodeURIComponent(before)}` : ""}`,
  running: (slug: string) => `/api/w/${slug}/time-entries/running`,
  range: (slug: string, from: string, to: string) =>
    `/api/w/${slug}/time-entries/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  options: (slug: string) => `/api/w/${slug}/tracker-options`,
  templates: (slug: string) => `/api/w/${slug}/timesheet-templates`,
};
