import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { listTargetRules } from "@/server/targets";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/** The workspace's target rules (owners and admins). */
export async function GET(_request: Request, ctx: RouteContext<"/api/w/[workspaceSlug]/targets">) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "target.manage", { kind: "none" });
    const rules = await listTargetRules(getDb(), viewer);
    return Response.json({ rules }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "targets");
  }
}
