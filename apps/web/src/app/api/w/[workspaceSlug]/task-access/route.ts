import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { CatalogError } from "@/server/catalog/errors";
import { listGroupTasks, listTasksAvailableTo } from "@/server/catalog/tasks";
import {
  BadRequestError,
  requireWorkspaceAccess,
  routeErrorResponse,
} from "@/server/workspace-access";

/** The tasks a group gives (`?groupId=`) or a person can see (`?userId=`): the Team page's lists. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/task-access">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "group.manage");
    const params = new URL(request.url).searchParams;
    const groupId = params.get("groupId");
    const userId = params.get("userId");
    if (!groupId && !userId) throw new BadRequestError("groupId or userId is required");
    const db = getDb();
    try {
      const result = groupId
        ? await listGroupTasks(db, viewer, groupId)
        : await listTasksAvailableTo(db, viewer, userId!);
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof CatalogError && error.code === "NOT_FOUND") {
        return Response.json({ error: error.message }, { status: 404 });
      }
      throw error;
    }
  } catch (error) {
    return routeErrorResponse(error, "task-access");
  }
}
