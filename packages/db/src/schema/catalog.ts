import {
  boolean,
  char,
  index,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { timestamps } from "./columns";
import { projectVisibilityEnum, taskStatusEnum } from "./enums";
import { workspace } from "./workspace";

/** The companies time is tracked for. Projects hang off a client or stand alone. */
export const client = pgTable(
  "client",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address").notNull().default(""),
    email: text("email").notNull().default(""),
    notes: text("notes").notNull().default(""),
    /** ISO 4217; reserved for invoicing (Phase 6). */
    currency: char("currency", { length: 3 }),
    archived: boolean("archived").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("client_workspace_name_uq").on(t.workspaceId, t.name),
    index("client_workspace_id_idx").on(t.workspaceId),
  ],
).enableRLS();

/**
 * A project: name unique within its client (projects without a client count
 * as one group, hence NULLS NOT DISTINCT). PRIVATE projects are visible only
 * to admins and the users in `project_member`. Archived projects keep their
 * entries but take no new time.
 */
export const project = pgTable(
  "project",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** `#rrggbb` from the core palette */
    color: text("color").notNull(),
    clientId: text("client_id").references(() => client.id, { onDelete: "restrict" }),
    /** Default for new entries on this project. */
    billable: boolean("billable").notNull().default(true),
    visibility: projectVisibilityEnum("visibility").notNull().default("PUBLIC"),
    note: text("note").notNull().default(""),
    archived: boolean("archived").notNull().default(false),
    /** Used by Phase 4 to clone projects. */
    isTemplate: boolean("is_template").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique("project_workspace_client_name_uq")
      .on(t.workspaceId, t.clientId, t.name)
      .nullsNotDistinct(),
    index("project_workspace_id_idx").on(t.workspaceId),
    index("project_client_id_idx").on(t.clientId),
  ],
).enableRLS();

/** Who may see and track on a PRIVATE project. Phase 4 adds user groups. */
export const projectMember = pgTable(
  "project_member",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("project_member_user_id_idx").on(t.userId),
  ],
).enableRLS();

/** Per-user favourite projects: starred in the list, first in the picker. */
export const projectFavorite = pgTable(
  "project_favorite",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("project_favorite_user_id_idx").on(t.userId),
  ],
).enableRLS();

/** A task within a project. DONE tasks keep their entries but take no new time. */
export const task = pgTable(
  "task",
  {
    id: text("id").primaryKey(),
    /** Denormalised from the project so every query stays workspace-scoped. */
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: taskStatusEnum("status").notNull().default("ACTIVE"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("task_project_name_uq").on(t.projectId, t.name),
    index("task_project_id_idx").on(t.projectId),
    index("task_workspace_id_idx").on(t.workspaceId),
  ],
).enableRLS();

/** Informational in Phase 2; Phase 4 may restrict tracking to assignees. */
export const taskAssignee = pgTable(
  "task_assignee",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.userId] }),
    index("task_assignee_user_id_idx").on(t.userId),
  ],
).enableRLS();

/** Labels on entries. Archived tags stay on entries but cannot be added. */
export const tag = pgTable(
  "tag",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    archived: boolean("archived").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("tag_workspace_name_uq").on(t.workspaceId, t.name),
    index("tag_workspace_id_idx").on(t.workspaceId),
  ],
).enableRLS();

export type Client = typeof client.$inferSelect;
export type Project = typeof project.$inferSelect;
export type ProjectMember = typeof projectMember.$inferSelect;
export type ProjectFavorite = typeof projectFavorite.$inferSelect;
export type Task = typeof task.$inferSelect;
export type TaskAssignee = typeof taskAssignee.$inferSelect;
export type Tag = typeof tag.$inferSelect;
