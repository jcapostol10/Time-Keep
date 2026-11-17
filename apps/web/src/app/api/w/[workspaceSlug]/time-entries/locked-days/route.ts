import { dateRangeSchema, resolveViewerPrefs } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { targetScope } from "@/server/authz";
import { lockedDays } from "@/server/entry-guard";
import { requireWorkspaceAccess, routeErrorResponse } from "@/server/workspace-access";

/**
 * Why each day of `[from, to)` is closed to the caller for new time on a
 * person's timesheet (`?userId=`): `{ days: { [dateKey]: reason } }`.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/time-entries/locked-days">,
) {
  try {
    const { workspaceSlug } = await ctx.params;
    const access = await requireWorkspaceAccess(workspaceSlug);
    const params = new URL(request.url).searchParams;
    const parsed = dateRangeSchema.safeParse({ from: params.get("from"), to: params.get("to") });
    if (!parsed.success) return Response.json({ error: "Invalid range" }, { status: 400 });
    const scope = await targetScope(access, params.get("userId") ?? access.user.id);
    const { timezone } = resolveViewerPrefs(access.user, access.settings);
    const days = await lockedDays(getDb(), scope, parsed.data, timezone);
    return Response.json({ days }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "time-entries");
  }
}
