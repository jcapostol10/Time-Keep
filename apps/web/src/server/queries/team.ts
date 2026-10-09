import "server-only";

import { and, asc, type Database, desc, eq, invitation, membership, user } from "@timekeep/db";

export async function listMembers(db: Database, workspaceId: string) {
  return db
    .select({
      membershipId: membership.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: membership.role,
      status: membership.status,
      joinedAt: membership.createdAt,
    })
    .from(membership)
    .innerJoin(user, eq(membership.userId, user.id))
    .where(eq(membership.workspaceId, workspaceId))
    .orderBy(asc(membership.createdAt));
}

export async function listPendingInvitations(db: Database, workspaceId: string) {
  return db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      inviterName: user.name,
    })
    .from(invitation)
    .innerJoin(user, eq(invitation.inviterId, user.id))
    .where(and(eq(invitation.workspaceId, workspaceId), eq(invitation.status, "pending")))
    .orderBy(desc(invitation.createdAt));
}
