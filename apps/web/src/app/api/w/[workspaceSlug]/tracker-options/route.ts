import { getDb } from "@timekeep/db";

import { listPickerProjects } from "@/server/catalog/projects";
import { listTagOptions } from "@/server/catalog/tags";
import { listRecentDescriptions } from "@/server/time-entries";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";
import { targetScope } from "@/server/authz";

/** Picker data: a person's projects (`?userId=`, the caller by default), tags and recent descriptions. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/tracker-options">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const db = getDb();
    const userId = new URL(request.url).searchParams.get("userId") ?? access.user.id;
    const scope = await targetScope(access, userId);
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
