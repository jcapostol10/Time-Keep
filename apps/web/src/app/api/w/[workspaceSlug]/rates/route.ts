import { rateTargetSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { currentRate, rateHistory } from "@/server/rates";
import {
  BadRequestError,
  requireWorkspaceAccess,
  routeErrorResponse,
} from "@/server/workspace-access";

/** One rate level's history and the row in force now (owners and admins). */
export async function GET(request: Request, ctx: RouteContext<"/api/w/[workspaceSlug]/rates">) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "rate.view");
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = rateTargetSchema.safeParse(params);
    if (!parsed.success) throw new BadRequestError("Invalid rate target.");
    const db = getDb();
    const [history, current] = await Promise.all([
      rateHistory(db, viewer, parsed.data),
      currentRate(db, viewer, parsed.data),
    ]);
    return Response.json({ history, current }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "rates");
  }
}
