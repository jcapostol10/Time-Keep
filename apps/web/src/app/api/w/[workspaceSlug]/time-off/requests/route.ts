import { getDb } from "@timekeep/db";

import type { TimeOffTab } from "@/lib/time-off-types";
import { authorize } from "@/server/authz";
import { listTimeOffRequests } from "@/server/time-off/requests";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

const TABS: readonly TimeOffTab[] = ["mine", "review", "archive"];

/** The caller's own requests, the ones they may review, or the decided ones. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/time-off/requests">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "timeOff.request", {
      kind: "person",
      userId: access.user.id,
    });
    const param = new URL(request.url).searchParams.get("tab");
    const tab = TABS.find((t) => t === param) ?? "mine";
    const rows = await listTimeOffRequests(getDb(), viewer, { tab });
    return Response.json({ tab, rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "time-off requests");
  }
}
