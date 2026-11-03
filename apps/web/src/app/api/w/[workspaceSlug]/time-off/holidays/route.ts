import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { listHolidays } from "@/server/time-off/holidays";
import {
  BadRequestError,
  requireWorkspaceAccess,
  routeErrorResponse,
} from "@/server/workspace-access";

/** The workspace's holidays in `?year=` (everyone may read them). */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/time-off/holidays">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "timeOff.request", {
      kind: "person",
      userId: access.user.id,
    });
    const year = Number(new URL(request.url).searchParams.get("year"));
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestError("Pick a year");
    }
    const holidays = await listHolidays(getDb(), viewer, year);
    return Response.json({ year, holidays }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "holidays");
  }
}
