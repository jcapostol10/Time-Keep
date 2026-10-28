import {
  AUDIT_DEFAULT_PARAMS,
  parseReportQuery,
  reportQueryToSearchParams,
  resolveViewerPrefs,
} from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DetailedView } from "@/components/reports/detailed-view";
import { ReportShell } from "@/components/reports/report-shell";
import { trackerKeys } from "@/components/tracker/query-keys";
import { detailedKey, type DetailedPaging } from "@/lib/report-types";
import { searchParamsOf } from "@/lib/search-params";
import { detailedReport, reportFilterOptions } from "@/server/reports";
import { requireWorkspacePage } from "@/server/workspace-access";
import { authorize } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";

export const metadata: Metadata = { title: "Audit report" };

const DEFAULT_LIMIT = 50;

/** The Detailed report over problem entries: the criteria live in the URL (the defaults without any). */
export default async function AuditReportPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/reports/audit">) {
  const { workspaceSlug } = await params;
  const raw = await searchParams;
  const ctx = await requireWorkspacePage(
    workspaceSlug,
    "member",
    `/w/${workspaceSlug}/reports/audit`,
  );
  const viewer = await authorizePage(() =>
    authorize(ctx, "page.view", { kind: "page", page: "reports" }),
  );
  const prefs = resolveViewerPrefs(ctx.user, ctx.settings);
  const search = searchParamsOf(raw);
  if (!search.has("audit")) {
    for (const [k, v] of new URLSearchParams(AUDIT_DEFAULT_PARAMS)) search.append(k, v);
    redirect(`/w/${workspaceSlug}/reports/audit?${search.toString()}`);
  }
  const query = parseReportQuery(search);
  const key = reportQueryToSearchParams(query).toString();
  // Rows per page; also how the e2e suite exercises "Load more" without fifty entries.
  const requested = Number(search.get("limit"));
  const paging: DetailedPaging = {
    sort: "start",
    dir: "desc",
    limit:
      Number.isInteger(requested) && requested >= 1 && requested <= 200 ? requested : DEFAULT_LIMIT,
  };
  const db = getDb();

  const [page, options] = await Promise.all([
    detailedReport(db, viewer, query, prefs, { ...paging }),
    reportFilterOptions(db, viewer),
  ]);
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    trackerKeys.report(workspaceSlug, "detailed", detailedKey(key, paging)),
    {
      pages: [page],
      pageParams: [null],
    },
  );
  queryClient.setQueryData(trackerKeys.reportOptions(workspaceSlug), options);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ReportShell view="audit">
        <DetailedView initialPaging={paging} />
      </ReportShell>
    </HydrationBoundary>
  );
}
