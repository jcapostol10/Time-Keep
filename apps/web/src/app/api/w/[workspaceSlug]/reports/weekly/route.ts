import { reportRoute } from "@/server/report-route";
import { weeklyReport } from "@/server/reports";

/** The week of the query's range, by project or (weeklyBy=user) by person. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/reports/weekly">,
) {
  const { workspaceSlug } = await ctx.params;
  return reportRoute(workspaceSlug, request, ({ db, viewer, prefs, query }) =>
    weeklyReport(db, viewer, query, prefs),
  );
}
