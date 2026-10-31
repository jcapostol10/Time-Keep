import {
  APPROVAL_ACTIONS,
  APPROVAL_PERIODS,
  APPROVAL_REVIEWERS,
  APPROVAL_STATUSES,
  LOCK_MODES,
  OUTBOX_STATUSES,
  CREATOR_SETTINGS,
  DURATION_FORMATS,
  ENTRY_TYPES,
  EXPORT_FORMATS,
  EXPORT_REPORTS,
  EXPORT_STATUSES,
  MEMBERSHIP_STATUSES,
  PROJECT_VISIBILITIES,
  RATE_KINDS,
  RATE_LEVELS,
  RATE_RECALC_STATUSES,
  REPORT_KINDS,
  ROLES,
  ROUNDING_MODES,
  TASK_STATUSES,
  TASK_VISIBILITY,
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
export const rateKindEnum = pgEnum("rate_kind", RATE_KINDS);
export const rateLevelEnum = pgEnum("rate_level", RATE_LEVELS);
export const rateRecalcStatusEnum = pgEnum("rate_recalc_status", RATE_RECALC_STATUSES);
export const roundingModeEnum = pgEnum("rounding_mode", ROUNDING_MODES);
export const creatorSettingEnum = pgEnum("creator_setting", CREATOR_SETTINGS);
export const entryTypeEnum = pgEnum("entry_type", ENTRY_TYPES);
export const taskVisibilityEnum = pgEnum("task_visibility", TASK_VISIBILITY);
export const approvalPeriodEnum = pgEnum("approval_period", APPROVAL_PERIODS);
export const approvalReviewersEnum = pgEnum("approval_reviewers", APPROVAL_REVIEWERS);
export const lockModeEnum = pgEnum("lock_mode", LOCK_MODES);
export const approvalStatusEnum = pgEnum("approval_status", APPROVAL_STATUSES);
export const approvalActionEnum = pgEnum("approval_action", APPROVAL_ACTIONS);
export const outboxStatusEnum = pgEnum("outbox_status", OUTBOX_STATUSES);
