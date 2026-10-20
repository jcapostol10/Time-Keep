import "server-only";

import { canManageCatalog, type Role } from "@timekeep/core";
import { eq, or, project, sql } from "@timekeep/db";
import type { SQL } from "drizzle-orm";

/** Who is asking: every catalog read is scoped to a workspace and filtered by role. */
export interface Viewer {
  workspaceId: string;
  userId: string;
  role: Role;
}

/**
 * SQL filter for the projects `viewer` may see: none for admins; otherwise
 * public projects and private ones the viewer is a member of. Combine with
 * the workspace filter; never use alone.
 */
export function visibleProjectFilter(viewer: Viewer): SQL | undefined {
  if (canManageCatalog(viewer.role)) return undefined;
  return or(
    eq(project.visibility, "PUBLIC"),
    sql`EXISTS (SELECT 1 FROM "project_member" pm WHERE pm."project_id" = ${project.id} AND pm."user_id" = ${viewer.userId})`,
  );
}
