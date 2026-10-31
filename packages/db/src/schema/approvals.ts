import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { timestamps } from "./columns";
import { approvalActionEnum, approvalStatusEnum, outboxStatusEnum } from "./enums";
import { workspace } from "./workspace";

/**
 * A person's period submitted for approval (Phase 5a). Periods never overlap
 * for one person; `period_start`/`period_end` are inclusive local dates in the
 * workspace timezone. The totals are a snapshot taken at submission.
 */
export const approvalRequest = pgTable(
  "approval_request",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: approvalStatusEnum("status").notNull(),
    workSeconds: bigint("work_seconds", { mode: "number" }).notNull().default(0),
    billableSeconds: bigint("billable_seconds", { mode: "number" }).notNull().default(0),
    entryCount: integer("entry_count").notNull().default(0),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** The reviewer's note: why it was rejected or reopened. */
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("approval_request_user_start_uq").on(t.workspaceId, t.userId, t.periodStart),
    // assertWritable: "a PENDING or APPROVED request of this person covering this date".
    index("approval_request_cover_idx").on(t.workspaceId, t.userId, t.periodStart, t.periodEnd),
    // The Approvals page.
    index("approval_request_status_idx").on(t.workspaceId, t.status, t.periodStart),
  ],
).enableRLS();

/** The request's history, and the notes of owners' and admins' edits of submitted time. */
export const approvalEvent = pgTable(
  "approval_event",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    /** Null once a withdrawn request is gone; the event stays. */
    requestId: text("request_id").references(() => approvalRequest.id, { onDelete: "set null" }),
    /** Whose period. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    action: approvalActionEnum("action").notNull(),
    note: text("note"),
    /** ADMIN_EDIT: the entry changed (no foreign key: the entry may be deleted later). */
    entryId: text("entry_id"),
    /** ADMIN_EDIT: `{ field: { from, to } }`. */
    changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("approval_event_user_created_idx").on(t.workspaceId, t.userId, t.createdAt),
    index("approval_event_request_idx").on(t.requestId),
  ],
).enableRLS();

/**
 * Every email the app sends (Phase 5a decision 1): written in the same
 * transaction as its cause, rendered at enqueue time, drained after the
 * request, by the daily cron and by the local worker.
 */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").references(() => workspace.id, { onDelete: "cascade" }),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    /** What it is, e.g. "approval.submitted"; reminders carry their period for idempotency. */
    kind: text("kind").notNull(),
    status: outboxStatusEnum("status").notNull().default("PENDING"),
    attempts: smallint("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    index("email_outbox_due_idx").on(t.status, t.nextAttemptAt),
    index("email_outbox_kind_idx").on(t.workspaceId, t.kind),
  ],
).enableRLS();

export type ApprovalRequest = typeof approvalRequest.$inferSelect;
export type ApprovalEvent = typeof approvalEvent.$inferSelect;
export type EmailOutbox = typeof emailOutbox.$inferSelect;
