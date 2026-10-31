import { getDb } from "@timekeep/db";

import { periodView } from "@/server/approvals";
import { authorize } from "@/server/authz";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/** One submitted period: its owner and its reviewers only (404 otherwise). */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/approvals/[requestId]">,
) {
  try {
    const { workspaceSlug, requestId } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "approval.submit", {
      kind: "approval",
      userId: access.user.id,
      projectIds: [],
    });
    const view = await periodView(getDb(), viewer, requestId);
    return Response.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "approval");
  }
}
