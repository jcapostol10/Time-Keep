import { resolveViewerPrefs } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { trackerKeys, type TrackerOptions } from "@/components/tracker/query-keys";
import { TrackerPageClient } from "@/components/tracker/tracker-page-client";
import { listPickerProjects } from "@/server/catalog/projects";
import { listTags } from "@/server/catalog/tags";
import { listEntriesPage, listRecentDescriptions } from "@/server/time-entries";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Time Tracker" };

export default async function TrackerPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/tracker">) {
  const { workspaceSlug } = await params;
  const { focus } = await searchParams;
  const ctx = await requireWorkspacePage(workspaceSlug, "member", `/w/${workspaceSlug}/tracker`);
  const viewer = resolveViewerPrefs(ctx.user, ctx.settings);
  const db = getDb();
  const scope = { workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role };

  const [firstPage, projects, tagRows, recent] = await Promise.all([
    listEntriesPage(db, scope, { tz: viewer.timezone, weekStart: viewer.weekStart }),
    listPickerProjects(db, scope),
    listTags(db, scope.workspaceId, { includeArchived: false }),
    listRecentDescriptions(db, scope),
  ]);
  const tags = tagRows.map((t) => ({ id: t.id, name: t.name, color: t.color }));

  // Fresh per request; HydrationBoundary merges it into the browser cache.
  const queryClient = new QueryClient();
  queryClient.setQueryData(trackerKeys.entries(workspaceSlug), {
    pages: [firstPage],
    pageParams: [null],
  });
  queryClient.setQueryData<TrackerOptions>(trackerKeys.options(workspaceSlug), {
    projects,
    tags,
    recent,
  });

  return (
    <>
      <PageHeader title="Time Tracker" />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <TrackerPageClient autoFocus={focus === "description"} />
      </HydrationBoundary>
    </>
  );
}
