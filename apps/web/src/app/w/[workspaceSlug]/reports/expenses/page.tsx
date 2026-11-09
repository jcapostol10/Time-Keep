import { parseReportQuery, reportQueryToSearchParams, resolveViewerPrefs } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";

import { ExpensesView } from "@/components/reports/expenses-view";
import { ReportShell } from "@/components/reports/report-shell";
import { trackerKeys } from "@/components/tracker/query-keys";
import { searchParamsOf } from "@/lib/search-params";
import { authorize } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";
import { expenseReport } from "@/server/expense-report";
import { reportFilterOptions } from "@/server/reports";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Expenses report" };

/** The Expenses tab (Phase 6c): everyone's own expenses; admins and managers their scope. */
export default async function ExpensesReportPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/reports/expenses">) {
  const { workspaceSlug } = await params;
  const raw = await searchParams;
  const ctx = await requireWorkspacePage(
    workspaceSlug,
    "member",
    `/w/${workspaceSlug}/reports/expenses`,
  );
  const viewer = await authorizePage(() =>
    authorize(ctx, "page.view", { kind: "page", page: "reports" }),
  );
  const prefs = resolveViewerPrefs(ctx.user, ctx.settings);
  const query = parseReportQuery(searchParamsOf(raw));
  const key = reportQueryToSearchParams(query).toString();
  const db = getDb();

  const [report, options] = await Promise.all([
    expenseReport(db, viewer, query, prefs),
    reportFilterOptions(db, viewer),
  ]);
  const queryClient = new QueryClient();
  queryClient.setQueryData(trackerKeys.report(workspaceSlug, "expenses", key), report);
  queryClient.setQueryData(trackerKeys.reportOptions(workspaceSlug), options);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ReportShell view="expenses">
        <ExpensesView />
      </ReportShell>
    </HydrationBoundary>
  );
}
