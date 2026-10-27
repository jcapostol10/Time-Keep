import { dashboardTeam } from "@/server/dashboard";
import { TEAM_TIME, reportRoute } from "@/server/report-route";

/** Each active member's total, latest entry and running state (team readers only: 403 otherwise). */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/dashboard/team">,
) {
  const { workspaceSlug } = await ctx.params;
  return reportRoute(
    workspaceSlug,
    request,
    async ({ db, viewer, prefs, query }) => ({
      members: await dashboardTeam(db, viewer, query, prefs),
    }),
    TEAM_TIME,
  );
}
