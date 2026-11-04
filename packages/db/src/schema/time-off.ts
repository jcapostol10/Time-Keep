import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { timestamps } from "./columns";
import {
  targetKindEnum,
  targetPeriodEnum,
  timeOffAccrualEnum,
  timeOffStatusEnum,
  timeOffUnitEnum,
} from "./enums";
import { userGroup } from "./team";
import { workspace } from "./workspace";

/** A user or a group a policy, holiday, target rule or kiosk is assigned to (exactly one of the two). */
export function assigneeColumns() {
  return {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    groupId: text("group_id").references(() => userGroup.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  };
}
export const oneAssignee = sql`("user_id" IS NULL) <> ("group_id" IS NULL)`;

/**
 * Time off policies (Phase 5b). Amounts are hundredths of the unit
 * (`allowance_centi` 1500 = 15 days). Balances are computed, never stored.
 */
export const timeOffPolicy = pgTable(
  "time_off_policy",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    unit: timeOffUnitEnum("unit").notNull(),
    accrual: timeOffAccrualEnum("accrual").notNull(),
    allowanceCenti: integer("allowance_centi").notNull().default(0),
    allowNegative: boolean("allow_negative").notNull().default(false),
    requiresApproval: boolean("requires_approval").notNull().default(true),
    /** Assigned to everyone; otherwise to the rows of `time_off_policy_assignee`. */
    everyone: boolean("everyone").notNull().default(true),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("time_off_policy_workspace_name_uq").on(t.workspaceId, t.name)],
).enableRLS();

export const timeOffPolicyAssignee = pgTable(
  "time_off_policy_assignee",
  {
    ...assigneeColumns(),
    policyId: text("policy_id")
      .notNull()
      .references(() => timeOffPolicy.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("time_off_policy_assignee_user_uq").on(t.policyId, t.userId),
    uniqueIndex("time_off_policy_assignee_group_uq").on(t.policyId, t.groupId),
    check("time_off_policy_assignee_one_ck", oneAssignee),
  ],
).enableRLS();

/** A request for time off: inclusive local dates, one calendar year at most. */
export const timeOffRequest = pgTable(
  "time_off_request",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    policyId: text("policy_id")
      .notNull()
      .references(() => timeOffPolicy.id, { onDelete: "restrict" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    halfDay: boolean("half_day").notNull().default(false),
    /** HOURS policies: per day for one day, the total for a range. */
    minutes: integer("minutes"),
    /** What the request takes from the balance, counted when it was made. */
    amountCenti: integer("amount_centi").notNull(),
    note: text("note").notNull().default(""),
    status: timeOffStatusEnum("status").notNull(),
    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    ...timestamps,
  },
  (t) => [
    index("time_off_request_user_dates_idx").on(t.workspaceId, t.userId, t.startDate, t.endDate),
    index("time_off_request_status_idx").on(t.workspaceId, t.status, t.startDate),
  ],
).enableRLS();

/** A manual change to someone's balance, signed, counted in the year of `effective_on`. */
export const timeOffAdjustment = pgTable(
  "time_off_adjustment",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    policyId: text("policy_id")
      .notNull()
      .references(() => timeOffPolicy.id, { onDelete: "cascade" }),
    amountCenti: integer("amount_centi").notNull(),
    effectiveOn: date("effective_on").notNull(),
    note: text("note").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("time_off_adjustment_user_idx").on(t.workspaceId, t.userId, t.policyId)],
).enableRLS();

/** A holiday for the whole workspace, or for its assignees (decision 11: any country). */
export const holiday = pgTable(
  "holiday",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    name: text("name").notNull(),
    repeatsYearly: boolean("repeats_yearly").notNull().default(false),
    /** "imported: PH 2027" for rows from the dataset; null when added by hand. */
    source: text("source"),
    country: text("country"),
    /** An Islamic-calendar date computed by the dataset: confirm the proclaimed date. */
    estimated: boolean("estimated").notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("holiday_workspace_date_name_uq").on(t.workspaceId, t.date, t.name)],
).enableRLS();

export const holidayAssignee = pgTable(
  "holiday_assignee",
  {
    ...assigneeColumns(),
    holidayId: text("holiday_id")
      .notNull()
      .references(() => holiday.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("holiday_assignee_user_uq").on(t.holidayId, t.userId),
    uniqueIndex("holiday_assignee_group_uq").on(t.holidayId, t.groupId),
    check("holiday_assignee_one_ck", oneAssignee),
  ],
).enableRLS();

/** Tracked too little (UNDER) or too much (OVER) in a day or a week (decision 14). */
export const targetRule = pgTable(
  "target_rule",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    kind: targetKindEnum("kind").notNull(),
    period: targetPeriodEnum("period").notNull(),
    thresholdMinutes: smallint("threshold_minutes").notNull(),
    active: boolean("active").notNull().default(true),
    everyone: boolean("everyone").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("target_rule_workspace_idx").on(t.workspaceId)],
).enableRLS();

export const targetRuleAssignee = pgTable(
  "target_rule_assignee",
  {
    ...assigneeColumns(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => targetRule.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("target_rule_assignee_user_uq").on(t.ruleId, t.userId),
    uniqueIndex("target_rule_assignee_group_uq").on(t.ruleId, t.groupId),
    check("target_rule_assignee_one_ck", oneAssignee),
  ],
).enableRLS();

export type TimeOffPolicy = typeof timeOffPolicy.$inferSelect;
export type TimeOffRequest = typeof timeOffRequest.$inferSelect;
export type Holiday = typeof holiday.$inferSelect;
export type TargetRuleRow = typeof targetRule.$inferSelect;
