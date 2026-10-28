import { resolveViewerPrefs } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { trackerKeys, type TrackerOptions } from "@/components/tracker/query-keys";
import { TrackerPageClient } from "@/components/tracker/tracker-page-client";
import { listPickerProjects } from "@/server/catalog/projects";
import { listTags } from "@/server/catalog/tags";
import { listFavorites } from "@/server/favorites";
import { listEntriesPage, listRecentDescriptions } from "@/server/time-entries";
import { requireWorkspacePage } from "@/server/workspace-access";
import { targetScope, viewerFor, writableUsers } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";
import { TargetProvider } from "@/components/tracker/target-context";

export const metadata: Metadata = { title: "Time Tracker" };

/** `?user=<id>`: someone the viewer may add time for; their week loads under their own keys. */
async function shownPerson(
  ctx: Parameters<typeof viewerFor>[0] & { user: { id: string } },
  raw: Record<string, string | string[] | undefined>,
) {
  const db = getDb();
  const me = await viewerFor(ctx);
  const people = await writableUsers(db, me);
  const userParam = typeof raw.user === "string" ? raw.user : null;
  if (!userParam || userParam === ctx.user.id) return { scope: me, people, target: null, key: "me" };
  const scope = await authorizePage(() => targetScope(ctx, userParam));
  const name = people.find((p) => p.id === userParam)?.name ?? "";
  return { scope, people, target: { userId: userParam, name }, key: userParam };
}


export default async function TrackerPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/tracker">) {
  const { workspaceSlug } = await params;
  const raw = await searchParams;
  const focus = raw.focus;
  const ctx = await requireWorkspacePage(workspaceSlug, "member", `/w/${workspaceSlug}/tracker`);
  const viewer = resolveViewerPrefs(ctx.user, ctx.settings);
  const db = getDb();
  const { scope, people, target, key } = await shownPerson(ctx, raw);

  const [firstPage, projects, tagRows, recent, favorites] = await Promise.all([
    listEntriesPage(db, scope, { tz: viewer.timezone, weekStart: viewer.weekStart }),
    listPickerProjects(db, scope),
    listTags(db, scope.workspaceId, { includeArchived: false }),
    listRecentDescriptions(db, scope),
    // Favourites are the viewer's own, whoever's entries are shown.
    listFavorites(db, await viewerFor(ctx)),
  ]);
  const tags = tagRows.map((t) => ({ id: t.id, name: t.name, color: t.color }));

  // Fresh per request; HydrationBoundary merges it into the browser cache.
  const queryClient = new QueryClient();
  queryClient.setQueryData(trackerKeys.entries(workspaceSlug, key), {
    pages: [firstPage],
    pageParams: [null],
  });
  queryClient.setQueryData<TrackerOptions>(trackerKeys.options(workspaceSlug, key), {
    projects,
    tags,
    recent,
  });
  queryClient.setQueryData(trackerKeys.people(workspaceSlug), people);
  queryClient.setQueryData(trackerKeys.favorites(workspaceSlug), favorites);

  return (
    <>
      <PageHeader title="Time Tracker" />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <TargetProvider target={target}>
          <TrackerPageClient autoFocus={focus === "description"} />
        </TargetProvider>
      </HydrationBoundary>
    </>
  );
}
