import { reportRoute } from "@/server/report-route";
import { summaryReport } from "@/server/reports";

/** Grouped totals and the time series for the query in the URL. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/reports/summary">,
) {
  const { workspaceSlug } = await ctx.params;
  return reportRoute(workspaceSlug, request, ({ db, viewer, prefs, query }) =>
    summaryReport(db, viewer, query, prefs),
  );
}
