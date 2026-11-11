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
  ESTIMATE_KINDS,
  ESTIMATE_RESETS,
  HOURS_MODES,
  EXPENSE_CATEGORY_KINDS,
  EXPORT_FORMATS,
  INVOICE_LINE_KINDS,
  INVOICE_STATUSES,
  RECURRING_MODES,
  RECURRING_SCHEDULES,
  EXPORT_REPORTS,
  EXPORT_STATUSES,
  KIOSK_ATTEMPT_METHODS,
  MEMBERSHIP_STATUSES,
  PROJECT_VISIBILITIES,
  RATE_KINDS,
  RATE_LEVELS,
  RATE_RECALC_STATUSES,
  REPORT_KINDS,
  ROLES,
  ROUNDING_MODES,
  TASK_STATUSES,
  TARGET_KINDS,
  TARGET_PERIODS,
  TASK_VISIBILITY,
  TIME_FORMATS,
  TIME_OFF_ACCRUALS,
  TIME_OFF_STATUSES,
  TIME_OFF_UNITS,
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
export const timeOffUnitEnum = pgEnum("time_off_unit", TIME_OFF_UNITS);
export const timeOffAccrualEnum = pgEnum("time_off_accrual", TIME_OFF_ACCRUALS);
export const timeOffStatusEnum = pgEnum("time_off_status", TIME_OFF_STATUSES);
export const targetKindEnum = pgEnum("target_kind", TARGET_KINDS);
export const targetPeriodEnum = pgEnum("target_period", TARGET_PERIODS);
export const kioskAttemptMethodEnum = pgEnum("kiosk_attempt_method", KIOSK_ATTEMPT_METHODS);
export const estimateKindEnum = pgEnum("estimate_kind", ESTIMATE_KINDS);
export const estimateResetEnum = pgEnum("estimate_reset", ESTIMATE_RESETS);
export const expenseCategoryKindEnum = pgEnum("expense_category_kind", EXPENSE_CATEGORY_KINDS);
export const invoiceStatusEnum = pgEnum("invoice_status", INVOICE_STATUSES);
export const invoiceItemKindEnum = pgEnum("invoice_item_kind", INVOICE_LINE_KINDS);
export const recurringScheduleEnum = pgEnum("recurring_schedule", RECURRING_SCHEDULES);
export const recurringModeEnum = pgEnum("recurring_mode", RECURRING_MODES);
export const hoursModeEnum = pgEnum("hours_mode", HOURS_MODES);
