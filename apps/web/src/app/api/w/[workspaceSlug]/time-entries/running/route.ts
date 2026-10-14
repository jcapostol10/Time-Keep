import { getDb } from "@timekeep/db";

import { getRunningEntry } from "@/server/time-entries";
import { accessErrorResponse, requireWorkspaceAccess } from "@/server/workspace-access";

/** The caller's running timer in this workspace, if any. Polled on window focus. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/time-entries/running">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const running = await getRunningEntry(getDb(), {
      workspaceId: access.workspace.id,
      userId: access.user.id,
    });
    return Response.json({ running }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return (
      accessErrorResponse(error) ??
      Response.json({ error: "Something went wrong." }, { status: 500 })
    );
  }
}
