import "server-only";

import { can, type Role } from "@timekeep/core";
import {
  and,
  asc,
  type Database,
  desc,
  eq,
  inArray,
  invitation,
  invitationGroup,
  lte,
  managedGroup,
  managedUser,
  membership,
  or,
  project,
  projectMember,
  rate,
  sql,
  user,
  userGroup,
  userGroupMember,
  workspace,
} from "@timekeep/db";

import { assertCan, loadActor } from "./authz";
import { CatalogError } from "./catalog/errors";
import type { Viewer } from "./catalog/viewer";
import { getRunningEntry, stopTimer } from "./time-entries";
import { WorkspaceAccessError } from "./workspace-access";

/**
 * Running a team: roles, deactivation, removal, ownership and a manager's
 * scope. Membership rows are written here directly (Better Auth keeps
 * invitations only), after the permission matrix allows each change.
 */

export type TeamStatus = "ACTIVE" | "INVITED" | "DEACTIVATED";
export type AssignableRole = Exclude<Role, "owner">;

export interface TeamRow {
  kind: "member" | "invite";
  /** membership id, or invitation id for an invite */
  id: string;
  userId: string | null;
  name: string;
  email: string;
  image: string | null;
  role: Role;
  status: TeamStatus;
  groups: { id: string; name: string }[];
  /** The member-level billable rate in force now; null without rate.view or without a rate. */
  billableRateMinor: number | null;
  /** A manager's people, groups and projects; null for other roles or without permission. */
  scope: { userIds: string[]; groupIds: string[]; projectIds: string[] } | null;
}

export interface TeamFilters {
  q?: string;
  role?: Role;
  groupId?: string;
  status?: TeamStatus;
}

async function target(db: Database, viewer: Viewer, userId: string) {
  const row = await db.query.membership.findFirst({
    where: and(eq(membership.workspaceId, viewer.workspaceId), eq(membership.userId, userId)),
    columns: { role: true, status: true },
  });
  if (!row) throw new WorkspaceAccessError(404, "Not found");
  return row;
}

/** Stops the person's running timer, if any, at `now`. */
async function stopRunning(
  db: Database,
  workspaceId: string,
  userId: string,
  role: Role,
  now: Date,
) {
  const scope = {
    workspaceId,
    userId,
    role,
    actor: await loadActor(db, workspaceId, userId, role),
  };
  const running = await getRunningEntry(db, scope);
  if (running) await stopTimer(db, scope, { entryId: running.id, end: now }, now);
}

/** Deletes a manager's people, groups and project-manager flags in this workspace. */
async function clearScope(
  tx: Pick<Database, "delete" | "update">,
  workspaceId: string,
  managerId: string,
) {
  await tx
    .delete(managedUser)
    .where(and(eq(managedUser.workspaceId, workspaceId), eq(managedUser.managerId, managerId)));
  await tx
    .delete(managedGroup)
    .where(and(eq(managedGroup.workspaceId, workspaceId), eq(managedGroup.managerId, managerId)));
  await tx
    .update(projectMember)
    .set({ isManager: false })
    .where(
      and(
        eq(projectMember.userId, managerId),
        inArray(
          projectMember.projectId,
          sql`(select ${project.id} from ${project} where ${project.workspaceId} = ${workspaceId})`,
        ),
      ),
    );
}

/** A new role for someone; never to or from owner (ownership is transferred). */
export async function changeRole(
  db: Database,
  viewer: Viewer,
  userId: string,
  role: AssignableRole,
): Promise<void> {
  const current = await target(db, viewer, userId);
  assertCan(viewer.actor, "member.changeRole", { kind: "member", userId, role: current.role });
  if (current.role === role) return;
  await db.transaction(async (tx) => {
    await tx
      .update(membership)
      .set({ role })
      .where(and(eq(membership.workspaceId, viewer.workspaceId), eq(membership.userId, userId)));
    if (current.role === "manager") await clearScope(tx, viewer.workspaceId, userId);
  });
}

/**
 * Deactivate (their timer stops and the workspace closes to them; groups,
 * projects, scope and rates are kept) or reactivate.
 */
export async function setMemberStatus(
  db: Database,
  viewer: Viewer,
  userId: string,
  status: "ACTIVE" | "DEACTIVATED",
  now: Date = new Date(),
): Promise<void> {
  const current = await target(db, viewer, userId);
  assertCan(viewer.actor, "member.deactivate", { kind: "member", userId, role: current.role });
  if (current.status === status) return;
  if (status === "DEACTIVATED") {
    await stopRunning(db, viewer.workspaceId, userId, current.role, now);
  }
  await db
    .update(membership)
    .set({ status })
    .where(and(eq(membership.workspaceId, viewer.workspaceId), eq(membership.userId, userId)));
}

/**
 * Removes someone from the workspace with their groups, project
 * memberships, scope and member-level rates. Their time entries stay, and
 * read as "(former member)" in reports.
 */
export async function removeMember(db: Database, viewer: Viewer, userId: string): Promise<void> {
  const current = await target(db, viewer, userId);
  assertCan(viewer.actor, "member.remove", { kind: "member", userId, role: current.role });
  const ws = viewer.workspaceId;
  if (current.status === "ACTIVE") await stopRunning(db, ws, userId, current.role, new Date());
  const groupsHere = sql`(select ${userGroup.id} from ${userGroup} where ${userGroup.workspaceId} = ${ws})`;
  const projectsHere = sql`(select ${project.id} from ${project} where ${project.workspaceId} = ${ws})`;
  await db.transaction(async (tx) => {
    await tx
      .delete(userGroupMember)
      .where(and(eq(userGroupMember.userId, userId), inArray(userGroupMember.groupId, groupsHere)));
    await tx
      .delete(projectMember)
      .where(and(eq(projectMember.userId, userId), inArray(projectMember.projectId, projectsHere)));
    await tx
      .delete(managedUser)
      .where(
        and(
          eq(managedUser.workspaceId, ws),
          or(eq(managedUser.managerId, userId), eq(managedUser.userId, userId)),
        ),
      );
    await tx
      .delete(managedGroup)
      .where(and(eq(managedGroup.workspaceId, ws), eq(managedGroup.managerId, userId)));
    await tx.delete(rate).where(and(eq(rate.workspaceId, ws), eq(rate.userId, userId)));
    await tx
      .delete(membership)
      .where(and(eq(membership.workspaceId, ws), eq(membership.userId, userId)));
  });
}

/** Hands the workspace to an active admin; the old owner becomes an admin. */
export async function transferOwnership(
  db: Database,
  viewer: Viewer,
  toUserId: string,
  confirmName: string,
): Promise<void> {
  assertCan(viewer.actor, "workspace.transferOwnership", { kind: "workspace" });
  const ws = await db.query.workspace.findFirst({
    where: eq(workspace.id, viewer.workspaceId),
    columns: { name: true },
  });
  if (!ws) throw new WorkspaceAccessError(404, "Not found");
  if (confirmName.trim() !== ws.name) {
    throw new CatalogError("INVALID", "Type the workspace name exactly to confirm.");
  }
  const next = await target(db, viewer, toUserId);
  if (next.role !== "admin" || next.status !== "ACTIVE") {
    throw new CatalogError("INVALID", "Ownership can only go to an active admin.");
  }
  await db.transaction(async (tx) => {
    await tx
      .update(membership)
      .set({ role: "admin" })
      .where(
        and(eq(membership.workspaceId, viewer.workspaceId), eq(membership.userId, viewer.userId)),
      );
    await tx
      .update(membership)
      .set({ role: "owner" })
      .where(and(eq(membership.workspaceId, viewer.workspaceId), eq(membership.userId, toUserId)));
  });
}

/** Replaces a manager's people, groups and managed projects. */
export async function setManagerScope(
  db: Database,
  viewer: Viewer,
  managerId: string,
  scope: { userIds: string[]; groupIds: string[]; projectIds: string[] },
): Promise<void> {
  const current = await target(db, viewer, managerId);
  assertCan(viewer.actor, "member.assignScope", {
    kind: "member",
    userId: managerId,
    role: current.role,
  });
  if (current.role !== "manager") {
    throw new CatalogError("INVALID", "Only managers have people and projects to manage.");
  }
  const ws = viewer.workspaceId;
  const userIds = [...new Set(scope.userIds)].filter((id) => id !== managerId);
  const groupIds = [...new Set(scope.groupIds)];
  const projectIds = [...new Set(scope.projectIds)];
  const [members, groups, projects] = await Promise.all([
    userIds.length
      ? db
          .select({ id: membership.userId })
          .from(membership)
          .where(and(eq(membership.workspaceId, ws), inArray(membership.userId, userIds)))
      : Promise.resolve([]),
    groupIds.length
      ? db
          .select({ id: userGroup.id })
          .from(userGroup)
          .where(and(eq(userGroup.workspaceId, ws), inArray(userGroup.id, groupIds)))
      : Promise.resolve([]),
    projectIds.length
      ? db
          .select({ id: project.id })
          .from(project)
          .where(and(eq(project.workspaceId, ws), inArray(project.id, projectIds)))
      : Promise.resolve([]),
  ]);
  if (
    members.length !== userIds.length ||
    groups.length !== groupIds.length ||
    projects.length !== projectIds.length
  ) {
    throw new WorkspaceAccessError(404, "Not found");
  }
  await db.transaction(async (tx) => {
    await clearScope(tx, ws, managerId);
    if (userIds.length) {
      await tx
        .insert(managedUser)
        .values(userIds.map((userId) => ({ workspaceId: ws, managerId, userId })));
    }
    if (groupIds.length) {
      await tx
        .insert(managedGroup)
        .values(groupIds.map((groupId) => ({ workspaceId: ws, managerId, groupId })));
    }
    if (projectIds.length) {
      await tx
        .insert(projectMember)
        .values(projectIds.map((projectId) => ({ projectId, userId: managerId, isManager: true })))
        .onConflictDoUpdate({
          target: [projectMember.projectId, projectMember.userId],
          set: { isManager: true },
        });
    }
  });
}

/** Everyone in the workspace, plus pending invites for those who may invite. */
export async function listTeam(
  db: Database,
  viewer: Viewer,
  filters: TeamFilters,
  now: Date = new Date(),
): Promise<TeamRow[]> {
  const ws = viewer.workspaceId;
  const seeRates = can(viewer.actor, "rate.view", { kind: "none" });
  const seeInvites = can(viewer.actor, "member.invite", { kind: "none" });
  const seeScope = can(viewer.actor, "member.assignScope", {
    kind: "member",
    userId: "",
    role: "manager",
  });

  const [
    members,
    memberGroups,
    rates,
    invites,
    inviteGroups,
    scopeUsers,
    scopeGroups,
    scopeProjects,
  ] = await Promise.all([
    db
      .select({
        id: membership.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: membership.role,
        status: membership.status,
      })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(eq(membership.workspaceId, ws))
      .orderBy(asc(membership.createdAt)),
    db
      .select({ userId: userGroupMember.userId, id: userGroup.id, name: userGroup.name })
      .from(userGroupMember)
      .innerJoin(userGroup, eq(userGroup.id, userGroupMember.groupId))
      .where(eq(userGroup.workspaceId, ws))
      .orderBy(asc(userGroup.name)),
    seeRates
      ? db
          .selectDistinctOn([rate.userId], { userId: rate.userId, amountMinor: rate.amountMinor })
          .from(rate)
          .where(
            and(
              eq(rate.workspaceId, ws),
              eq(rate.kind, "billable"),
              eq(rate.level, "member"),
              lte(rate.effectiveFrom, now),
            ),
          )
          .orderBy(asc(rate.userId), desc(rate.effectiveFrom))
      : Promise.resolve([]),
    seeInvites
      ? db
          .select({ id: invitation.id, email: invitation.email, role: invitation.role })
          .from(invitation)
          .where(and(eq(invitation.workspaceId, ws), eq(invitation.status, "pending")))
          .orderBy(desc(invitation.createdAt))
      : Promise.resolve([]),
    seeInvites
      ? db
          .select({
            invitationId: invitationGroup.invitationId,
            id: userGroup.id,
            name: userGroup.name,
          })
          .from(invitationGroup)
          .innerJoin(userGroup, eq(userGroup.id, invitationGroup.groupId))
          .where(eq(userGroup.workspaceId, ws))
      : Promise.resolve([]),
    seeScope
      ? db
          .select({ managerId: managedUser.managerId, id: managedUser.userId })
          .from(managedUser)
          .where(eq(managedUser.workspaceId, ws))
      : Promise.resolve([]),
    seeScope
      ? db
          .select({ managerId: managedGroup.managerId, id: managedGroup.groupId })
          .from(managedGroup)
          .where(eq(managedGroup.workspaceId, ws))
      : Promise.resolve([]),
    seeScope
      ? db
          .select({ managerId: projectMember.userId, id: projectMember.projectId })
          .from(projectMember)
          .innerJoin(project, eq(project.id, projectMember.projectId))
          .where(and(eq(project.workspaceId, ws), eq(projectMember.isManager, true)))
      : Promise.resolve([]),
  ]);

  const byKey = <T extends { id: string; name?: string }>(
    rows: (T & Record<string, unknown>)[],
    key: string,
  ) => {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      const k = r[key] as string;
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return map;
  };
  const groupsOf = byKey(memberGroups, "userId");
  const groupsOfInvite = byKey(inviteGroups, "invitationId");
  const rateOf = new Map(rates.map((r) => [r.userId, r.amountMinor]));
  const ids = (rows: { managerId: string; id: string }[], managerId: string) =>
    rows.filter((r) => r.managerId === managerId).map((r) => r.id);

  const rows: TeamRow[] = [
    ...members.map((m): TeamRow => ({
      kind: "member",
      id: m.id,
      userId: m.userId,
      name: m.name,
      email: m.email,
      image: m.image ?? null,
      role: m.role,
      status: m.status === "DEACTIVATED" ? "DEACTIVATED" : "ACTIVE",
      groups: (groupsOf.get(m.userId) ?? []).map((g) => ({ id: g.id, name: g.name! })),
      billableRateMinor: seeRates ? (rateOf.get(m.userId) ?? null) : null,
      scope:
        seeScope && m.role === "manager"
          ? {
              userIds: ids(scopeUsers, m.userId),
              groupIds: ids(scopeGroups, m.userId),
              projectIds: ids(scopeProjects, m.userId),
            }
          : null,
    })),
    ...invites.map((i): TeamRow => ({
      kind: "invite",
      id: i.id,
      userId: null,
      name: i.email,
      email: i.email,
      image: null,
      role: (["admin", "manager", "member"] as const).find((r) => r === i.role) ?? "member",
      status: "INVITED",
      groups: (groupsOfInvite.get(i.id) ?? []).map((g) => ({ id: g.id, name: g.name! })),
      billableRateMinor: null,
      scope: null,
    })),
  ];

  const q = filters.q?.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)) &&
      (!filters.role || r.role === filters.role) &&
      (!filters.groupId || r.groups.some((g) => g.id === filters.groupId)) &&
      (!filters.status || r.status === filters.status),
  );
}
