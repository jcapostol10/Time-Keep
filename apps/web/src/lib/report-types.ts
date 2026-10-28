import type {
  Bucket,
  DetailedEntry,
  GroupKey,
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

/** The currency amounts are in; null when the viewer may not see amounts (they are 0). */
export type ReportMoney = { currency: string } | null;

export interface SummaryReport {
  money: ReportMoney;
  range: { from: string; to: string; label: string };
  bucket: Bucket;
  series: SeriesPoint[];
  groupBy: GroupKey[];
  groups: ReportGroup[];
  totals: ReportTotals;
}

/** A Detailed row: the export columns plus what inline editing needs. */
export interface DetailedEntryDTO extends DetailedEntry {
  userId: string;
  projectId: string | null;
  projectColor: string | null;
  taskId: string | null;
  tagIds: string[];
  /** The viewer's own entry (Phase 4 opens others' up). */
  editable: boolean;
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
  /** The week's billable amount (0 when hidden). */
  amountMinor: number;
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
