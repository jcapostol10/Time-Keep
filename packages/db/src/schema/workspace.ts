import { sql } from "drizzle-orm";
import {
  boolean,
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
  creatorSettingEnum,
  durationFormatEnum,
  membershipStatusEnum,
  roundingModeEnum,
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
    // Phase 4b rules. Every default reproduces the behaviour before the rule existed;
    // core's workspace-rules.ts reads them (unknown stored values fall back there).
    /** Report rounding (reports, exports and share links only). */
    roundingMode: roundingModeEnum("rounding_mode").notNull().default("off"),
    roundingMinutes: smallint("rounding_minutes").notNull().default(15),
    /** Pages hidden from members: "projects" | "team" | "reports". */
    hiddenPages: text("hidden_pages")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Members see everyone's time in reports and the dashboard (durations only). */
    membersSeeTeamTime: boolean("members_see_team_time").notNull().default(false),
    projectCreators: creatorSettingEnum("project_creators").notNull().default("admins"),
    clientCreators: creatorSettingEnum("client_creators").notNull().default("admins"),
    taskCreators: creatorSettingEnum("task_creators").notNull().default("admins"),
    tagCreators: creatorSettingEnum("tag_creators").notNull().default("admins"),
    /** Fields an entry needs before it is stopped or saved: project | task | tag | description. */
    requiredFields: text("required_fields")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Members and managers track with the timer only (decision 7). */
    forceTimer: boolean("force_timer").notNull().default(false),
    /** Break entries may be tracked (decision 6). */
    allowBreaks: boolean("allow_breaks").notNull().default(false),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.workspaceId] })],
).enableRLS();

export type Workspace = typeof workspace.$inferSelect;
export type Membership = typeof membership.$inferSelect;
export type Invitation = typeof invitation.$inferSelect;
export type WorkspaceSettings = typeof workspaceSettings.$inferSelect;
