import { getDb } from "@timekeep/db";

import type { ApprovalsTab } from "@/lib/approval-types";
import { listApprovals } from "@/server/approvals";
import { authorize } from "@/server/authz";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

const TABS: readonly ApprovalsTab[] = ["pending", "unsubmitted", "archive"];

/** The Approvals page: the requests (or unsubmitted periods) the caller may review. */
export async function GET(request: Request, ctx: RouteContext<"/api/w/[workspaceSlug]/approvals">) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "approval.submit", {
      kind: "approval",
      userId: access.user.id,
      projectIds: [],
    });
    const param = new URL(request.url).searchParams.get("tab");
    const tab = TABS.find((t) => t === param) ?? "pending";
    const rows = await listApprovals(getDb(), viewer, { tab });
    return Response.json({ tab, rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "approvals");
  }
}
