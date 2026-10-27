import { resolveViewerPrefs, weekBounds, zonedDateTimeToInstant } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { TimesheetPageClient } from "@/components/timesheet/timesheet-page-client";
import { trackerKeys, type TrackerOptions } from "@/components/tracker/query-keys";
import { listPickerProjects } from "@/server/catalog/projects";
import { listTags } from "@/server/catalog/tags";
import { listEntriesInRange, listRecentDescriptions } from "@/server/time-entries";
import { listTemplates } from "@/server/timesheet";
import { requireWorkspacePage } from "@/server/workspace-access";
import { viewerFor } from "@/server/authz";

export const metadata: Metadata = { title: "Timesheet" };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export default async function TimesheetPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/timesheet">) {
  const { workspaceSlug } = await params;
  const raw = await searchParams;
  const ctx = await requireWorkspacePage(workspaceSlug, "member", `/w/${workspaceSlug}/timesheet`);
  const viewer = resolveViewerPrefs(ctx.user, ctx.settings);
  const scope = await viewerFor(ctx);
  const db = getDb();

  // ?week=YYYY-MM-DD (any day of the wanted week, in the viewer's zone); default this week.
  const anchor =
    typeof raw.week === "string" && DATE_KEY.test(raw.week)
      ? zonedDateTimeToInstant({ date: raw.week, hours: 12, minutes: 0 }, viewer.timezone)
      : new Date();
  const { weekStart, weekEnd } = weekBounds(anchor, viewer.timezone, viewer.weekStart);
  const from = weekStart.toISOString();
  const to = weekEnd.toISOString();

  const [entries, projects, tagRows, recent, templates] = await Promise.all([
    listEntriesInRange(db, scope, { from: weekStart, to: weekEnd }),
    listPickerProjects(db, scope),
    listTags(db, scope.workspaceId, { includeArchived: false }),
    listRecentDescriptions(db, scope),
    listTemplates(db, scope),
  ]);

  const queryClient = new QueryClient();
  queryClient.setQueryData(trackerKeys.range(workspaceSlug, from, to), entries);
  queryClient.setQueryData<TrackerOptions>(trackerKeys.options(workspaceSlug), {
    projects,
    tags: tagRows.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    recent,
  });
  queryClient.setQueryData(trackerKeys.templates(workspaceSlug), templates);

  return (
    <>
      <PageHeader title="Timesheet" />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <TimesheetPageClient from={from} to={to} />
      </HydrationBoundary>
    </>
  );
}
