import { parseReportQuery, reportQueryToSearchParams, resolveViewerPrefs } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";

import { ProfitView } from "@/components/reports/profit-view";
import { ReportShell } from "@/components/reports/report-shell";
import { trackerKeys } from "@/components/tracker/query-keys";
import { searchParamsOf } from "@/lib/search-params";
import { profitReport, reportFilterOptions } from "@/server/reports";
import { requireWorkspacePage } from "@/server/workspace-access";
import { authorize } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";

export const metadata: Metadata = { title: "Profit report" };

/**
 * The Profit tab (Phase 6a). For those who may see cost: owners and admins,
 * and managers when the workspace says so. Anyone else gets the not-found
 * page, as for a page that does not exist.
 */
export default async function ProfitReportPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/reports/profit">) {
  const { workspaceSlug } = await params;
  const raw = await searchParams;
  const ctx = await requireWorkspacePage(
    workspaceSlug,
    "member",
    `/w/${workspaceSlug}/reports/profit`,
  );
  await authorizePage(() => authorize(ctx, "page.view", { kind: "page", page: "reports" }));
  const viewer = await authorizePage(() => authorize(ctx, "report.viewCosts"));
  const prefs = resolveViewerPrefs(ctx.user, ctx.settings);
  const query = parseReportQuery(searchParamsOf(raw));
  const key = reportQueryToSearchParams(query).toString();
  const db = getDb();

  const [report, options] = await Promise.all([
    profitReport(db, viewer, query, prefs),
    reportFilterOptions(db, viewer),
  ]);
  const queryClient = new QueryClient();
  queryClient.setQueryData(trackerKeys.report(workspaceSlug, "profit", key), report);
  queryClient.setQueryData(trackerKeys.reportOptions(workspaceSlug), options);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ReportShell view="profit">
        <ProfitView />
      </ReportShell>
    </HydrationBoundary>
  );
}
