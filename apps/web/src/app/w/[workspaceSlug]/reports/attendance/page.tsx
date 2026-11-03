import { parseReportQuery, reportQueryToSearchParams, resolveViewerPrefs } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";

import { AttendanceView } from "@/components/reports/attendance-view";
import { ReportShell } from "@/components/reports/report-shell";
import { trackerKeys } from "@/components/tracker/query-keys";
import { searchParamsOf } from "@/lib/search-params";
import { attendanceReport } from "@/server/attendance";
import { authorize } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";
import { reportFilterOptions } from "@/server/reports";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Attendance report" };

/** Every member may open it: they see their own days; managers and admins their scope. */
export default async function AttendanceReportPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/reports/attendance">) {
  const { workspaceSlug } = await params;
  const raw = await searchParams;
  const ctx = await requireWorkspacePage(
    workspaceSlug,
    "member",
    `/w/${workspaceSlug}/reports/attendance`,
  );
  const viewer = await authorizePage(() =>
    authorize(ctx, "attendance.read", { kind: "person", userId: ctx.user.id }),
  );
  const prefs = resolveViewerPrefs(ctx.user, ctx.settings);
  const query = parseReportQuery(searchParamsOf(raw));
  const key = reportQueryToSearchParams(query).toString();
  const db = getDb();

  const [report, options] = await Promise.all([
    attendanceReport(db, viewer, query, prefs),
    reportFilterOptions(db, viewer),
  ]);
  const queryClient = new QueryClient();
  queryClient.setQueryData(trackerKeys.report(workspaceSlug, "attendance", key), report);
  queryClient.setQueryData(trackerKeys.reportOptions(workspaceSlug), options);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ReportShell view="attendance">
        <AttendanceView />
      </ReportShell>
    </HydrationBoundary>
  );
}
