import { z } from "zod";

import type { ViewerPrefs } from "./prefs";
import {
  addDaysInZone,
  daysBetweenInZone,
  localDateKey,
  monthBoundsInZone,
  startOfDayInZone,
  weekBounds,
  zonedDateTimeToInstant,
} from "./time";

/**
 * The report query: what the URL carries, what a share link stores, what
 * the engine runs. Grouping keys, presets and modes are fixed vocabularies,
 * so nothing from a URL reaches SQL as text.
 */

export const GROUP_KEYS = [
  "project",
  "client",
  "user",
  "task",
  "tag",
  "date",
  "week",
  "month",
  "description",
] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export const RANGE_PRESETS = [
  "today",
  "yesterday",
  "this-week",
  "last-week",
  "this-month",
  "last-month",
  "this-year",
  "last-year",
  "custom",
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const BUCKETS = ["day", "week", "month"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const REPORT_KINDS = ["summary", "detailed", "weekly"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const EXPORT_FORMATS = ["csv", "xlsx", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_REPORTS = ["summary", "detailed", "weekly", "project-status"] as const;
export type ExportReport = (typeof EXPORT_REPORTS)[number];
export const EXPORT_STATUSES = ["queued", "running", "done", "failed"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/** The filter value that means "entries without one" (no project, no task, no tag). */
export const NONE_ID = "none";

const idList = z.array(z.string().min(1).max(64)).max(100).default([]);

export const reportQuerySchema = z
  .object({
    preset: z.enum(RANGE_PRESETS).default("this-week"),
    /** ISO instants; only read when preset is "custom". */
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    userIds: idList,
    clientIds: idList,
    projectIds: idList,
    taskIds: idList,
    tagIds: idList,
    tagMode: z.enum(["and", "or"]).default("or"),
    billable: z.enum(["all", "yes", "no"]).default("all"),
    description: z.string().max(200).default(""),
    groupBy: z
      .array(z.enum(GROUP_KEYS))
      .min(1)
      .max(3)
      .refine((keys) => new Set(keys).size === keys.length, "Group keys must differ")
      .default(["project"]),
    bucket: z.enum(BUCKETS).optional(),
  })
  .superRefine((q, ctx) => {
    if (q.preset !== "custom") return;
    if (!q.from || !q.to) {
      ctx.addIssue({ code: "custom", path: ["from"], message: "A custom range needs its dates" });
    } else if (Date.parse(q.to) <= Date.parse(q.from)) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "The range must end after it starts" });
    }
  });

export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type ReportQueryInput = z.input<typeof reportQuerySchema>;

const ARRAY_KEYS = ["userIds", "clientIds", "projectIds", "taskIds", "tagIds", "groupBy"] as const;
const SCALAR_KEYS = [
  "preset",
  "from",
  "to",
  "tagMode",
  "billable",
  "description",
  "bucket",
] as const;

export const DEFAULT_REPORT_QUERY: ReportQuery = reportQuerySchema.parse({});

/** The query a URL carries; anything invalid falls back to the defaults, so a stale link still opens. */
export function parseReportQuery(params: URLSearchParams): ReportQuery {
  const raw: Record<string, unknown> = {};
  for (const key of ARRAY_KEYS) {
    const values = params.getAll(key);
    if (values.length > 0) raw[key] = values;
  }
  for (const key of SCALAR_KEYS) {
    const value = params.get(key);
    if (value !== null) raw[key] = value;
  }
  const parsed = reportQuerySchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_REPORT_QUERY };
}

/** Only what differs from the defaults, so URLs stay short and comparable. */
export function reportQueryToSearchParams(q: ReportQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of SCALAR_KEYS) {
    const value = q[key];
    if (value !== undefined && value !== DEFAULT_REPORT_QUERY[key]) params.set(key, String(value));
  }
  for (const key of ARRAY_KEYS) {
    const values = q[key] as readonly string[];
    const defaults = DEFAULT_REPORT_QUERY[key] as readonly string[];
    if (values.length === defaults.length && values.every((v, i) => v === defaults[i])) continue;
    for (const v of values) params.append(key, v);
  }
  return params;
}

export interface ReportRange {
  /** Half-open: entries starting in [from, to). */
  from: Date;
  to: Date;
  label: string;
}

const PRESET_LABELS: Record<Exclude<RangePreset, "custom">, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "this-week": "This week",
  "last-week": "Last week",
  "this-month": "This month",
  "last-month": "Last month",
  "this-year": "This year",
  "last-year": "Last year",
};

function yearStart(year: number, tz: string): Date {
  return zonedDateTimeToInstant({ date: `${year}-01-01`, hours: 0, minutes: 0 }, tz);
}

/** "Mar 2 – Mar 15, 2026" for a half-open range, in the zone. */
export function formatRangeLabel(from: Date, toExclusive: Date, tz: string): string {
  const last = addDaysInZone(toExclusive, -1, tz);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" });
  const year = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" });
  return `${day.format(from)} – ${day.format(last)}, ${year.format(last)}`;
}

/** The instants a preset means for this viewer, now. */
export function resolveReportRange(
  q: Pick<ReportQuery, "preset" | "from" | "to">,
  prefs: Pick<ViewerPrefs, "timezone" | "weekStart">,
  now: Date,
): ReportRange {
  const tz = prefs.timezone;
  const label = (from: Date, to: Date, preset: RangePreset) => ({
    from,
    to,
    label: preset === "custom" ? formatRangeLabel(from, to, tz) : PRESET_LABELS[preset],
  });
  const today = startOfDayInZone(now, tz);
  switch (q.preset) {
    case "today":
      return label(today, addDaysInZone(today, 1, tz), q.preset);
    case "yesterday":
      return label(addDaysInZone(today, -1, tz), today, q.preset);
    case "this-week": {
      const w = weekBounds(now, tz, prefs.weekStart);
      return label(w.weekStart, w.weekEnd, q.preset);
    }
    case "last-week": {
      const w = weekBounds(addDaysInZone(now, -7, tz), tz, prefs.weekStart);
      return label(w.weekStart, w.weekEnd, q.preset);
    }
    case "this-month": {
      const m = monthBoundsInZone(now, tz);
      return label(m.monthStart, m.monthEnd, q.preset);
    }
    case "last-month": {
      const thisMonth = monthBoundsInZone(now, tz);
      const m = monthBoundsInZone(addDaysInZone(thisMonth.monthStart, -1, tz), tz);
      return label(m.monthStart, m.monthEnd, q.preset);
    }
    case "this-year": {
      const year = Number(localDateKey(now, tz).slice(0, 4));
      return label(yearStart(year, tz), yearStart(year + 1, tz), q.preset);
    }
    case "last-year": {
      const year = Number(localDateKey(now, tz).slice(0, 4)) - 1;
      return label(yearStart(year, tz), yearStart(year + 1, tz), q.preset);
    }
    case "custom": {
      // The schema guarantees both dates for a custom preset.
      const from = new Date(q.from ?? now.toISOString());
      const to = new Date(q.to ?? now.toISOString());
      return label(from, to, q.preset);
    }
  }
}

/** The time-series step for a range: days up to a month, weeks up to a year, months beyond. */
export function bucketFor(from: Date, to: Date, tz: string, override?: Bucket): Bucket {
  if (override) return override;
  const days = daysBetweenInZone(from, to, tz);
  if (days <= 31) return "day";
  if (days <= 366) return "week";
  return "month";
}

/** Every total is a record of measures, so Phase 4 adds amounts as keys. */
export interface ReportTotals {
  durationSeconds: number;
  billableSeconds: number;
  entryCount: number;
}

export const EMPTY_TOTALS: ReportTotals = { durationSeconds: 0, billableSeconds: 0, entryCount: 0 };

export function addTotals(a: ReportTotals, b: ReportTotals): ReportTotals {
  return {
    durationSeconds: a.durationSeconds + b.durationSeconds,
    billableSeconds: a.billableSeconds + b.billableSeconds,
    entryCount: a.entryCount + b.entryCount,
  };
}

export interface GroupValue {
  id: string | null;
  label: string;
}

/** One aggregated row from SQL: the value of each grouping key and the totals. */
export interface ReportRow {
  keys: Partial<Record<GroupKey, GroupValue>>;
  totals: ReportTotals;
}

export interface ReportGroup {
  key: GroupKey;
  id: string | null;
  label: string;
  totals: ReportTotals;
  children: ReportGroup[];
}

const NULL_ID = "\u0000";

function compareGroups(a: ReportGroup, b: ReportGroup): number {
  return b.totals.durationSeconds - a.totals.durationSeconds || a.label.localeCompare(b.label);
}

function nest(rows: ReportRow[], keys: GroupKey[]): ReportGroup[] {
  const key = keys[0];
  if (!key) return [];
  const buckets = new Map<string, { value: GroupValue; rows: ReportRow[] }>();
  for (const row of rows) {
    const value = row.keys[key] ?? { id: null, label: "—" };
    const mapKey = value.id ?? NULL_ID;
    const bucket = buckets.get(mapKey) ?? { value, rows: [] };
    bucket.rows.push(row);
    buckets.set(mapKey, bucket);
  }
  return [...buckets.values()]
    .map(({ value, rows: inner }) => ({
      key,
      id: value.id,
      label: value.label,
      totals: inner.reduce((sum, r) => addTotals(sum, r.totals), EMPTY_TOTALS),
      children: nest(inner, keys.slice(1)),
    }))
    .sort(compareGroups);
}

/**
 * Nests flat SQL rows into groups, one level per key, with totals at every
 * level. The overall total is the caller's (an ungrouped aggregate): when
 * grouping by tag, an entry with two tags sits under both groups.
 */
export function groupRows(
  rows: ReportRow[],
  keys: GroupKey[],
  totals: ReportTotals,
): { groups: ReportGroup[]; totals: ReportTotals } {
  return { groups: nest(rows, keys), totals };
}

export interface WeeklyRow {
  id: string | null;
  label: string;
  days: number[];
  total: number;
}

/** Rows (users or projects) over the week's day keys; a day without entries is 0. */
export function buildWeekly(
  rows: { id: string | null; label: string; dateKey: string; seconds: number }[],
  dayKeys: string[],
): { rows: WeeklyRow[]; dayTotals: number[]; total: number } {
  const index = new Map(dayKeys.map((k, i) => [k, i]));
  const byId = new Map<string, WeeklyRow>();
  for (const r of rows) {
    const col = index.get(r.dateKey);
    if (col === undefined) continue;
    const mapKey = r.id ?? NULL_ID;
    const row = byId.get(mapKey) ?? {
      id: r.id,
      label: r.label,
      days: dayKeys.map(() => 0),
      total: 0,
    };
    row.days[col] = (row.days[col] ?? 0) + r.seconds;
    row.total += r.seconds;
    byId.set(mapKey, row);
  }
  const result = [...byId.values()].sort(
    (a, b) => b.total - a.total || a.label.localeCompare(b.label),
  );
  const dayTotals = dayKeys.map((_, i) => result.reduce((n, r) => n + (r.days[i] ?? 0), 0));
  return { rows: result, dayTotals, total: dayTotals.reduce((n, d) => n + d, 0) };
}
