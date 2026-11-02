import { getDb } from "@timekeep/db";

import { authorize } from "@/server/authz";
import { timeOffCalendar } from "@/server/time-off/calendar";
import {
  BadRequestError,
  requireWorkspaceAccess,
  routeErrorResponse,
} from "@/server/workspace-access";

/** Who is away in `?month=YYYY-MM`, among the people the caller may see. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/time-off/calendar">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const viewer = await authorize(access, "timeOff.view", {
      kind: "person",
      userId: access.user.id,
    });
    const month = new URL(request.url).searchParams.get("month") ?? "";
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestError("Pick a month");
    const calendar = await timeOffCalendar(getDb(), viewer, month);
    return Response.json(calendar, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "time-off calendar");
  }
}
