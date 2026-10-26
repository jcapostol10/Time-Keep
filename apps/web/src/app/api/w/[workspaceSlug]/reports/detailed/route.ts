import { detailedPageFromParams, reportRoute } from "@/server/report-route";
import { detailedReport } from "@/server/reports";

/** One keyset page of entries for the query in the URL. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/reports/detailed">,
) {
  const { workspaceSlug } = await ctx.params;
  return reportRoute(workspaceSlug, request, ({ db, viewer, prefs, query, params }) =>
    detailedReport(db, viewer, query, prefs, detailedPageFromParams(params)),
  );
}
