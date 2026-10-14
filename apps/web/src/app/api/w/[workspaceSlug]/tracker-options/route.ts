import { getDb } from "@timekeep/db";

import { listProjects, listRecentDescriptions, listTags } from "@/server/time-entries";
import { accessErrorResponse, requireWorkspaceAccess } from "@/server/workspace-access";

/** Picker data for the timer bar: projects, tags and the caller's recent descriptions. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/tracker-options">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const db = getDb();
    const scope = { workspaceId: access.workspace.id, userId: access.user.id };
    const [projects, tags, recent] = await Promise.all([
      listProjects(db, scope.workspaceId),
      listTags(db, scope.workspaceId),
      listRecentDescriptions(db, scope),
    ]);
    return Response.json({ projects, tags, recent }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return (
      accessErrorResponse(error) ??
      Response.json({ error: "Something went wrong." }, { status: 500 })
    );
  }
}
