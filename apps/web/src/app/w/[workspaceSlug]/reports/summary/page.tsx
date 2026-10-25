import { parseReportQuery, reportQueryToSearchParams, resolveViewerPrefs } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";

import { ReportShell } from "@/components/reports/report-shell";
import { SummaryView } from "@/components/reports/summary-view";
import { trackerKeys } from "@/components/tracker/query-keys";
import { reportFilterOptions, summaryReport } from "@/server/reports";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Summary report" };

/** The page's search params as URLSearchParams (repeated keys for arrays). */
export function searchParamsOf(
  raw: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) for (const v of value) params.append(key, v);
    else if (typeof value === "string") params.set(key, value);
  }
  return params;
}

export default async function SummaryReportPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/reports/summary">) {
  const { workspaceSlug } = await params;
  const raw = await searchParams;
  const ctx = await requireWorkspacePage(
    workspaceSlug,
    "member",
    `/w/${workspaceSlug}/reports/summary`,
  );
  const viewer = { workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role };
  const prefs = resolveViewerPrefs(ctx.user, ctx.settings);
  const query = parseReportQuery(searchParamsOf(raw));
  const key = reportQueryToSearchParams(query).toString();
  const db = getDb();

  const [report, options] = await Promise.all([
    summaryReport(db, viewer, query, prefs),
    reportFilterOptions(db, viewer),
  ]);
  const queryClient = new QueryClient();
  queryClient.setQueryData(trackerKeys.report(workspaceSlug, "summary", key), report);
  queryClient.setQueryData(trackerKeys.reportOptions(workspaceSlug), options);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ReportShell kind="summary">
        <SummaryView />
      </ReportShell>
    </HydrationBoundary>
  );
}
