import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { readSchedule } from "@/server/schedule/read";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/** The viewer's own published plan (My schedule, the Calendar band): `?from=&to=`. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/schedule/mine">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    // Everyone reads their own time; the published plan is theirs too.
    const viewer = await authorize(access, "entry.read", {
      kind: "entry",
      userId: access.user.id,
      projectId: null,
    });
    const q = new URL(request.url).searchParams;
    const schedule = await readSchedule(getDb(), viewer, {
      from: q.get("from") ?? "",
      to: q.get("to") ?? "",
      plan: "published",
    });
    return Response.json(schedule, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "schedule");
  }
}
