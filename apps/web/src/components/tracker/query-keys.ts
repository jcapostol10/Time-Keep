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
  /** The viewer's approval periods (Phase 5a); under `entries`, so a write refreshes its total. */
  periods: (slug: string, from: string, to: string) =>
    ["tracker", slug, "entries", "me", "periods", from, to] as const,
  /** The Approvals page's tab; under `entries`, so decisions and writes refetch it. */
  approvals: (slug: string, tab: string) => ["tracker", slug, "entries", "approvals", tab] as const,
  templates: (slug: string) => ["tracker", slug, "templates"] as const,
  rates: (slug: string, target: string) => ["tracker", slug, "rates", target] as const,
  rateRecalc: (slug: string) => ["tracker", slug, "rate-recalc"] as const,
};

/**
 * Time off (Phase 5b): its own prefix, outside `entries`: time entries never change
 * it. Every time off write invalidates `timeOffKeys.all`, which includes the
 * timesheet's and calendar's bands (`range`).
 */
export const timeOffKeys = {
  all: (slug: string) => ["time-off", slug] as const,
  requests: (slug: string, tab: string) => ["time-off", slug, "requests", tab] as const,
  balances: (slug: string) => ["time-off", slug, "balances"] as const,
  range: (slug: string, from: string, to: string, userId = "me") =>
    ["time-off", slug, "range", userId, from, to] as const,
  calendar: (slug: string, month: string) => ["time-off", slug, "calendar", month] as const,
  policies: (slug: string) => ["time-off", slug, "policies"] as const,
  holidays: (slug: string, year: number) => ["time-off", slug, "holidays", year] as const,
  preview: (slug: string, params: string) => ["time-off", slug, "preview", params] as const,
};

export const timeOffUrls = {
  requests: (slug: string, tab: string) => `/api/w/${slug}/time-off/requests?tab=${tab}`,
  balances: (slug: string) => `/api/w/${slug}/time-off/balances`,
  range: (slug: string, from: string, to: string, userId = "me") =>
    `/api/w/${slug}/time-off/range?from=${from}&to=${to}${userId === "me" ? "" : `&userId=${encodeURIComponent(userId)}`}`,
  calendar: (slug: string, month: string) => `/api/w/${slug}/time-off/calendar?month=${month}`,
  policies: (slug: string, archived = false) =>
    `/api/w/${slug}/time-off/policies${archived ? "?archived=1" : ""}`,
  holidays: (slug: string, year: number) => `/api/w/${slug}/time-off/holidays?year=${year}`,
  preview: (slug: string, params: string) => `/api/w/${slug}/time-off/preview?${params}`,
  countries: (slug: string, country?: string) =>
    `/api/w/${slug}/time-off/countries${country ? `?country=${country}` : ""}`,
  importPreview: (slug: string, params: string) =>
    `/api/w/${slug}/time-off/holidays/import?${params}`,
};

/**
 * Expenses (Phase 6c): their own prefix; an expense write invalidates
 * `expenseKeys.all` and the reports prefix (the Profit tab counts expenses).
 */
export const expenseKeys = {
  all: (slug: string) => ["expenses", slug] as const,
  /** The page's list for a serialised query; pages by cursor inside. */
  list: (slug: string, params: string) => ["expenses", slug, "list", params] as const,
  categories: (slug: string, archived: boolean) =>
    ["expenses", slug, "categories", archived] as const,
};

export const expenseUrls = {
  list: (slug: string, params: string, cursor?: string | null) =>
    `/api/w/${slug}/expenses?${params}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  categories: (slug: string, archived: boolean) =>
    `/api/w/${slug}/expenses/categories${archived ? "?archived=1" : ""}`,
  receipt: (slug: string, expenseId: string, thumb = false) =>
    `/api/w/${slug}/expenses/${expenseId}/receipt${thumb ? "?thumb=1" : ""}`,
};

/**
 * Invoices (Phase 6d): their own prefix. An invoice write invalidates
 * `invoiceKeys.all` and the tracker's entries (an import locks entries).
 */
export const invoiceKeys = {
  all: (slug: string) => ["invoices", slug] as const,
  list: (slug: string, params: string) => ["invoices", slug, "list", params] as const,
  one: (slug: string, id: string) => ["invoices", slug, "one", id] as const,
  settings: (slug: string) => ["invoices", slug, "settings"] as const,
  recurring: (slug: string) => ["invoices", slug, "recurring"] as const,
  importPreview: (slug: string, id: string, params: string) =>
    ["invoices", slug, "import-preview", id, params] as const,
};

export const invoiceUrls = {
  list: (slug: string, params: string, cursor?: string | null) =>
    `/api/w/${slug}/invoices?${params}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  one: (slug: string, id: string) => `/api/w/${slug}/invoices/${id}`,
  pdf: (slug: string, id: string) => `/api/w/${slug}/invoices/${id}/pdf`,
  importPreview: (slug: string, id: string, params: string) =>
    `/api/w/${slug}/invoices/${id}/import-preview?${params}`,
  settings: (slug: string) => `/api/w/${slug}/invoices/settings`,
  recurring: (slug: string) => `/api/w/${slug}/invoices/recurring`,
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
  options: (slug: string, userId = "me") =>
    `/api/w/${slug}/tracker-options${forUser(userId, true)}`,
  people: (slug: string) => `/api/w/${slug}/people`,
  favorites: (slug: string) => `/api/w/${slug}/favorites`,
  report: (slug: string, kind: string, params: string) =>
    `/api/w/${slug}/reports/${kind}${params ? `?${params}` : ""}`,
  reportOptions: (slug: string) => `/api/w/${slug}/reports/options`,
  periods: (slug: string, from: string, to: string) =>
    `/api/w/${slug}/approvals/periods?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  rates: (slug: string, target: string) => `/api/w/${slug}/rates?${target}`,
  rateRecalc: (slug: string) => `/api/w/${slug}/rate-recalc`,
  templates: (slug: string) => `/api/w/${slug}/timesheet-templates`,
};
