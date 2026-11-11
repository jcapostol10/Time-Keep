import type { HoursMode } from "@timekeep/core";

/** The schedule's JSON (Phase 7a): date keys and minutes only, never `Date`. */

export interface AssignmentDTO {
  /** The working id (a draft's own id); `hidden-<n>` for "Another project". */
  id: string;
  userId: string;
  /** Null: a project the viewer cannot see ("Another project"), blanked and read-only. */
  project: { id: string; name: string; color: string } | null;
  task: { id: string; name: string } | null;
  startDate: string;
  endDate: string;
  mode: HoursMode;
  minutesPerDay: number | null;
  totalMinutes: number | null;
  includeNonWorking: boolean;
  note: string;
  repeatWeeks: number | null;
  repeatUntil: string | null;
  /** Not yet published (a new assignment, or an edit of a published one). */
  draft: boolean;
  editable: boolean;
  /** Date key → minutes, inside the range read. */
  days: Record<string, number>;
}

export interface SchedulePerson {
  userId: string;
  name: string;
  /** Date key → capacity minutes (daily capacity less holidays and approved time off). */
  capacity: Record<string, number>;
  /** Date key → holiday name. */
  holidays: Record<string, string>;
  scheduledMinutes: number;
  capacityMinutes: number;
}

export interface MilestoneDTO {
  id: string;
  projectId: string;
  date: string;
  name: string;
  editable: boolean;
}

export interface ScheduleProject {
  id: string;
  name: string;
  color: string;
  /** Whoever may add milestones to it. */
  canManage: boolean;
}

export interface ScheduleDTO {
  from: string;
  to: string;
  plan: "working" | "published";
  people: SchedulePerson[];
  assignments: AssignmentDTO[];
  milestones: MilestoneDTO[];
  /** The projects shown on the project schedule: those with assignments or milestones in range. */
  projects: ScheduleProject[];
  /** Drafts the viewer would publish. */
  draftCount: number;
  lastPublishedAt: string | null;
}
