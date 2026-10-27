import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { latestRateRecalc } from "@/server/rate-recalc";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/** The workspace's latest "apply to past entries" job, for the progress banner. */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/rate-recalc">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "rate.view");
    const job = await latestRateRecalc(getDb(), viewer.workspaceId);
    return Response.json({ job }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "rates");
  }
}
