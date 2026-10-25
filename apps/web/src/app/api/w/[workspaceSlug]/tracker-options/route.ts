import { getDb } from "@timekeep/db";

import { listPickerProjects } from "@/server/catalog/projects";
import { listTagOptions } from "@/server/catalog/tags";
import { listRecentDescriptions } from "@/server/time-entries";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/** Picker data for the timer bar: projects, tags and the caller's recent descriptions. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/tracker-options">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const db = getDb();
    const scope = { workspaceId: access.workspace.id, userId: access.user.id, role: access.role };
    const [projects, tagRows, recent] = await Promise.all([
      listPickerProjects(db, scope),
      listTagOptions(db, scope.workspaceId),
      listRecentDescriptions(db, scope),
    ]);
    const tags = tagRows.map((t) => ({ id: t.id, name: t.name, color: t.color }));
    return Response.json({ projects, tags, recent }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "tracker");
  }
}
