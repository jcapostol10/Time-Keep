import { parseReportQuery, reportQueryToSearchParams, resolveViewerPrefs } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";

import { ReportShell } from "@/components/reports/report-shell";
import { WeeklyView } from "@/components/reports/weekly-view";
import { trackerKeys } from "@/components/tracker/query-keys";
import { searchParamsOf } from "@/lib/search-params";
import { reportFilterOptions, weeklyReport } from "@/server/reports";
import { requireWorkspacePage } from "@/server/workspace-access";
import { authorize } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";

export const metadata: Metadata = { title: "Weekly report" };

export default async function WeeklyReportPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/reports/weekly">) {
  const { workspaceSlug } = await params;
  const raw = await searchParams;
  const ctx = await requireWorkspacePage(
    workspaceSlug,
    "member",
    `/w/${workspaceSlug}/reports/weekly`,
  );
  const viewer = await authorizePage(() =>
    authorize(ctx, "page.view", { kind: "page", page: "reports" }),
  );
  const prefs = resolveViewerPrefs(ctx.user, ctx.settings);
  const query = parseReportQuery(searchParamsOf(raw));
  const key = reportQueryToSearchParams(query).toString();
  const db = getDb();

  const [report, options] = await Promise.all([
    weeklyReport(db, viewer, query, prefs),
    reportFilterOptions(db, viewer),
  ]);
  const queryClient = new QueryClient();
  queryClient.setQueryData(trackerKeys.report(workspaceSlug, "weekly", key), report);
  queryClient.setQueryData(trackerKeys.reportOptions(workspaceSlug), options);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ReportShell view="weekly">
        <WeeklyView />
      </ReportShell>
    </HydrationBoundary>
  );
}
