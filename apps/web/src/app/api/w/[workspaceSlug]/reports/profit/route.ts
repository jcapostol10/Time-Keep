import { reportRoute } from "@/server/report-route";
import { profitReport } from "@/server/reports";

/**
 * The Profit tab (Phase 6a): time, amount, cost and profit per project,
 * client or person for the query in the URL. `profitReport` refuses anyone
 * the matrix does not let see cost (`report.viewCosts`).
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/reports/profit">,
) {
  const { workspaceSlug } = await ctx.params;
  return reportRoute(workspaceSlug, request, ({ db, viewer, prefs, query }) =>
    profitReport(db, viewer, query, prefs),
  );
}
