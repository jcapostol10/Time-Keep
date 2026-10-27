import { index, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { project } from "./catalog";
import { timestamps } from "./columns";
import { invitation, workspace } from "./workspace";

/** A named set of people: used for private-project access, report filters and manager scope. */
export const userGroup = pgTable(
  "user_group",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("user_group_workspace_name_uq").on(t.workspaceId, t.name),
    index("user_group_workspace_id_idx").on(t.workspaceId),
  ],
).enableRLS();

export const userGroupMember = pgTable(
  "user_group_member",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => userGroup.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index("user_group_member_user_id_idx").on(t.userId),
  ],
).enableRLS();

/** A group with access to a PRIVATE project: its members see and track on it. */
export const projectGroup = pgTable(
  "project_group",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    groupId: text("group_id")
      .notNull()
      .references(() => userGroup.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.groupId] }),
    index("project_group_group_id_idx").on(t.groupId),
  ],
).enableRLS();

/** A person a manager manages directly ("Team Manager"). */
export const managedUser = pgTable(
  "managed_user",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    managerId: text("manager_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.managerId, t.userId] })],
).enableRLS();

/** A group a manager manages: its members, as they are now, are in the manager's scope. */
export const managedGroup = pgTable(
  "managed_group",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    managerId: text("manager_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    groupId: text("group_id")
      .notNull()
      .references(() => userGroup.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.managerId, t.groupId] }),
    index("managed_group_group_id_idx").on(t.groupId),
  ],
).enableRLS();

/**
 * Groups an invitee joins on acceptance. Separate from `invitation`, which
 * belongs to Better Auth.
 */
export const invitationGroup = pgTable(
  "invitation_group",
  {
    invitationId: text("invitation_id")
      .notNull()
      .references(() => invitation.id, { onDelete: "cascade" }),
    groupId: text("group_id")
      .notNull()
      .references(() => userGroup.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.invitationId, t.groupId] })],
).enableRLS();

export type UserGroup = typeof userGroup.$inferSelect;
export type UserGroupMember = typeof userGroupMember.$inferSelect;
export type ProjectGroup = typeof projectGroup.$inferSelect;
export type ManagedUser = typeof managedUser.$inferSelect;
export type ManagedGroup = typeof managedGroup.$inferSelect;
