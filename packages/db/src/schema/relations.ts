import { relations } from "drizzle-orm";

import { account, session, user } from "./auth";
import { project, tag, timeEntry, timeEntryTag, userSettings } from "./tracking";
import { invitation, membership, workspace, workspaceSettings } from "./workspace";

export const userRelations = relations(user, ({ many, one }) => ({
  sessions: many(session),
  accounts: many(account),
  memberships: many(membership),
  timeEntries: many(timeEntry),
  settings: one(userSettings, { fields: [user.id], references: [userSettings.userId] }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
  activeWorkspace: one(workspace, {
    fields: [session.activeWorkspaceId],
    references: [workspace.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const workspaceRelations = relations(workspace, ({ many, one }) => ({
  memberships: many(membership),
  invitations: many(invitation),
  projects: many(project),
  tags: many(tag),
  timeEntries: many(timeEntry),
  settings: one(workspaceSettings, {
    fields: [workspace.id],
    references: [workspaceSettings.workspaceId],
  }),
}));

export const membershipRelations = relations(membership, ({ one }) => ({
  workspace: one(workspace, { fields: [membership.workspaceId], references: [workspace.id] }),
  user: one(user, { fields: [membership.userId], references: [user.id] }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  workspace: one(workspace, { fields: [invitation.workspaceId], references: [workspace.id] }),
  inviter: one(user, { fields: [invitation.inviterId], references: [user.id] }),
}));

export const workspaceSettingsRelations = relations(workspaceSettings, ({ one }) => ({
  workspace: one(workspace, {
    fields: [workspaceSettings.workspaceId],
    references: [workspace.id],
  }),
}));

export const projectRelations = relations(project, ({ one, many }) => ({
  workspace: one(workspace, { fields: [project.workspaceId], references: [workspace.id] }),
  timeEntries: many(timeEntry),
}));

export const tagRelations = relations(tag, ({ one, many }) => ({
  workspace: one(workspace, { fields: [tag.workspaceId], references: [workspace.id] }),
  entries: many(timeEntryTag),
}));

export const timeEntryRelations = relations(timeEntry, ({ one, many }) => ({
  workspace: one(workspace, { fields: [timeEntry.workspaceId], references: [workspace.id] }),
  user: one(user, { fields: [timeEntry.userId], references: [user.id] }),
  project: one(project, { fields: [timeEntry.projectId], references: [project.id] }),
  tags: many(timeEntryTag),
}));

export const timeEntryTagRelations = relations(timeEntryTag, ({ one }) => ({
  entry: one(timeEntry, { fields: [timeEntryTag.timeEntryId], references: [timeEntry.id] }),
  tag: one(tag, { fields: [timeEntryTag.tagId], references: [tag.id] }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(user, { fields: [userSettings.userId], references: [user.id] }),
}));
