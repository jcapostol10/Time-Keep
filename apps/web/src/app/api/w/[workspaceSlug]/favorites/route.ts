import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { listFavorites } from "@/server/favorites";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/** The caller's favourites, oldest first, each saying whether it can start now. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/favorites">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "entry.read", {
      kind: "entry",
      userId: access.user.id,
      projectId: null,
    });
    const favorites = await listFavorites(getDb(), viewer);
    return Response.json({ favorites }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "favorites");
  }
}
