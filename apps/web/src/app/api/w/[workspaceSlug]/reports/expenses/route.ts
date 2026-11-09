import { expenseReport } from "@/server/expense-report";
import { reportRoute } from "@/server/report-route";

/**
 * The Expenses tab (Phase 6c): totals by category, project or person for the
 * query in the URL, in the workspace currency, within the viewer's scope.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/reports/expenses">,
) {
  const { workspaceSlug } = await ctx.params;
  return reportRoute(workspaceSlug, request, ({ db, viewer, prefs, query }) =>
    expenseReport(db, viewer, query, prefs),
  );
}
