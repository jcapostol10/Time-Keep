import { dateRangeSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { listEntriesInRange } from "@/server/time-entries";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/** The caller's stopped entries starting in `[from, to)`; the timesheet and calendar read this. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/time-entries/range">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const params = new URL(request.url).searchParams;
    const parsed = dateRangeSchema.safeParse({ from: params.get("from"), to: params.get("to") });
    if (!parsed.success) return Response.json({ error: "Invalid range" }, { status: 400 });

    const entries = await listEntriesInRange(
      getDb(),
      { workspaceId: access.workspace.id, userId: access.user.id, role: access.role },
      parsed.data,
    );
    return Response.json({ entries }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "time-entries");
  }
}
