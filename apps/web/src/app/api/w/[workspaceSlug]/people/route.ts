import { getDb } from "@timekeep/db";

import { authorize, writableUsers } from "@/server/authz";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/** The people the caller may add time for, themselves first (the person picker). */
export async function GET(_request: Request, ctx: RouteContext<"/api/w/[workspaceSlug]/people">) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "entry.write", {
      kind: "entry",
      userId: access.user.id,
      projectId: null,
    });
    const people = await writableUsers(getDb(), viewer);
    return Response.json({ people }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "people");
  }
}
