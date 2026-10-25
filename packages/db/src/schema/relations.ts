import { relations } from "drizzle-orm";

import { account, session, user } from "./auth";
import {
  client,
  project,
  projectFavorite,
  projectMember,
  tag,
  task,
  taskAssignee,
} from "./catalog";
import { timeEntry, timeEntryTag, timesheetTemplate, userSettings } from "./tracking";
import { exportJob, reportShareLink } from "./reports";
import { invitation, membership, workspace, workspaceSettings } from "./workspace";

export const userRelations = relations(user, ({ many, one }) => ({
  sessions: many(session),
  accounts: many(account),
  memberships: many(membership),
  timeEntries: many(timeEntry),
  projectMemberships: many(projectMember),
  projectFavorites: many(projectFavorite),
  taskAssignments: many(taskAssignee),
  timesheetTemplates: many(timesheetTemplate),
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
  clients: many(client),
  projects: many(project),
  tasks: many(task),
  tags: many(tag),
  timeEntries: many(timeEntry),
  timesheetTemplates: many(timesheetTemplate),
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

export const clientRelations = relations(client, ({ one, many }) => ({
  workspace: one(workspace, { fields: [client.workspaceId], references: [workspace.id] }),
  projects: many(project),
}));

export const projectRelations = relations(project, ({ one, many }) => ({
  workspace: one(workspace, { fields: [project.workspaceId], references: [workspace.id] }),
  client: one(client, { fields: [project.clientId], references: [client.id] }),
  members: many(projectMember),
  favorites: many(projectFavorite),
  tasks: many(task),
  timeEntries: many(timeEntry),
}));

export const projectMemberRelations = relations(projectMember, ({ one }) => ({
  project: one(project, { fields: [projectMember.projectId], references: [project.id] }),
  user: one(user, { fields: [projectMember.userId], references: [user.id] }),
}));

export const projectFavoriteRelations = relations(projectFavorite, ({ one }) => ({
  project: one(project, { fields: [projectFavorite.projectId], references: [project.id] }),
  user: one(user, { fields: [projectFavorite.userId], references: [user.id] }),
}));

export const taskRelations = relations(task, ({ one, many }) => ({
  workspace: one(workspace, { fields: [task.workspaceId], references: [workspace.id] }),
  project: one(project, { fields: [task.projectId], references: [project.id] }),
  assignees: many(taskAssignee),
  timeEntries: many(timeEntry),
}));

export const taskAssigneeRelations = relations(taskAssignee, ({ one }) => ({
  task: one(task, { fields: [taskAssignee.taskId], references: [task.id] }),
  user: one(user, { fields: [taskAssignee.userId], references: [user.id] }),
}));

export const tagRelations = relations(tag, ({ one, many }) => ({
  workspace: one(workspace, { fields: [tag.workspaceId], references: [workspace.id] }),
  entries: many(timeEntryTag),
}));

export const timeEntryRelations = relations(timeEntry, ({ one, many }) => ({
  workspace: one(workspace, { fields: [timeEntry.workspaceId], references: [workspace.id] }),
  user: one(user, { fields: [timeEntry.userId], references: [user.id] }),
  project: one(project, { fields: [timeEntry.projectId], references: [project.id] }),
  task: one(task, { fields: [timeEntry.taskId], references: [task.id] }),
  tags: many(timeEntryTag),
}));

export const timeEntryTagRelations = relations(timeEntryTag, ({ one }) => ({
  entry: one(timeEntry, { fields: [timeEntryTag.timeEntryId], references: [timeEntry.id] }),
  tag: one(tag, { fields: [timeEntryTag.tagId], references: [tag.id] }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(user, { fields: [userSettings.userId], references: [user.id] }),
}));

export const timesheetTemplateRelations = relations(timesheetTemplate, ({ one }) => ({
  workspace: one(workspace, {
    fields: [timesheetTemplate.workspaceId],
    references: [workspace.id],
  }),
  user: one(user, { fields: [timesheetTemplate.userId], references: [user.id] }),
}));

export const reportShareLinkRelations = relations(reportShareLink, ({ one }) => ({
  workspace: one(workspace, {
    fields: [reportShareLink.workspaceId],
    references: [workspace.id],
  }),
  creator: one(user, { fields: [reportShareLink.createdBy], references: [user.id] }),
}));

export const exportJobRelations = relations(exportJob, ({ one }) => ({
  workspace: one(workspace, { fields: [exportJob.workspaceId], references: [workspace.id] }),
  user: one(user, { fields: [exportJob.userId], references: [user.id] }),
}));
