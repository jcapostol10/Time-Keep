import { getDb } from "@timekeep/db";

import { getRunningEntry } from "@/server/time-entries";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";
import { authorize } from "@/server/authz";

/** The caller's running timer in this workspace, if any. Polled on window focus. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/time-entries/running">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const running = await getRunningEntry(
      getDb(),
      await authorize(access, "entry.read", {
        kind: "entry",
        userId: access.user.id,
        projectId: null,
      }),
    );
    return Response.json({ running }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "time-entries");
  }
}
