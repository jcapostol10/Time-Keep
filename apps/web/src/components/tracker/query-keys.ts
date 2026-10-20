import type { EntryTag, PickerProject, RecentDescription } from "@/lib/tracker-types";

/** react-query keys shared by the server page (hydration) and client hooks. */
export const trackerKeys = {
  all: (slug: string) => ["tracker", slug] as const,
  running: (slug: string) => ["tracker", slug, "running"] as const,
  entries: (slug: string) => ["tracker", slug, "entries"] as const,
  options: (slug: string) => ["tracker", slug, "options"] as const,
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
  options: (slug: string) => `/api/w/${slug}/tracker-options`,
};
