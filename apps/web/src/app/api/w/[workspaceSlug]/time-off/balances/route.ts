import { localDateKey } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { listBalances } from "@/server/time-off/balances";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/** This year's balances: `?userId=` for one person (404 outside the scope), else everyone in scope. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/time-off/balances">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const userId = new URL(request.url).searchParams.get("userId") || undefined;
    const viewer = await authorize(access, "timeOff.view", {
      kind: "person",
      userId: userId ?? access.user.id,
    });
    const today = localDateKey(new Date(), access.settings.timezone ?? "UTC");
    const balances = await listBalances(getDb(), viewer, { userId, today });
    return Response.json({ balances }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "time-off balances");
  }
}
