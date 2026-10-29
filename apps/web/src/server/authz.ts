import "server-only";

import {
  type Action,
  type Actor,
  can,
  DEFAULT_PERMISSION_SETTINGS,
  denial,
  entryRulesOf,
  type PermissionSettings,
  permissionSettingsOf,
  type RequiredField,
  type Resource,
  type Role,
  type RoundingRule,
  roundingRuleOf,
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
  sql,
  timeEntry,
  userGroup,
  userGroupMember,
  workspaceSettings,
} from "@timekeep/db";
import type { SQL } from "drizzle-orm";
import { cache } from "react";

import type { Viewer } from "./catalog/viewer";
import { WorkspaceAccessError } from "./access-error";
import { listMembers } from "./queries/team";
import type { EntryScope } from "./time-entries";
import type { WorkspaceContext } from "./workspace-access";

/**
 * Turns a request into an `Actor` for the permission matrix
 * (packages/core/src/permissions.ts) and enforces it. Server actions and
 * route handlers call `requireWorkspaceAccess` (membership) and then
 * `authorize` (the matrix); the report engine reads `scopeFilter`.
 */

type Executor = Pick<Database, "select">;

const NOT_FOUND = "Not found";

/** The workspace's rule columns as the matrix reads them (defaults when the row is missing). */
async function loadPermissionSettings(
  db: Executor,
  workspaceId: string,
): Promise<PermissionSettings> {
  const [row] = await db
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId));
  return row ? permissionSettingsOf(row, { id: workspaceId }) : DEFAULT_PERMISSION_SETTINGS;
}

export interface WorkspaceRules {
  requiredFields: RequiredField[];
  allowBreaks: boolean;
  rounding: RoundingRule | null;
}

/** The entry and report rules of the request's workspace, from its settings row. */
export function workspaceRules(ctx: Pick<WorkspaceContext, "settings">): WorkspaceRules {
  return { ...entryRulesOf(ctx.settings), rounding: roundingRuleOf(ctx.settings) };
}

/** The groups the person belongs to in this workspace, for `task.trackTime` (decision 11). */
async function loadGroupIds(
  db: Executor,
  workspaceId: string,
  userId: string,
): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({ groupId: userGroupMember.groupId })
    .from(userGroupMember)
    .innerJoin(userGroup, eq(userGroup.id, userGroupMember.groupId))
    .where(and(eq(userGroup.workspaceId, workspaceId), eq(userGroupMember.userId, userId)));
  return new Set(rows.map((r) => r.groupId));
}

/**
 * A manager's scope: the people in `managed_user`, the current members of
 * their `managed_group`s, and the projects where they are a manager. Only
 * managers have one; owners and admins are unscoped and members have none.
 * When the workspace shows tasks by group, every role also carries its groups.
 */
export async function loadActor(
  db: Executor,
  workspaceId: string,
  userId: string,
  role: Role,
  settings?: PermissionSettings,
): Promise<Actor> {
  settings ??= await loadPermissionSettings(db, workspaceId);
  const groupIds =
    settings.taskVisibility === "BY_GROUP"
      ? await loadGroupIds(db, workspaceId, userId)
      : new Set<string>();
  if (role !== "manager") {
    return {
      userId,
      role,
      managedUserIds: new Set(),
      managedProjectIds: new Set(),
      groupIds,
      settings,
    };
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
    groupIds,
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

/**
 * A project as the matrix sees it: its visibility, and whether the viewer is
 * on it (directly or through a group). A project of another workspace is
 * "not found", like one that does not exist.
 */
export async function projectResource(
  db: Pick<Database, "select">,
  viewer: Pick<Viewer, "workspaceId" | "userId">,
  projectId: string,
): Promise<Extract<Resource, { kind: "project" }>> {
  const [row] = await db
    .select({
      visibility: project.visibility,
      isMember: sql<boolean>`(
        exists (select 1 from "project_member" pm where pm."project_id" = ${project.id} and pm."user_id" = ${viewer.userId})
        or exists (select 1 from "project_group" pg join "user_group_member" gm on gm."group_id" = pg."group_id" where pg."project_id" = ${project.id} and gm."user_id" = ${viewer.userId})
      )`,
    })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.workspaceId, viewer.workspaceId)));
  if (!row) throw new WorkspaceAccessError(404, NOT_FOUND);
  return { kind: "project", projectId, visibility: row.visibility, isMember: row.isMember };
}

/** `authorize` for an action on an existing project (its manager may be allowed). */
export async function authorizeProject(
  ctx: Pick<WorkspaceContext, "workspace" | "user" | "role">,
  action: Action,
  projectId: string,
): Promise<Viewer> {
  const viewer = await viewerFor(ctx);
  assertCan(viewer.actor, action, await projectResource(getDb(), viewer, projectId));
  return viewer;
}

/**
 * The scope for reading and writing `userId`'s time (add time for others,
 * decision 8): the viewer's own, or the target's own viewer (their role and
 * projects decide what they may track on) acted for by the caller. Someone
 * outside the caller's people (anyone, for a member) is not found, never
 * forbidden, so existence does not leak.
 */
export async function scopeForUser(
  db: Pick<Database, "select" | "query">,
  viewer: Viewer,
  userId: string,
): Promise<EntryScope> {
  assertCan(viewer.actor, "entry.write", { kind: "entry", userId, projectId: null });
  if (userId === viewer.userId) return viewer;
  const target = await loadViewer(db, viewer.workspaceId, userId);
  return { ...target, hideAmounts: viewer.hideAmounts, actedBy: viewer.actor };
}

/** `scopeForUser` for the request's viewer. */
export async function targetScope(
  ctx: Pick<WorkspaceContext, "workspace" | "user" | "role">,
  userId: string,
): Promise<EntryScope> {
  return scopeForUser(getDb(), await viewerFor(ctx), userId);
}

/** Active members the viewer may add time for: themselves first, then by name. */
export async function writableUsers(
  db: Database,
  viewer: Viewer,
): Promise<{ id: string; name: string }[]> {
  const members = await listMembers(db, viewer.workspaceId);
  const others = members
    .filter((m) => m.status === "ACTIVE" && m.userId !== viewer.userId)
    .filter((m) =>
      can(viewer.actor, "entry.write", { kind: "entry", userId: m.userId, projectId: null }),
    )
    .map((m) => ({ id: m.userId, name: m.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const me = members.find((m) => m.userId === viewer.userId);
  return me ? [{ id: me.userId, name: me.name }, ...others] : others;
}

/**
 * Whether the shown person's times may be typed (`entry.writeTimes`): the
 * actor's own only outside force timer, time added for someone else always.
 * The tracker, timesheet and calendar pages pass it with the target.
 */
export function canWriteTimesFor(scope: Viewer & { actedBy?: Actor }): boolean {
  return can(scope.actedBy ?? scope.actor, "entry.writeTimes", {
    kind: "entry",
    userId: scope.userId,
    projectId: null,
  });
}
