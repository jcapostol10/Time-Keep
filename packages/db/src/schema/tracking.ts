import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { project, tag, task } from "./catalog";
import { timestamps } from "./columns";
import { workspace } from "./workspace";

/**
 * A tracked block of time. `end IS NULL` means the timer is running; the
 * partial unique index below enforces invariant 4 (one running timer per user
 * per workspace). Soft-deleted rows keep `deleted_at` and are excluded from the
 * index so a deleted running entry can never block a new timer.
 */
export const timeEntry = pgTable(
  "time_entry",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    description: text("description").notNull().default(""),
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    taskId: text("task_id").references(() => task.id, { onDelete: "set null" }),
    billable: boolean("billable").notNull().default(false),
    start: timestamp("start", { withTimezone: true }).notNull(),
    /** null = running */
    end: timestamp("end", { withTimezone: true }),
    /** Set when the entry stops or is edited; null while running. */
    durationSeconds: integer("duration_seconds"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("time_entry_workspace_user_start_idx").on(t.workspaceId, t.userId, t.start.desc()),
    index("time_entry_project_id_idx").on(t.projectId),
    index("time_entry_task_id_idx").on(t.taskId),
    uniqueIndex("time_entry_one_running_uq")
      .on(t.workspaceId, t.userId)
      .where(sql`"end" IS NULL AND "deleted_at" IS NULL`),
  ],
).enableRLS();

export const timeEntryTag = pgTable(
  "time_entry_tag",
  {
    timeEntryId: text("time_entry_id")
      .notNull()
      .references(() => timeEntry.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.timeEntryId, t.tagId] }),
    index("time_entry_tag_tag_id_idx").on(t.tagId),
  ],
).enableRLS();

/** Per-user tracker preferences (idle detection, Pomodoro, reminders). Row is created lazily. */
export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** null = idle detection off */
  idleDetectionMinutes: smallint("idle_detection_minutes"),
  pomodoroEnabled: boolean("pomodoro_enabled").notNull().default(false),
  pomodoroFocusMinutes: smallint("pomodoro_focus_minutes").notNull().default(25),
  pomodoroBreakMinutes: smallint("pomodoro_break_minutes").notNull().default(5),
  remindersEnabled: boolean("reminders_enabled").notNull().default(false),
  /** 0 = Sunday … 6 = Saturday */
  reminderDays: smallint("reminder_days")
    .array()
    .notNull()
    .default(sql`'{1,2,3,4,5}'::smallint[]`),
  /** Minutes since local midnight. */
  reminderStartMinutes: smallint("reminder_start_minutes").notNull().default(540),
  reminderEndMinutes: smallint("reminder_end_minutes").notNull().default(1020),
  /** The test-email limit (core test-email.ts): the last send and how many that day. */
  testEmailSentAt: timestamp("test_email_sent_at", { withTimezone: true }),
  testEmailCount: smallint("test_email_count").notNull().default(0),
  ...timestamps,
}).enableRLS();

/** One timesheet row: the details new entries from that row get. */
export interface TimesheetTemplateRow {
  projectId: string | null;
  taskId: string | null;
  description: string;
}

/** A user's saved set of timesheet rows, applied to any week. */
export const timesheetTemplate = pgTable(
  "timesheet_template",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rows: jsonb("rows")
      .$type<TimesheetTemplateRow[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("timesheet_template_user_name_uq").on(t.workspaceId, t.userId, t.name),
    index("timesheet_template_user_idx").on(t.workspaceId, t.userId),
  ],
).enableRLS();

export type TimeEntry = typeof timeEntry.$inferSelect;
export type NewTimeEntry = typeof timeEntry.$inferInsert;
export type TimeEntryTag = typeof timeEntryTag.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type TimesheetTemplate = typeof timesheetTemplate.$inferSelect;
