import type { EntryTag, PickerProject, RecentDescription } from "@/lib/tracker-types";

/** react-query keys shared by the server page (hydration) and client hooks. */
export const trackerKeys = {
  all: (slug: string) => ["tracker", slug] as const,
  running: (slug: string) => ["tracker", slug, "running"] as const,
  /** Every entry query of the workspace, whoever's: the invalidation prefix. */
  allEntries: (slug: string) => ["tracker", slug, "entries"] as const,
  /** A person's list ("me", or the id of someone the viewer adds time for). */
  entries: (slug: string, userId = "me") => ["tracker", slug, "entries", userId] as const,
  /** Under the `entries` prefix, so one invalidation refreshes the list, the grid and the calendar. */
  range: (slug: string, from: string, to: string, userId = "me") =>
    ["tracker", slug, "entries", userId, "range", from, to] as const,
  allOptions: (slug: string) => ["tracker", slug, "options"] as const,
  options: (slug: string, userId = "me") => ["tracker", slug, "options", userId] as const,
  people: (slug: string) => ["tracker", slug, "people"] as const,
  favorites: (slug: string) => ["tracker", slug, "favorites"] as const,
  /** Also under `entries`: an inline edit in the Detailed report refetches every report. */
  report: (slug: string, kind: string, params: string) =>
    ["tracker", slug, "entries", "report", kind, params] as const,
  reportOptions: (slug: string) => ["tracker", slug, "report-options"] as const,
  templates: (slug: string) => ["tracker", slug, "templates"] as const,
  rates: (slug: string, target: string) => ["tracker", slug, "rates", target] as const,
  rateRecalc: (slug: string) => ["tracker", slug, "rate-recalc"] as const,
};

export interface TrackerOptions {
  projects: PickerProject[];
  tags: EntryTag[];
  recent: RecentDescription[];
}

const forUser = (userId: string, first: boolean) =>
  userId === "me" ? "" : `${first ? "?" : "&"}userId=${encodeURIComponent(userId)}`;

export const trackerUrls = {
  entries: (slug: string, before?: string | null, userId = "me") =>
    `/api/w/${slug}/time-entries${before ? `?before=${encodeURIComponent(before)}` : ""}${forUser(userId, !before)}`,
  running: (slug: string) => `/api/w/${slug}/time-entries/running`,
  range: (slug: string, from: string, to: string, userId = "me") =>
    `/api/w/${slug}/time-entries/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${forUser(userId, false)}`,
  options: (slug: string, userId = "me") => `/api/w/${slug}/tracker-options${forUser(userId, true)}`,
  people: (slug: string) => `/api/w/${slug}/people`,
  favorites: (slug: string) => `/api/w/${slug}/favorites`,
  report: (slug: string, kind: string, params: string) =>
    `/api/w/${slug}/reports/${kind}${params ? `?${params}` : ""}`,
  reportOptions: (slug: string) => `/api/w/${slug}/reports/options`,
  rates: (slug: string, target: string) => `/api/w/${slug}/rates?${target}`,
  rateRecalc: (slug: string) => `/api/w/${slug}/rate-recalc`,
  templates: (slug: string) => `/api/w/${slug}/timesheet-templates`,
};
