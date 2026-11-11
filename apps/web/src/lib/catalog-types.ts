import type { Estimate, Forecast, MoneyAmount, Progress } from "@timekeep/core";

/**
 * Isomorphic DTOs for clients, projects, tasks and tags. Like the tracker
 * DTOs, everything crossing the server/client boundary is JSON-safe.
 */

export interface ClientDTO {
  id: string;
  name: string;
  address: string;
  email: string;
  notes: string;
  /** ISO 4217; reserved for invoicing (Phase 6). */
  currency: string | null;
  archived: boolean;
  projectCount: number;
}

export interface ProjectListItem {
  id: string;
  name: string;
  color: string;
  clientId: string | null;
  clientName: string | null;
  billable: boolean;
  visibility: "PUBLIC" | "PRIVATE";
  archived: boolean;
  isTemplate: boolean;
  note: string;
  favorite: boolean;
  /** Everyone's time for admins; the viewer's own time for members. */
  trackedSeconds: number;
  memberCount: number;
  /** The project's one estimate (Phase 6b). */
  estimate: Estimate;
  /** Its progress this period, when there is an estimate and the viewer may see it. */
  progress: Progress | null;
}

export interface ProjectDetail extends ProjectListItem {
  memberIds: string[];
  /** What the project bills in: its client's currency, else the workspace's. */
  currency: string;
}

/** The Budget tab (Phase 6b). */
export interface BudgetDTO {
  estimate: Estimate;
  currency: string;
  /** Phase 7b: tracked plus the published plan against the estimate; null without one. */
  forecast: Forecast | null;
  /** The workspace's alert thresholds, whole percents ascending. */
  thresholds: number[];
  progress: Progress | null;
  /** A billable rate is in force for the project in its currency (a money estimate can fill). */
  hasRates: boolean;
  /** The cumulative measure over the period, one point per day (weekly past two months). */
  series: { key: string; label: string; value: number }[];
  /** The tasks with an estimate. */
  tasks: {
    id: string;
    name: string;
    status: TaskDTO["status"];
    estimateSeconds: number;
    trackedSeconds: number;
  }[];
}

export interface ProjectStatus {
  from: string;
  to: string;
  /** Time per week of the range when it is longer than a month; null otherwise. */
  weeks: { key: string; label: string; seconds: number }[] | null;
  byTask: {
    taskId: string | null;
    name: string;
    seconds: number;
    amountMinor: number;
    otherAmounts: MoneyAmount[];
  }[];
  byMember: {
    userId: string;
    name: string;
    seconds: number;
    amountMinor: number;
    otherAmounts: MoneyAmount[];
  }[];
  /** As a report's: the workspace currency and whether cost shows; null when amounts are hidden. */
  money: { currency: string; costs: boolean } | null;
  amountMinor: number;
  /** Amounts in other currencies (a project billed in its client's). */
  otherAmounts: MoneyAmount[];
  /** Cost and profit in the workspace currency (0 for viewers who may not see them). */
  costMinor: number;
  uncostedCount: number;
  profitMinor: number;
  profitExcludedCount: number;
  billableSeconds: number;
  nonBillableSeconds: number;
  totalSeconds: number;
}

export interface TaskDTO {
  id: string;
  projectId: string;
  name: string;
  status: "ACTIVE" | "DONE";
  /** Kept for the data; no longer edited or read for access (decision 11). */
  assigneeIds: string[];
  /** The groups whose members see and track on the task when tasks are by group. */
  groupIds: string[];
  trackedSeconds: number;
  /** Live entries on the task; the delete dialog says how many lose it. */
  entryCount: number;
  /** An optional time estimate (Phase 6b). */
  estimateSeconds: number | null;
}

/** The tasks a group gives, or a person can see: the Team page's lists (decision 11). */
export interface TaskAccessDTO {
  byProject: {
    projectId: string;
    projectName: string;
    tasks: { id: string; name: string; groupNames: string[] }[];
  }[];
}

/** One saved set of timesheet rows. */
export interface TimesheetTemplateDTO {
  id: string;
  name: string;
  rows: { projectId: string | null; taskId: string | null; description: string }[];
}

export interface TagDTO {
  id: string;
  name: string;
  color: string;
  archived: boolean;
  /** Entries (not deleted) carrying the tag. */
  usageCount: number;
}
