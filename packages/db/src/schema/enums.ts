import {
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
