import { reportRoute } from "@/server/report-route";
import { listExportJobs } from "@/server/export-jobs";

/** The viewer's recent export jobs, newest first. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/reports/exports">,
) {
  const { workspaceSlug } = await ctx.params;
  return reportRoute(workspaceSlug, request, async ({ db, viewer }) => ({
    jobs: await listExportJobs(db, viewer),
  }));
}
