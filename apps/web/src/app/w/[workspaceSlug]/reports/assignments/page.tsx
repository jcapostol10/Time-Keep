import { parseReportQuery, reportQueryToSearchParams, resolveViewerPrefs } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";

import { AssignmentsView } from "@/components/reports/assignments-view";
import { ReportShell } from "@/components/reports/report-shell";
import { trackerKeys } from "@/components/tracker/query-keys";
import { searchParamsOf } from "@/lib/search-params";
import { authorize } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";
import { reportFilterOptions } from "@/server/reports";
import { assignmentsReport } from "@/server/schedule/report";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Assignments report" };

/** The published plan against tracked time (Phase 7b): the Reports page's rule. */
export default async function AssignmentsReportPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/reports/assignments">) {
  const { workspaceSlug } = await params;
  const raw = await searchParams;
  const ctx = await requireWorkspacePage(
    workspaceSlug,
    "member",
    `/w/${workspaceSlug}/reports/assignments`,
  );
  const viewer = await authorizePage(() =>
    authorize(ctx, "page.view", { kind: "page", page: "reports" }),
  );
  const prefs = resolveViewerPrefs(ctx.user, ctx.settings);
  const query = parseReportQuery(searchParamsOf(raw));
  const key = reportQueryToSearchParams(query).toString();
  const db = getDb();
  const [report, options] = await Promise.all([
    assignmentsReport(db, viewer, query, prefs),
    reportFilterOptions(db, viewer),
  ]);
  const queryClient = new QueryClient();
  queryClient.setQueryData(trackerKeys.report(workspaceSlug, "assignments", key), report);
  queryClient.setQueryData(trackerKeys.reportOptions(workspaceSlug), options);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ReportShell view="assignments">
        <AssignmentsView />
      </ReportShell>
    </HydrationBoundary>
  );
}
