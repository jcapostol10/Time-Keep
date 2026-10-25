import { dashboardMe } from "@/server/dashboard";
import { reportRoute } from "@/server/report-route";

/** The viewer's own dashboard for the range in the URL. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/dashboard/me">,
) {
  const { workspaceSlug } = await ctx.params;
  return reportRoute(workspaceSlug, request, ({ db, viewer, prefs, query }) =>
    dashboardMe(db, viewer, query, prefs),
  );
}
