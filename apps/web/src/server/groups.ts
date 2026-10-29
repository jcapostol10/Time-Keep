import "server-only";

import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  type Database,
  eq,
  inArray,
  membership,
  sql,
  userGroup,
  userGroupMember,
} from "@timekeep/db";

import { assertCan } from "./authz";
import { CatalogError, isUniqueViolation } from "./catalog/errors";
import type { GroupDTO } from "@/lib/team-types";

import type { Viewer } from "./catalog/viewer";

/**
 * User groups: named sets of people for private-project access, report
 * filters and a manager's scope. Owners and admins manage them.
 */

export type { GroupDTO };

const NAME_TAKEN = "A group with that name already exists.";

function cleanName(name: string): string {
  const trimmed = name.trim().slice(0, 100);
  if (!trimmed) throw new CatalogError("INVALID", "Give the group a name.");
  return trimmed;
}

async function nameTaken(db: Database, workspaceId: string, name: string, exceptId?: string) {
  const rows = await db
    .select({ id: userGroup.id })
    .from(userGroup)
    .where(
      and(eq(userGroup.workspaceId, workspaceId), sql`lower(${userGroup.name}) = lower(${name})`),
    );
  return rows.some((r) => r.id !== exceptId);
}

async function requireGroup(db: Database, viewer: Viewer, groupId: string) {
  const row = await db.query.userGroup.findFirst({
    where: and(eq(userGroup.id, groupId), eq(userGroup.workspaceId, viewer.workspaceId)),
  });
  if (!row) throw new CatalogError("NOT_FOUND", "Group not found.");
  return row;
}

/**
 * Group names only, for choosers outside the Team page (the task dialogs, the
 * import's "Groups for new tasks"). No `group.manage`: the callers' pages and
 * routes gate access, and names are what the Team page shows every manager.
 */
export async function listGroupOptions(
  db: Pick<Database, "select">,
  viewer: Pick<Viewer, "workspaceId">,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: userGroup.id, name: userGroup.name })
    .from(userGroup)
    .where(eq(userGroup.workspaceId, viewer.workspaceId))
    .orderBy(asc(userGroup.name));
}

export async function listGroups(db: Database, viewer: Viewer): Promise<GroupDTO[]> {
  const [groups, members] = await Promise.all([
    db
      .select({ id: userGroup.id, name: userGroup.name })
      .from(userGroup)
      .where(eq(userGroup.workspaceId, viewer.workspaceId))
      .orderBy(asc(userGroup.name)),
    db
      .select({ groupId: userGroupMember.groupId, userId: userGroupMember.userId })
      .from(userGroupMember)
      .innerJoin(userGroup, eq(userGroup.id, userGroupMember.groupId))
      .where(eq(userGroup.workspaceId, viewer.workspaceId)),
  ]);
  return groups.map((g) => ({
    ...g,
    memberIds: members.filter((m) => m.groupId === g.id).map((m) => m.userId),
  }));
}

export async function createGroup(db: Database, viewer: Viewer, name: string): Promise<GroupDTO> {
  assertCan(viewer.actor, "group.manage", { kind: "none" });
  const clean = cleanName(name);
  if (await nameTaken(db, viewer.workspaceId, clean)) {
    throw new CatalogError("CONFLICT", NAME_TAKEN);
  }
  const id = randomUUID();
  try {
    await db.insert(userGroup).values({ id, workspaceId: viewer.workspaceId, name: clean });
  } catch (error) {
    if (isUniqueViolation(error, "user_group_workspace_name_uq")) {
      throw new CatalogError("CONFLICT", NAME_TAKEN);
    }
    throw error;
  }
  return { id, name: clean, memberIds: [] };
}

export async function renameGroup(
  db: Database,
  viewer: Viewer,
  groupId: string,
  name: string,
): Promise<void> {
  assertCan(viewer.actor, "group.manage", { kind: "none" });
  await requireGroup(db, viewer, groupId);
  const clean = cleanName(name);
  if (await nameTaken(db, viewer.workspaceId, clean, groupId)) {
    throw new CatalogError("CONFLICT", NAME_TAKEN);
  }
  await db.update(userGroup).set({ name: clean }).where(eq(userGroup.id, groupId));
}

/** Deleting a group removes its project access and scope rows (cascade), not its people. */
export async function deleteGroup(db: Database, viewer: Viewer, groupId: string): Promise<void> {
  assertCan(viewer.actor, "group.manage", { kind: "none" });
  await requireGroup(db, viewer, groupId);
  await db.delete(userGroup).where(eq(userGroup.id, groupId));
}

export async function setGroupMembers(
  db: Database,
  viewer: Viewer,
  groupId: string,
  userIds: string[],
): Promise<void> {
  assertCan(viewer.actor, "group.manage", { kind: "none" });
  await requireGroup(db, viewer, groupId);
  const unique = [...new Set(userIds)];
  if (unique.length > 0) {
    const rows = await db
      .select({ userId: membership.userId })
      .from(membership)
      .where(
        and(eq(membership.workspaceId, viewer.workspaceId), inArray(membership.userId, unique)),
      );
    if (rows.length !== unique.length) {
      throw new CatalogError("INVALID", "Only workspace members can join a group.");
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(userGroupMember).where(eq(userGroupMember.groupId, groupId));
    if (unique.length > 0) {
      await tx.insert(userGroupMember).values(unique.map((userId) => ({ groupId, userId })));
    }
  });
}

/** One person's groups, replaced as a whole; the groups' other members stay. */
export async function setUserGroups(
  db: Database,
  viewer: Viewer,
  userId: string,
  groupIds: string[],
): Promise<void> {
  assertCan(viewer.actor, "group.manage", { kind: "none" });
  const member = await db.query.membership.findFirst({
    where: and(eq(membership.workspaceId, viewer.workspaceId), eq(membership.userId, userId)),
    columns: { id: true },
  });
  if (!member) throw new CatalogError("NOT_FOUND", "Member not found.");
  const unique = [...new Set(groupIds)];
  const here = await db
    .select({ id: userGroup.id })
    .from(userGroup)
    .where(eq(userGroup.workspaceId, viewer.workspaceId));
  const known = new Set(here.map((g) => g.id));
  if (unique.some((id) => !known.has(id))) throw new CatalogError("INVALID", "Group not found.");
  await db.transaction(async (tx) => {
    if (here.length > 0) {
      await tx.delete(userGroupMember).where(
        and(
          eq(userGroupMember.userId, userId),
          inArray(
            userGroupMember.groupId,
            here.map((g) => g.id),
          ),
        ),
      );
    }
    if (unique.length > 0) {
      await tx.insert(userGroupMember).values(unique.map((groupId) => ({ groupId, userId })));
    }
  });
}
