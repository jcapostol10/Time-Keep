import {
  char,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { timestamps } from "./columns";
import {
  durationFormatEnum,
  membershipStatusEnum,
  timeFormatEnum,
  workspaceRoleEnum,
} from "./enums";

/**
 * Tenant root. Better Auth's organization plugin is mapped onto this table
 * (`organization` → `workspace`). Every other tenant table carries `workspace_id`.
 */
export const workspace = pgTable("workspace", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  /** JSON string; reserved by Better Auth, unused by us so far. */
  metadata: text("metadata"),
  ...timestamps,
}).enableRLS();

/** Better Auth `member` → `membership`. One row per (workspace, user). */
export const membership = pgTable(
  "membership",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("member"),
    status: membershipStatusEnum("status").notNull().default("ACTIVE"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("membership_workspace_user_uq").on(t.workspaceId, t.userId),
    index("membership_workspace_id_idx").on(t.workspaceId),
    index("membership_user_id_idx").on(t.userId),
  ],
).enableRLS();

/**
 * Pending invites. A membership row is created only when the invite is accepted,
 * because the invitee may not have an account yet. The Team page renders these
 * as members with status INVITED.
 */
export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("member"),
    /** pending | accepted | rejected | canceled (Better Auth values). */
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invitation_workspace_id_idx").on(t.workspaceId),
    index("invitation_email_idx").on(t.email),
  ],
).enableRLS();

/** One row per workspace, created with the workspace. */
export const workspaceSettings = pgTable(
  "workspace_settings",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    timezone: text("timezone").notNull().default("UTC"),
    /** 0 = Sunday … 6 = Saturday */
    weekStart: smallint("week_start").notNull().default(1),
    timeFormat: timeFormatEnum("time_format").notNull().default("24h"),
    durationFormat: durationFormatEnum("duration_format").notNull().default("hh:mm:ss"),
    /** ISO 4217 */
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.workspaceId] })],
).enableRLS();

export type Workspace = typeof workspace.$inferSelect;
export type Membership = typeof membership.$inferSelect;
export type Invitation = typeof invitation.$inferSelect;
export type WorkspaceSettings = typeof workspaceSettings.$inferSelect;
