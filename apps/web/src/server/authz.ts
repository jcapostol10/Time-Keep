import "server-only";

import {
  type Action,
  type Actor,
  DEFAULT_PERMISSION_SETTINGS,
  denial,
  type Resource,
  type Role,
} from "@timekeep/core";
import {
  and,
  type Database,
  eq,
  getDb,
  inArray,
  managedGroup,
  managedUser,
  membership,
  or,
  project,
  projectMember,
  timeEntry,
  userGroupMember,
} from "@timekeep/db";
import type { SQL } from "drizzle-orm";
import { cache } from "react";

import type { Viewer } from "./catalog/viewer";
import { type WorkspaceContext, WorkspaceAccessError } from "./workspace-access";

/**
 * Turns a request into an `Actor` for the permission matrix
 * (packages/core/src/permissions.ts) and enforces it. Server actions and
 * route handlers call `requireWorkspaceAccess` (membership) and then
 * `authorize` (the matrix); the report engine reads `scopeFilter`.
 */

type Executor = Pick<Database, "select">;

const NOT_FOUND = "Not found";

/**
 * A manager's scope: the people in `managed_user`, the current members of
 * their `managed_group`s, and the projects where they are a manager. Only
 * managers have one; owners and admins are unscoped and members have none.
 */
export async function loadActor(
  db: Executor,
  workspaceId: string,
  userId: string,
  role: Role,
): Promise<Actor> {
  const settings = DEFAULT_PERMISSION_SETTINGS;
  if (role !== "manager") {
    return { userId, role, managedUserIds: new Set(), managedProjectIds: new Set(), settings };
  }
  const [direct, viaGroups, projects] = await Promise.all([
    db
      .select({ userId: managedUser.userId })
      .from(managedUser)
      .where(and(eq(managedUser.workspaceId, workspaceId), eq(managedUser.managerId, userId))),
    db
      .select({ userId: userGroupMember.userId })
      .from(managedGroup)
      .innerJoin(userGroupMember, eq(userGroupMember.groupId, managedGroup.groupId))
      .where(and(eq(managedGroup.workspaceId, workspaceId), eq(managedGroup.managerId, userId))),
    db
      .select({ projectId: projectMember.projectId })
      .from(projectMember)
      .innerJoin(project, eq(project.id, projectMember.projectId))
      .where(
        and(
          eq(project.workspaceId, workspaceId),
          eq(projectMember.userId, userId),
          eq(projectMember.isManager, true),
        ),
      ),
  ]);
  const managedUserIds = new Set([...direct, ...viaGroups].map((r) => r.userId));
  managedUserIds.delete(userId);
  return {
    userId,
    role,
    managedUserIds,
    managedProjectIds: new Set(projects.map((r) => r.projectId)),
    settings,
  };
}

/** A viewer for someone who is not the request's user (a share link's creator, a job's owner). */
export async function loadViewer(
  db: Pick<Database, "select" | "query">,
  workspaceId: string,
  userId: string,
): Promise<Viewer> {
  const m = await db.query.membership.findFirst({
    where: and(eq(membership.workspaceId, workspaceId), eq(membership.userId, userId)),
    columns: { role: true, status: true },
  });
  if (!m || m.status !== "ACTIVE") throw new WorkspaceAccessError(404, NOT_FOUND);
  return {
    workspaceId,
    userId,
    role: m.role,
    actor: await loadActor(db, workspaceId, userId, m.role),
  };
}

const cachedViewer = cache(
  async (workspaceId: string, userId: string, role: Role): Promise<Viewer> => ({
    workspaceId,
    userId,
    role,
    actor: await loadActor(getDb(), workspaceId, userId, role),
  }),
);

/** The request's viewer, loaded once per request. */
export function viewerFor(ctx: Pick<WorkspaceContext, "workspace" | "user" | "role">) {
  return cachedViewer(ctx.workspace.id, ctx.user.id, ctx.role);
}

/** Throws the matrix's refusal: 403 for the role or a setting, 404 outside the scope. */
export function assertCan(actor: Actor, action: Action, resource: Resource): void {
  const status = denial(actor, action, resource);
  if (status === 404) throw new WorkspaceAccessError(404, NOT_FOUND);
  if (status === 403) throw new WorkspaceAccessError(403, "You don't have permission to do that.");
}

/** The request's viewer, once the matrix allows `action` on `resource`. */
export async function authorize(
  ctx: Pick<WorkspaceContext, "workspace" | "user" | "role">,
  action: Action,
  resource: Resource = { kind: "none" },
): Promise<Viewer> {
  const viewer = await viewerFor(ctx);
  assertCan(viewer.actor, action, resource);
  return viewer;
}

/**
 * Which `time_entry` rows the actor may read: none filtered for owners and
 * admins (and members when the workspace shows them the team's time); own
 * time, the people they manage and their projects for a manager; own time
 * for a member. Combine with the workspace filter; never use alone.
 */
export function scopeFilter(actor: Actor): SQL | undefined {
  if (actor.role === "owner" || actor.role === "admin") return undefined;
  if (actor.role === "member") {
    return actor.settings.membersSeeTeamTime ? undefined : eq(timeEntry.userId, actor.userId);
  }
  const parts: SQL[] = [eq(timeEntry.userId, actor.userId)];
  if (actor.managedUserIds.size > 0) {
    parts.push(inArray(timeEntry.userId, [...actor.managedUserIds]));
  }
  if (actor.managedProjectIds.size > 0) {
    parts.push(inArray(timeEntry.projectId, [...actor.managedProjectIds]));
  }
  return parts.length === 1 ? parts[0] : or(...parts);
}
