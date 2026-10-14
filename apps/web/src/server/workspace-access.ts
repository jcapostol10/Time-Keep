import "server-only";

import { hasMinRole, type Role } from "@timekeep/core";
import {
  and,
  asc,
  type Database,
  eq,
  getDb,
  membership,
  type Membership,
  type User,
  workspace,
  type Workspace,
  workspaceSettings,
  type WorkspaceSettings,
} from "@timekeep/db";
import { notFound, redirect } from "next/navigation";

import type { AuthSession } from "./auth";
import { getSession } from "./session";

export class WorkspaceAccessError extends Error {
  constructor(
    public readonly status: 401 | 403 | 404,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

export interface WorkspaceContext {
  session: AuthSession["session"];
  user: AuthSession["user"];
  workspace: Workspace;
  membership: Membership;
  role: Role;
  settings: WorkspaceSettings;
}

const WORKSPACE_NOT_FOUND = "Workspace not found";

interface ResolveArgs {
  userId: string;
  workspaceSlug: string;
  minRole: Role;
}

/**
 * Pure data-access check: does `userId` hold an ACTIVE membership in the
 * workspace with this slug, at or above `minRole`? Throws WorkspaceAccessError
 * otherwise: 404 for an unknown slug and for non-members alike, 403 only for
 * members whose role is too low. Takes the db so tests can run it against the test database.
 */
export async function resolveWorkspaceAccess(
  db: Database,
  { userId, workspaceSlug, minRole }: ResolveArgs,
): Promise<Omit<WorkspaceContext, "session" | "user">> {
  const ws = await db.query.workspace.findFirst({ where: eq(workspace.slug, workspaceSlug) });
  if (!ws) throw new WorkspaceAccessError(404, WORKSPACE_NOT_FOUND);

  const m = await db.query.membership.findFirst({
    where: and(eq(membership.workspaceId, ws.id), eq(membership.userId, userId)),
  });
  // Same status and message as an unknown slug, so a non-member cannot tell
  // whether a workspace exists (invariant 3).
  if (!m || m.status !== "ACTIVE") throw new WorkspaceAccessError(404, WORKSPACE_NOT_FOUND);
  if (!hasMinRole(m.role, minRole)) {
    throw new WorkspaceAccessError(403, `This action requires the ${minRole} role`);
  }

  const settings = await db.query.workspaceSettings.findFirst({
    where: eq(workspaceSettings.workspaceId, ws.id),
  });
  if (!settings) throw new WorkspaceAccessError(404, "Workspace settings missing");

  return { workspace: ws, membership: m, role: m.role, settings };
}

/**
 * The helper every server action and route handler calls. Resolves the
 * session from cookies and checks membership + role for the workspace in the
 * URL. Throws WorkspaceAccessError (401 / 403 / 404); never leaks another
 * tenant's data.
 */
export async function requireWorkspaceAccess(
  workspaceSlug: string,
  minRole: Role = "member",
): Promise<WorkspaceContext> {
  const session = await getSession();
  if (!session) throw new WorkspaceAccessError(401, "Sign in required");

  const access = await resolveWorkspaceAccess(getDb(), {
    userId: session.user.id,
    workspaceSlug,
    minRole,
  });
  return { session: session.session, user: session.user, ...access };
}

/**
 * Page/layout variant: 401 redirects to sign-in, 403/404 render the not-found
 * page so a non-member cannot even confirm that a workspace exists.
 */
export async function requireWorkspacePage(
  workspaceSlug: string,
  minRole: Role = "member",
  returnTo?: string,
): Promise<WorkspaceContext> {
  try {
    return await requireWorkspaceAccess(workspaceSlug, minRole);
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      if (error.status === 401) {
        redirect(returnTo ? `/sign-in?next=${encodeURIComponent(returnTo)}` : "/sign-in");
      }
      notFound();
    }
    throw error;
  }
}

/** Map an access error to an HTTP response for route handlers. */
export function accessErrorResponse(error: unknown): Response | null {
  if (error instanceof WorkspaceAccessError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}

/** All workspaces the user can open, for the switcher. */
export async function listUserWorkspaces(db: Database, userId: string) {
  const rows = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      logo: workspace.logo,
      role: membership.role,
      joinedAt: membership.createdAt,
    })
    .from(membership)
    .innerJoin(workspace, eq(membership.workspaceId, workspace.id))
    .where(and(eq(membership.userId, userId), eq(membership.status, "ACTIVE")))
    .orderBy(asc(membership.createdAt));
  return rows;
}

/**
 * Where "/" should send this user: the session's active workspace if they are
 * still a member, else the workspace they joined first, else null.
 */
export async function resolveHomeWorkspace(session: AuthSession) {
  const db = getDb();
  const all = await listUserWorkspaces(db, session.user.id);
  if (all.length === 0) return null;

  // Better Auth keeps the plugin's logical field name on the session object
  // even though the column is `active_workspace_id`.
  const active = session.session as {
    activeOrganizationId?: string | null;
    activeWorkspaceId?: string | null;
  };
  const activeId = active.activeOrganizationId ?? active.activeWorkspaceId ?? null;
  return all.find((w) => w.id === activeId) ?? all[0] ?? null;
}

export type UserSummary = Pick<User, "id" | "name" | "email" | "image">;
