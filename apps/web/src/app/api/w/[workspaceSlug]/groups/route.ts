import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { listGroupOptions } from "@/server/groups";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/** Group names, for the import dialog's "Groups for new tasks" (decision 11). */
export async function GET(_request: Request, ctx: RouteContext<"/api/w/[workspaceSlug]/groups">) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "import.entries");
    const groups = await listGroupOptions(getDb(), viewer);
    return Response.json({ groups }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "groups");
  }
}
