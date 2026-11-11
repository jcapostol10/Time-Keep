import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { readSchedule } from "@/server/schedule/read";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/**
 * The working plan for planners (Phase 7a): `?from=&to=` (date keys, 13 weeks
 * at most) and optional `userIds`, `groupIds`, `projectIds` (repeated).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/w/[workspaceSlug]/schedule">) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "schedule.viewTeam");
    const q = new URL(request.url).searchParams;
    const schedule = await readSchedule(getDb(), viewer, {
      from: q.get("from") ?? "",
      to: q.get("to") ?? "",
      plan: "working",
      userIds: q.getAll("userIds"),
      groupIds: q.getAll("groupIds"),
      projectIds: q.getAll("projectIds"),
    });
    return Response.json(schedule, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "schedule");
  }
}
