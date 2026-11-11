import { reportRoute } from "@/server/report-route";
import { assignmentsReport } from "@/server/schedule/report";

/** The Assignments tab (Phase 7b): the published plan against tracked work, in the viewer's scope. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/reports/assignments">,
) {
  const { workspaceSlug } = await ctx.params;
  return reportRoute(workspaceSlug, request, ({ db, viewer, prefs, query }) =>
    assignmentsReport(db, viewer, query, prefs),
  );
}
