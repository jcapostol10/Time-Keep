import "server-only";

import { type Actor, can, type Role } from "@timekeep/core";
import { eq, or, project, sql } from "@timekeep/db";
import type { SQL } from "drizzle-orm";

/**
 * Who is asking: every catalog read is scoped to a workspace and filtered by
 * role; `actor` carries the role and a manager's scope for the permission
 * matrix (server/authz.ts builds it).
 */
export interface Viewer {
  workspaceId: string;
  userId: string;
  role: Role;
  actor: Actor;
}

/**
 * SQL filter for the projects `viewer` may see: none for admins; otherwise
 * public projects and private ones the viewer is on, directly or through a
 * group (a project's managers are on its member list). Combine with
 * the workspace filter; never use alone.
 */
export function visibleProjectFilter(viewer: Viewer): SQL | undefined {
  // Whoever may see a private project they are not on (owners, admins) sees all.
  const unfiltered = can(viewer.actor, "project.view", {
    kind: "project",
    projectId: null,
    visibility: "PRIVATE",
    isMember: false,
  });
  if (unfiltered) return undefined;
  return or(
    eq(project.visibility, "PUBLIC"),
    sql`EXISTS (SELECT 1 FROM "project_member" pm WHERE pm."project_id" = ${project.id} AND pm."user_id" = ${viewer.userId})`,
    sql`EXISTS (SELECT 1 FROM "project_group" pg JOIN "user_group_member" gm ON gm."group_id" = pg."group_id" WHERE pg."project_id" = ${project.id} AND gm."user_id" = ${viewer.userId})`,
  );
}
