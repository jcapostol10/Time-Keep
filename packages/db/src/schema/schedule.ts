import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
import { project, task } from "./catalog";
import { timestamps } from "./columns";
import { hoursModeEnum } from "./enums";
import { workspace } from "./workspace";

/**
 * A person planned on a project (Phase 7a, decisions 1–4 and 9): local dates,
 * minutes per day or a total spread over the days it falls on, an optional
 * weekly repeat. A row is published or a draft; a draft that edits a
 * published row names it (`replaces_id`), and a draft tombstone (`deleted`)
 * removes it at the next publish. Written only by `server/schedule/*`.
 */
export const assignment = pgTable(
  "assignment",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => task.id, { onDelete: "set null" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    mode: hoursModeEnum("mode").notNull(),
    minutesPerDay: integer("minutes_per_day"),
    totalMinutes: integer("total_minutes"),
    includeNonWorking: boolean("include_non_working").notNull().default(false),
    note: text("note").notNull().default(""),
    /** Every N weeks (1–4) until `repeat_until`; null = once. */
    repeatWeeks: smallint("repeat_weeks"),
    repeatUntil: date("repeat_until"),
    published: boolean("published").notNull().default(false),
    /** A draft's published original; deleting the original deletes the draft. */
    replacesId: text("replaces_id").references((): AnyPgColumn => assignment.id, {
      onDelete: "cascade",
    }),
    /** A draft that deletes its original at the next publish. */
    deleted: boolean("deleted").notNull().default(false),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    check("assignment_dates_ck", sql`${t.endDate} >= ${t.startDate}`),
    check(
      "assignment_amount_ck",
      sql`(${t.mode} = 'PER_DAY' and ${t.minutesPerDay} is not null) or (${t.mode} = 'TOTAL' and ${t.totalMinutes} is not null)`,
    ),
    check("assignment_repeat_ck", sql`(${t.repeatWeeks} is null) = (${t.repeatUntil} is null)`),
    check(
      "assignment_tombstone_ck",
      sql`not ${t.deleted} or (${t.replacesId} is not null and not ${t.published})`,
    ),
    index("assignment_workspace_user_start_idx").on(t.workspaceId, t.userId, t.startDate),
    index("assignment_workspace_project_start_idx").on(t.workspaceId, t.projectId, t.startDate),
    uniqueIndex("assignment_replaces_uq")
      .on(t.replacesId)
      .where(sql`"replaces_id" IS NOT NULL`),
  ],
).enableRLS();

/** A date on a project's timeline, shown as a diamond on the project schedule. */
export const milestone = pgTable(
  "milestone",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    name: text("name").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("milestone_workspace_date_idx").on(t.workspaceId, t.date)],
).enableRLS();

/** One Publish: the outbox key of its emails and the "last published" line. */
export const assignmentPublish = pgTable(
  "assignment_publish",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    publishedBy: text("published_by").references(() => user.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    changedCount: integer("changed_count").notNull(),
  },
  (t) => [index("assignment_publish_workspace_idx").on(t.workspaceId, t.publishedAt)],
).enableRLS();

export type Assignment = typeof assignment.$inferSelect;
export type NewAssignment = typeof assignment.$inferInsert;
export type Milestone = typeof milestone.$inferSelect;
