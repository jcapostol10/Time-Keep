import { attendanceReport } from "@/server/attendance";
import { reportRoute } from "@/server/report-route";

/**
 * The Attendance tab: each person's days in the query's range. Every member
 * may open it (their own days), so it asks attendance.read, not the Reports page.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/w/[workspaceSlug]/reports/attendance">,
) {
  const { workspaceSlug } = await ctx.params;
  return reportRoute(
    workspaceSlug,
    request,
    ({ db, viewer, prefs, query }) => attendanceReport(db, viewer, query, prefs),
    {
      action: "attendance.read",
      resource: (access) => ({ kind: "person", userId: access.user.id }),
    },
  );
}
