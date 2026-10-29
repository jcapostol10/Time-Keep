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
}

export interface ProjectDetail extends ProjectListItem {
  memberIds: string[];
}

export interface ProjectStatus {
  from: string;
  to: string;
  /** Time per week of the range when it is longer than a month; null otherwise. */
  weeks: { key: string; label: string; seconds: number }[] | null;
  byTask: { taskId: string | null; name: string; seconds: number; amountMinor: number }[];
  byMember: { userId: string; name: string; seconds: number; amountMinor: number }[];
  /** The currency amounts are in; null when the viewer may not see them (amounts are 0). */
  money: { currency: string } | null;
  amountMinor: number;
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
