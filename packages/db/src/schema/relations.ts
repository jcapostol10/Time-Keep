import { relations } from "drizzle-orm";

import { account, session, user } from "./auth";
import { invitation, membership, workspace, workspaceSettings } from "./workspace";

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  memberships: many(membership),
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
