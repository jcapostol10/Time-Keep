import type {
  Bucket,
  DetailedEntry,
  GroupKey,
  ReportGroup,
  ReportTotals,
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

export interface SummaryReport {
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
  range: { from: string; to: string; label: string };
  entries: DetailedEntryDTO[];
  nextCursor: DetailedCursor | null;
  /** The whole range's totals, on the first page only (null with a cursor). */
  totals: ReportTotals | null;
}

export type { WeeklyBy };

export interface WeeklyReport {
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
