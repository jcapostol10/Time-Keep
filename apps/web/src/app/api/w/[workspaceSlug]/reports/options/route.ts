import { reportRoute } from "@/server/report-route";
import { reportFilterOptions } from "@/server/reports";

/** The filter bar's options for the viewer (no users for a member). */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/reports/options">,
) {
  const { workspaceSlug } = await ctx.params;
  return reportRoute(workspaceSlug, request, ({ db, viewer }) => reportFilterOptions(db, viewer));
}
