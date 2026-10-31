import { getDb } from "@timekeep/db";

import { myPeriods } from "@/server/approvals";
import { authorize } from "@/server/authz";
import {
  BadRequestError,
  requireWorkspaceAccess,
  routeErrorResponse,
} from "@/server/workspace-access";

const MAX_RANGE_MS = 70 * 24 * 3_600_000;

/** The caller's own periods overlapping `[from, to)`, for the Submit control. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/approvals/periods">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "approval.submit", {
      kind: "approval",
      userId: access.user.id,
      projectIds: [],
    });
    const params = new URL(request.url).searchParams;
    const from = new Date(params.get("from") ?? "");
    const to = new Date(params.get("to") ?? "");
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      to <= from ||
      to.getTime() - from.getTime() > MAX_RANGE_MS
    ) {
      throw new BadRequestError("Bad range.");
    }
    const periods = await myPeriods(getDb(), viewer, { from, to });
    return Response.json({ periods }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "approval periods");
  }
}
