import { z } from "zod";

import { EXPENSE_GROUP_KEYS } from "./expenses";
import type { ViewerPrefs } from "./prefs";
import { MAX_DATE_RANGE_DAYS } from "./schemas";
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

export const WEEKLY_BYS = ["project", "user"] as const;
export type WeeklyBy = (typeof WEEKLY_BYS)[number];

export const BUCKETS = ["day", "week", "month"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const REPORT_KINDS = ["summary", "detailed", "weekly"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
/** The report pages: the kinds, plus the Audit tab (the Detailed report with audit criteria). */
/**
 * The report tabs; Attendance (Phase 5b) reads its own engine, not the entry groupings,
 * and Expenses (Phase 6c) reads the expense aggregate.
 */
export type ReportView = ReportKind | "audit" | "attendance" | "profit" | "expenses";

/** What the Profit tab groups by (Phase 6a): one level, sorted by profit. */
export const PROFIT_GROUP_KEYS = [
  "project",
  "client",
  "user",
] as const satisfies readonly GroupKey[];
export type ProfitGroupKey = (typeof PROFIT_GROUP_KEYS)[number];

/** The Profit tab's key for a query: its first grouping key when the tab offers it, else project. */
export function profitGroupKey(query: { groupBy: readonly GroupKey[] }): ProfitGroupKey {
  const first = query.groupBy[0];
  return PROFIT_GROUP_KEYS.find((k) => k === first) ?? "project";
}

/** Audit criteria (Phase 4b): an entry matching any chosen one is a problem entry. */
export const AUDIT_CRITERIA = ["noProject", "noTask", "short", "long"] as const;
export type AuditCriterion = (typeof AUDIT_CRITERIA)[number];
/** What the Audit tab opens with: entries without a project, or longer than 10 hours. */
export const AUDIT_DEFAULT_PARAMS = "audit=noProject&audit=long";
/** zip: the receipts of the Expenses report (Phase 6c), always an export job. */
export const EXPORT_FORMATS = ["csv", "xlsx", "pdf", "zip"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_REPORTS = [
  "summary",
  "detailed",
  "weekly",
  "project-status",
  "attendance",
  "expenses",
  "receipts",
] as const;
export type ExportReport = (typeof EXPORT_REPORTS)[number];
export const EXPORT_STATUSES = ["queued", "running", "done", "failed"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/** The filter value that means "entries without one" (no project, no task, no tag). */
export const NONE_ID = "none";

const idList = z.array(z.string().min(1).max(64)).max(100).default([]);

// A span between two instants, not a date shifted by days, so milliseconds are fine; the
// hour covers a daylight-saving change inside a range of exactly MAX_DATE_RANGE_DAYS local days.
const MAX_RANGE_MS = MAX_DATE_RANGE_DAYS * 86_400_000 + 3_600_000;

export const reportQuerySchema = z
  .object({
    preset: z.enum(RANGE_PRESETS).default("this-week"),
    /** ISO instants; only read when preset is "custom". */
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    userIds: idList,
    /** User groups, expanded to their members at query time. */
    groupIds: idList,
    clientIds: idList,
    projectIds: idList,
    taskIds: idList,
    tagIds: idList,
    tagMode: z.enum(["and", "or"]).default("or"),
    billable: z.enum(["all", "yes", "no"]).default("all"),
    /** Phase 6d: time on an invoice, time not yet invoiced, or everything. */
    invoiced: z.enum(["all", "yes", "no"]).default("all"),
    /** Work entries by default (decision 6); breaks only, or everything. */
    type: z.enum(["work", "break", "all"]).default("work"),
    /** Apply the workspace rounding rule (decision 13); "off" shows raw time. */
    rounding: z.enum(["on", "off"]).default("on"),
    /** The Audit tab's criteria, combined with OR; empty means no audit filter. */
    audit: z
      .array(z.enum(AUDIT_CRITERIA))
      .max(AUDIT_CRITERIA.length)
      .refine((keys) => new Set(keys).size === keys.length, "Criteria must differ")
      .default([]),
    shortMinutes: z.coerce.number().int().min(1).max(1440).default(1),
    longHours: z.coerce.number().int().min(1).max(999).default(10),
    description: z.string().max(200).default(""),
    groupBy: z
      .array(z.enum(GROUP_KEYS))
      .min(1)
      .max(3)
      .refine((keys) => new Set(keys).size === keys.length, "Group keys must differ")
      .default(["project"]),
    bucket: z.enum(BUCKETS).optional(),
    /** The Weekly report's rows: projects, or people (team readers). */
    weeklyBy: z.enum(WEEKLY_BYS).default("project"),
    /** Expense categories (Phase 6c): the Expenses page and report. */
    categoryIds: idList,
    /** What the Expenses report groups by. */
    expenseBy: z.enum(EXPENSE_GROUP_KEYS).default("category"),
  })
  .superRefine((q, ctx) => {
    if (q.preset !== "custom") return;
    if (!q.from || !q.to) {
      ctx.addIssue({ code: "custom", path: ["from"], message: "A custom range needs its dates" });
    } else if (Date.parse(q.to) <= Date.parse(q.from)) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "The range must end after it starts" });
    } else if (Date.parse(q.to) - Date.parse(q.from) > MAX_RANGE_MS) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "Pick a range of at most one year." });
    }
  });

export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type ReportQueryInput = z.input<typeof reportQuerySchema>;

const ARRAY_KEYS = [
  "userIds",
  "groupIds",
  "clientIds",
  "projectIds",
  "taskIds",
  "tagIds",
  "groupBy",
  "audit",
  "categoryIds",
] as const;
const SCALAR_KEYS = [
  "preset",
  "from",
  "to",
  "tagMode",
  "billable",
  "invoiced",
  "type",
  "rounding",
  "shortMinutes",
  "longHours",
  "description",
  "bucket",
  "weeklyBy",
  "expenseBy",
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

/** An amount in one currency. Two currencies are never added (Phase 6: no conversion). */
export interface MoneyAmount {
  currency: string;
  amountMinor: number;
}

/** Every total is a record of measures. */
export interface ReportTotals {
  durationSeconds: number;
  billableSeconds: number;
  entryCount: number;
  /** Billable entries' amounts, in the workspace currency's minor units (0 when hidden). */
  amountMinor: number;
  /** Billable amounts in every other currency (clients billed in their own), sorted by code. */
  otherAmounts: MoneyAmount[];
  /** Billable entries without a rate, so their amount is missing. */
  unratedCount: number;
  /** What the work cost, in the workspace currency (0 when hidden). */
  costMinor: number;
  /** Work entries without a cost rate: they count as zero cost. */
  uncostedCount: number;
  /** Amount less cost over entries in the workspace currency; the rest are left out. */
  profitMinor: number;
  /** Entries billed in another currency, which profit leaves out. */
  profitExcludedCount: number;
  /** Every expense of the group (Phase 6c): a cost, in the workspace currency. Profit tab only. */
  expenseMinor: number;
  /** The billable expenses of the group: revenue. Profit tab only. */
  billableExpenseMinor: number;
}

export const EMPTY_TOTALS: ReportTotals = {
  durationSeconds: 0,
  billableSeconds: 0,
  entryCount: 0,
  amountMinor: 0,
  otherAmounts: [],
  unratedCount: 0,
  costMinor: 0,
  uncostedCount: 0,
  profitMinor: 0,
  profitExcludedCount: 0,
  expenseMinor: 0,
  billableExpenseMinor: 0,
};

/** Two lists of amounts as one: summed per currency, sorted by code. */
export function mergeAmounts(a: readonly MoneyAmount[], b: readonly MoneyAmount[]): MoneyAmount[] {
  const byCurrency = new Map<string, number>();
  for (const { currency, amountMinor } of [...a, ...b]) {
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + amountMinor);
  }
  return [...byCurrency.entries()]
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
    .map(([currency, amountMinor]) => ({ currency, amountMinor }));
}

export function addTotals(a: ReportTotals, b: ReportTotals): ReportTotals {
  return {
    durationSeconds: a.durationSeconds + b.durationSeconds,
    billableSeconds: a.billableSeconds + b.billableSeconds,
    entryCount: a.entryCount + b.entryCount,
    amountMinor: a.amountMinor + b.amountMinor,
    otherAmounts: mergeAmounts(a.otherAmounts, b.otherAmounts),
    unratedCount: a.unratedCount + b.unratedCount,
    costMinor: a.costMinor + b.costMinor,
    uncostedCount: a.uncostedCount + b.uncostedCount,
    profitMinor: a.profitMinor + b.profitMinor,
    profitExcludedCount: a.profitExcludedCount + b.profitExcludedCount,
    expenseMinor: a.expenseMinor + b.expenseMinor,
    billableExpenseMinor: a.billableExpenseMinor + b.billableExpenseMinor,
  };
}

/**
 * Profit as a percent of revenue (the billed amount plus billable expenses), to one
 * decimal; null when nothing was billed.
 */
export function marginPercent(
  t: Pick<ReportTotals, "amountMinor" | "profitMinor"> & { billableExpenseMinor?: number },
): number | null {
  const revenue = t.amountMinor + (t.billableExpenseMinor ?? 0);
  if (revenue === 0) return null;
  return Math.round((t.profitMinor * 1000) / revenue) / 10;
}

/** Totals for a viewer who may not see cost and profit: they read 0, like hidden amounts. */
export function hideCosts<T extends ReportTotals>(t: T): T {
  return {
    ...t,
    costMinor: 0,
    uncostedCount: 0,
    profitMinor: 0,
    profitExcludedCount: 0,
    expenseMinor: 0,
    billableExpenseMinor: 0,
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

function bucketBy(rows: ReportRow[], key: GroupKey) {
  const buckets = new Map<string, { value: GroupValue; rows: ReportRow[] }>();
  for (const row of rows) {
    const value = row.keys[key] ?? { id: null, label: "—" };
    const mapKey = value.id ?? NULL_ID;
    const bucket = buckets.get(mapKey) ?? { value, rows: [] };
    bucket.rows.push(row);
    buckets.set(mapKey, bucket);
  }
  return buckets;
}

const sumTotals = (rows: ReportRow[]) =>
  rows.reduce((sum, r) => addTotals(sum, r.totals), EMPTY_TOTALS);

/** `prefix`: rows grouped by the first `depth` keys without the tag join, for those levels' totals. */
function nest(
  rows: ReportRow[],
  keys: GroupKey[],
  prefix?: { rows: ReportRow[]; depth: number },
): ReportGroup[] {
  const key = keys[0];
  if (!key) return [];
  const own = prefix && prefix.depth > 0 ? bucketBy(prefix.rows, key) : null;
  return [...bucketBy(rows, key).entries()]
    .map(([mapKey, { value, rows: inner }]) => {
      const exact = own?.get(mapKey)?.rows;
      return {
        key,
        id: value.id,
        label: value.label,
        totals: exact ? sumTotals(exact) : sumTotals(inner),
        children: nest(
          inner,
          keys.slice(1),
          exact && prefix ? { rows: exact, depth: prefix.depth - 1 } : undefined,
        ),
      };
    })
    .sort(compareGroups);
}

/**
 * Nests flat SQL rows into groups, one level per key, with totals at every
 * level. The overall total is the caller's (an ungrouped aggregate): when
 * grouping by tag, an entry with two tags sits under both groups. Levels
 * above a tag level would count such an entry once per tag, so their totals
 * come from `prefixRows`: the same query grouped by the keys before the
 * first tag key, without the tag join.
 */
export function groupRows(
  rows: ReportRow[],
  keys: GroupKey[],
  totals: ReportTotals,
  prefixRows?: ReportRow[],
): { groups: ReportGroup[]; totals: ReportTotals } {
  const depth = keys.indexOf("tag");
  const prefix = prefixRows && depth > 0 ? { rows: prefixRows, depth } : undefined;
  return { groups: nest(rows, keys, prefix), totals };
}

export interface WeeklyRow {
  id: string | null;
  label: string;
  days: number[];
  total: number;
  /** The row's billable amount for the week in the workspace currency (0 when hidden). */
  amountMinor: number;
  /** Its amounts in every other currency, sorted by code. */
  otherAmounts: MoneyAmount[];
}

/** Rows (users or projects) over the week's day keys; a day without entries is 0. */
export function buildWeekly(
  rows: {
    id: string | null;
    label: string;
    dateKey: string;
    seconds: number;
    amountMinor?: number;
    otherAmounts?: readonly MoneyAmount[];
  }[],
  dayKeys: string[],
): {
  rows: WeeklyRow[];
  dayTotals: number[];
  total: number;
  amountMinor: number;
  otherAmounts: MoneyAmount[];
} {
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
      amountMinor: 0,
      otherAmounts: [],
    };
    row.days[col] = (row.days[col] ?? 0) + r.seconds;
    row.total += r.seconds;
    row.amountMinor += r.amountMinor ?? 0;
    if (r.otherAmounts?.length) row.otherAmounts = mergeAmounts(row.otherAmounts, r.otherAmounts);
    byId.set(mapKey, row);
  }
  const result = [...byId.values()].sort(
    (a, b) => b.total - a.total || a.label.localeCompare(b.label),
  );
  const dayTotals = dayKeys.map((_, i) => result.reduce((n, r) => n + (r.days[i] ?? 0), 0));
  return {
    rows: result,
    dayTotals,
    total: dayTotals.reduce((n, d) => n + d, 0),
    amountMinor: result.reduce((n, r) => n + r.amountMinor, 0),
    otherAmounts: result.reduce<MoneyAmount[]>((all, r) => mergeAmounts(all, r.otherAmounts), []),
  };
}

/** Every bucket of a range in order, empty ones included, so a series never skips a quiet day. */
export function bucketKeys(
  from: Date,
  to: Date,
  bucket: Bucket,
  prefs: Pick<ViewerPrefs, "timezone" | "weekStart">,
): { key: string; label: string }[] {
  const tz = prefs.timezone;
  const dayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
  });
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    year: "numeric",
  });
  const out: { key: string; label: string }[] = [];
  if (bucket === "day") {
    for (let d = startOfDayInZone(from, tz); d < to; d = addDaysInZone(d, 1, tz)) {
      out.push({ key: localDateKey(d, tz), label: dayLabel.format(d) });
    }
  } else if (bucket === "week") {
    for (
      let d = weekBounds(from, tz, prefs.weekStart).weekStart;
      d < to;
      d = addDaysInZone(d, 7, tz)
    ) {
      out.push({ key: localDateKey(d, tz), label: dayLabel.format(d) });
    }
  } else {
    for (
      let d = monthBoundsInZone(from, tz).monthStart;
      d < to;
      d = monthBoundsInZone(d, tz).monthEnd
    ) {
      out.push({ key: localDateKey(d, tz).slice(0, 7), label: monthLabel.format(d) });
    }
  }
  return out;
}

/**
 * The bucket key ("YYYY-MM-DD" week start or "YYYY-MM") of a local day key, matching
 * bucketKeys. Calendar arithmetic on a date, not an instant, so no time zone is involved.
 */
export function bucketKeyOfDay(dayKey: string, bucket: Bucket, weekStart: number): string {
  if (bucket === "day") return dayKey;
  if (bucket === "month") return dayKey.slice(0, 7);
  const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const back = (weekday - weekStart + 7) % 7;
  return new Date(Date.UTC(y, m - 1, d - back)).toISOString().slice(0, 10);
}

/**
 * A picked custom range kept to MAX_DATE_RANGE_DAYS local days: the end the person did not
 * just change moves. Ranges the server would refuse never reach the URL.
 */
export function clampRangeToYear(
  from: Date,
  to: Date,
  keep: "from" | "to",
  tz: string,
): { from: Date; to: Date } {
  if (keep === "from") {
    const limit = addDaysInZone(from, MAX_DATE_RANGE_DAYS, tz);
    return { from, to: to > limit ? limit : to };
  }
  const limit = addDaysInZone(to, -MAX_DATE_RANGE_DAYS, tz);
  return { from: from < limit ? limit : from, to };
}

/** One level of a report group: which key, and the group's id (null = "No …"). */
export interface DrillStep {
  key: GroupKey;
  id: string | null;
}

/**
 * The query of the Detailed report behind a group: the report's own filters narrowed to
 * every step of the path (a date, week or month narrows the range, inside the report's
 * range). A description narrows by text, as the filter does.
 */
export function drillDownQuery(
  query: ReportQuery,
  steps: DrillStep[],
  range: { from: Date; to: Date },
  prefs: Pick<ViewerPrefs, "timezone">,
): ReportQuery {
  const tz = prefs.timezone;
  const out: ReportQuery = { ...query };
  let from = range.from;
  let to = range.to;
  const narrow = (start: Date, end: Date) => {
    if (start > from) from = start;
    if (end < to) to = end;
  };
  const dayStart = (key: string) => zonedDateTimeToInstant({ date: key, hours: 0, minutes: 0 }, tz);
  for (const { key, id } of steps) {
    const ids = [id ?? NONE_ID];
    switch (key) {
      case "project":
        out.projectIds = ids;
        break;
      case "client":
        out.clientIds = ids;
        break;
      case "task":
        out.taskIds = ids;
        break;
      case "tag":
        out.tagIds = ids;
        out.tagMode = "or";
        break;
      case "user":
        if (id) out.userIds = [id];
        break;
      case "description":
        out.description = id ?? "";
        break;
      case "date":
        if (id) narrow(dayStart(id), addDaysInZone(dayStart(id), 1, tz));
        break;
      case "week":
        if (id) narrow(dayStart(id), addDaysInZone(dayStart(id), 7, tz));
        break;
      case "month":
        if (id) narrow(dayStart(`${id}-01`), monthBoundsInZone(dayStart(`${id}-01`), tz).monthEnd);
        break;
    }
  }
  return { ...out, preset: "custom", from: from.toISOString(), to: to.toISOString() };
}
