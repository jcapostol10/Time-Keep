import { getDb } from "@timekeep/db";
import { after } from "next/server";

import { authorize } from "@/server/authz";
import { latestRateRecalc, refreshRateRecalc, runRateRecalcJob } from "@/server/rate-recalc";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/**
 * The workspace's latest "apply to past entries" job, for the progress banner.
 * Polling also fails a job killed mid-run and starts a waiting one nobody runs.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/rate-recalc">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "rate.view");
    const db = getDb();
    const waiting = await refreshRateRecalc(db, viewer.workspaceId);
    if (waiting) after(() => runRateRecalcJob(getDb(), waiting));
    const job = await latestRateRecalc(db, viewer.workspaceId);
    return Response.json({ job }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "rates");
  }
}
