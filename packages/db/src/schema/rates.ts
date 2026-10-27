import {
  bigint,
  char,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { project, task } from "./catalog";
import { rateKindEnum, rateLevelEnum, rateRecalcStatusEnum } from "./enums";
import { workspace } from "./workspace";

/**
 * One row per level and effective date; rows are never edited, so the table
 * is the history. The row in force for an entry is the latest one with
 * `effective_from <= entry.start`. `amount_minor IS NULL` means "no rate at
 * this level from this date" (resolution falls through to the next level).
 *
 * Which target columns a level uses: workspace none; member user_id; project
 * project_id; project_member project_id + user_id; task project_id + task_id.
 */
export const rate = pgTable(
  "rate",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    kind: rateKindEnum("kind").notNull().default("billable"),
    level: rateLevelEnum("level").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => project.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => task.id, { onDelete: "cascade" }),
    /** Minor units per hour; null = no rate at this level from this date. */
    amountMinor: bigint("amount_minor", { mode: "number" }),
    /** ISO 4217 */
    currency: char("currency", { length: 3 }).notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("rate_level_target_from_uq")
      .on(t.workspaceId, t.kind, t.level, t.userId, t.projectId, t.taskId, t.effectiveFrom)
      .nullsNotDistinct(),
    index("rate_lookup_idx").on(
      t.workspaceId,
      t.kind,
      t.level,
      t.projectId,
      t.taskId,
      t.userId,
      t.effectiveFrom.desc(),
    ),
  ],
).enableRLS();

/**
 * "Apply to past entries": re-rates live entries with `start >= from` in
 * keyset batches after the response. `cursor_*` is the last entry done, so a
 * killed run resumes there on Retry.
 */
export const rateRecalcJob = pgTable(
  "rate_recalc_job",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    from: timestamp("from", { withTimezone: true }).notNull(),
    status: rateRecalcStatusEnum("status").notNull().default("queued"),
    total: integer("total"),
    processed: integer("processed").notNull().default(0),
    cursorStart: timestamp("cursor_start", { withTimezone: true }),
    cursorId: text("cursor_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("rate_recalc_job_workspace_created_idx").on(t.workspaceId, t.createdAt.desc())],
).enableRLS();

export type Rate = typeof rate.$inferSelect;
export type RateRecalcJob = typeof rateRecalcJob.$inferSelect;
