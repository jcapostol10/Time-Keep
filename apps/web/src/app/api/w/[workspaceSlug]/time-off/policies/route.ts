import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { listPolicies } from "@/server/time-off/policies";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/** Admins get every policy (`?archived=1` too); `?mine=1` and everyone else, their own. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/time-off/policies">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "timeOff.request", {
      kind: "person",
      userId: access.user.id,
    });
    const params = new URL(request.url).searchParams;
    const policies = await listPolicies(getDb(), viewer, {
      includeArchived: params.get("archived") === "1",
      mine: params.get("mine") === "1",
    });
    return Response.json({ policies }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "time-off policies");
  }
}
