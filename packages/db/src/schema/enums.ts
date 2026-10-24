import {
  DURATION_FORMATS,
  EXPORT_FORMATS,
  EXPORT_REPORTS,
  EXPORT_STATUSES,
  MEMBERSHIP_STATUSES,
  PROJECT_VISIBILITIES,
  REPORT_KINDS,
  ROLES,
  TASK_STATUSES,
  TIME_FORMATS,
} from "@timekeep/core";
import { pgEnum } from "drizzle-orm/pg-core";

export const workspaceRoleEnum = pgEnum("workspace_role", ROLES);
export const membershipStatusEnum = pgEnum("membership_status", MEMBERSHIP_STATUSES);
export const timeFormatEnum = pgEnum("time_format", TIME_FORMATS);
export const durationFormatEnum = pgEnum("duration_format", DURATION_FORMATS);
export const projectVisibilityEnum = pgEnum("project_visibility", PROJECT_VISIBILITIES);
export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);
export const reportKindEnum = pgEnum("report_kind", REPORT_KINDS);
export const exportFormatEnum = pgEnum("export_format", EXPORT_FORMATS);
export const exportReportEnum = pgEnum("export_report", EXPORT_REPORTS);
export const exportStatusEnum = pgEnum("export_status", EXPORT_STATUSES);
