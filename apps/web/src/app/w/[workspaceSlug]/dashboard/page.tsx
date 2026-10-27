import {
  can,
  parseReportQuery,
  reportQueryToSearchParams,
  resolveViewerPrefs,
} from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { PageHeader } from "@/components/page-header";
import { trackerKeys } from "@/components/tracker/query-keys";
import { searchParamsOf } from "@/lib/search-params";
import { dashboardMe } from "@/server/dashboard";
import { requireWorkspacePage } from "@/server/workspace-access";
import { viewerFor } from "@/server/authz";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/dashboard">) {
  const { workspaceSlug } = await params;
  const raw = await searchParams;
  const ctx = await requireWorkspacePage(workspaceSlug, "member", `/w/${workspaceSlug}/dashboard`);
  const viewer = await viewerFor(ctx);
  const prefs = resolveViewerPrefs(ctx.user, ctx.settings);
  const query = parseReportQuery(searchParamsOf(raw));
  const key = reportQueryToSearchParams(query).toString();

  const queryClient = new QueryClient();
  queryClient.setQueryData(
    [...trackerKeys.report(workspaceSlug, "dashboard-me", key)],
    await dashboardMe(getDb(), viewer, query, prefs),
  );

  return (
    <>
      <PageHeader title="Dashboard" />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <DashboardView canSeeTeam={can(viewer.actor, "report.readTeam", { kind: "none" })} />
      </HydrationBoundary>
    </>
  );
}
