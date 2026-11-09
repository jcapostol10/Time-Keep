import type {
  AttendanceDay,
  AttendanceWeek,
  Bucket,
  Capacity,
  DetailedEntry,
  ExpenseGroupKey,
  ExpenseTotals,
  GroupKey,
  MoneyAmount,
  Progress,
  ReportGroup,
  ReportTotals,
  RoundingRule,
  WeeklyBy,
  WeeklyRow,
} from "@timekeep/core";

import type { EntryTag, PickerProject } from "./tracker-types";

/** What crosses the server boundary for reports: JSON with ISO strings, never Date. */

export interface SeriesPoint {
  key: string;
  label: string;
  billableSeconds: number;
  nonBillableSeconds: number;
}

/**
 * The workspace currency (amountMinor, cost and profit are in it; amounts
 * billed in other currencies sit in otherAmounts), and whether the viewer may
 * see cost and profit (0 otherwise). null when the viewer may not see amounts
 * at all: they are 0 too.
 */
export type ReportMoney = { currency: string; costs: boolean } | null;

export interface SummaryReport {
  money: ReportMoney;
  range: { from: string; to: string; label: string };
  bucket: Bucket;
  series: SeriesPoint[];
  groupBy: GroupKey[];
  groups: ReportGroup[];
  totals: ReportTotals;
  /**
   * Budget progress by project id (Phase 6b) when the report is grouped by
   * project and the viewer may see it; null otherwise, and always on a share link.
   */
  progress: Record<string, Progress> | null;
}

/** A Detailed row: the export columns plus what inline editing needs. */
export interface DetailedEntryDTO extends DetailedEntry {
  userId: string;
  projectId: string | null;
  projectColor: string | null;
  taskId: string | null;
  tagIds: string[];
  /** The viewer may edit it: their own, or a person they may add time for. */
  editable: boolean;
  /** `editable` and the times too: force timer keeps the owner's own times to the timer. */
  timesEditable: boolean;
  /** A kiosk clock-in photo exists; only for viewers who manage kiosks (ruling R6). */
  photo: boolean;
}

export type DetailedSort = "start" | "duration";

export interface DetailedCursor {
  /** The sort column's value of the last row (ISO start or duration seconds as text). */
  value: string;
  id: string;
}

export interface DetailedPage {
  money: ReportMoney;
  range: { from: string; to: string; label: string };
  entries: DetailedEntryDTO[];
  nextCursor: DetailedCursor | null;
  /** The whole range's totals, on the first page only (null with a cursor). */
  totals: ReportTotals | null;
}

export type { WeeklyBy };

export interface WeeklyReport {
  money: ReportMoney;
  /** The week's billable amount in the workspace currency (0 when hidden). */
  amountMinor: number;
  /** The week's amounts in every other currency. */
  otherAmounts: MoneyAmount[];
  weekStart: string;
  dayKeys: string[];
  by: WeeklyBy;
  rows: WeeklyRow[];
  dayTotals: number[];
  total: number;
}

export interface ReportFilterOptions {
  /** null for members: they only ever see their own time. */
  users: { id: string; name: string }[] | null;
  /** null for members, like users. */
  groups: { id: string; name: string }[] | null;
  clients: { id: string; name: string }[];
  projects: PickerProject[];
  tasks: { id: string; name: string; projectId: string }[];
  tags: EntryTag[];
  /** The workspace rounding rule, or null when off: the toolbar shows a toggle only then. */
  rounding: RoundingRule | null;
}

export interface DetailedPaging {
  sort: DetailedSort;
  dir: "asc" | "desc";
  limit: number;
}

/** The key part that identifies a Detailed listing: the query and how it is paged. */
export function detailedKey(params: string, paging: DetailedPaging): string {
  return `${params}|${paging.sort}|${paging.dir}|${paging.limit}`;
}

/** The Attendance tab (Phase 5b): each person's own days, weekly subtotals and a total. */
export interface AttendancePerson {
  userId: string;
  userName: string;
  /** Their own timezone: their days and first-in, last-out times are local to it. */
  timezone: string;
  capacity: Capacity;
  days: AttendanceDay[];
  weeks: AttendanceWeek[];
  totals: AttendanceWeek;
}

export interface AttendanceReport {
  /** Inclusive date keys in the viewer's timezone. */
  from: string;
  to: string;
  label: string;
  people: AttendancePerson[];
}

/** The Expenses tab (Phase 6c): totals by category, project or person, in the workspace currency. */
export interface ExpenseReport {
  currency: string;
  range: { from: string; to: string; label: string };
  by: ExpenseGroupKey;
  /** Sorted by amount, then label. */
  groups: { id: string | null; label: string; totals: ExpenseTotals }[];
  totals: ExpenseTotals;
}
