import {
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { project, task } from "./catalog";
import { timestamps } from "./columns";
import { kioskAttemptMethodEnum } from "./enums";
import { assigneeColumns, oneAssignee } from "./time-off";
import { timeEntry } from "./tracking";
import { workspace } from "./workspace";

/**
 * Kiosks (Phase 5c): a shared device at `/kiosk/<token>`. Only the token's
 * sha256 is stored; rotating it moves `token_rotated_at`, which retires every
 * punch ticket issued before.
 */
export const kiosk = pgTable(
  "kiosk",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenRotatedAt: timestamp("token_rotated_at", { withTimezone: true }).notNull().defaultNow(),
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    taskId: text("task_id").references(() => task.id, { onDelete: "set null" }),
    /** Allowed to everyone; otherwise to the rows of `kiosk_assignee`. */
    everyone: boolean("everyone").notNull().default(true),
    sessionTimeoutSeconds: smallint("session_timeout_seconds").notNull().default(15),
    showLogo: boolean("show_logo").notNull().default(true),
    /** Take a photo at clock in (Pro; `planAllows(…, "kioskPhoto")`). */
    photo: boolean("photo").notNull().default(false),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("kiosk_token_hash_uq").on(t.tokenHash),
    index("kiosk_workspace_id_idx").on(t.workspaceId),
  ],
).enableRLS();

export const kioskAssignee = pgTable(
  "kiosk_assignee",
  {
    ...assigneeColumns(),
    kioskId: text("kiosk_id")
      .notNull()
      .references(() => kiosk.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("kiosk_assignee_user_uq").on(t.kioskId, t.userId),
    uniqueIndex("kiosk_assignee_group_uq").on(t.kioskId, t.groupId),
    check("kiosk_assignee_one_ck", oneAssignee),
  ],
).enableRLS();

/** A person's kiosk PIN (scrypt hash) and QR token (sha256), per workspace. */
export const kioskCredential = pgTable(
  "kiosk_credential",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pinHash: text("pin_hash"),
    pinSetAt: timestamp("pin_set_at", { withTimezone: true }),
    qrTokenHash: text("qr_token_hash"),
    qrRotatedAt: timestamp("qr_rotated_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("kiosk_credential_workspace_user_uq").on(t.workspaceId, t.userId),
    uniqueIndex("kiosk_credential_qr_token_hash_uq").on(t.qrTokenHash),
  ],
).enableRLS();

/** Every PIN or QR check on a kiosk, for the throttles; deleted after a day. */
export const kioskAttempt = pgTable(
  "kiosk_attempt",
  {
    id: text("id").primaryKey(),
    kioskId: text("kiosk_id")
      .notNull()
      .references(() => kiosk.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    method: kioskAttemptMethodEnum("method").notNull(),
    success: boolean("success").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("kiosk_attempt_kiosk_created_idx").on(t.kioskId, t.createdAt),
    index("kiosk_attempt_kiosk_user_created_idx").on(t.kioskId, t.userId, t.createdAt),
  ],
).enableRLS();

/** A clock-in photo in the private bucket; deleted after 90 days. */
export const kioskPhoto = pgTable(
  "kiosk_photo",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    entryId: text("entry_id")
      .notNull()
      .references(() => timeEntry.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("kiosk_photo_entry_uq").on(t.entryId),
    index("kiosk_photo_taken_at_idx").on(t.takenAt),
  ],
).enableRLS();

export type Kiosk = typeof kiosk.$inferSelect;
export type KioskCredential = typeof kioskCredential.$inferSelect;
