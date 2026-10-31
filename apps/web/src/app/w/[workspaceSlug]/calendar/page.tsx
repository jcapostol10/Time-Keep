import {
  localDateKey,
  resolveViewerPrefs,
  weekBounds,
  zonedDateTimeToInstant,
} from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";

import { CalendarPageClient } from "@/components/calendar/calendar-page-client";
import { PageHeader } from "@/components/page-header";
import { trackerKeys, type TrackerOptions } from "@/components/tracker/query-keys";
import { listPickerProjects } from "@/server/catalog/projects";
import { listTags } from "@/server/catalog/tags";
import { listEntriesInRange, listRecentDescriptions } from "@/server/time-entries";
import { requireWorkspacePage } from "@/server/workspace-access";
import { shownPerson } from "@/server/authz-page";
import { TargetProvider } from "@/components/tracker/target-context";

export const metadata: Metadata = { title: "Calendar" };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export default async function CalendarPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/calendar">) {
  const { workspaceSlug } = await params;
  const raw = await searchParams;
  const ctx = await requireWorkspacePage(workspaceSlug, "member", `/w/${workspaceSlug}/calendar`);
  const viewer = resolveViewerPrefs(ctx.user, ctx.settings);
  const db = getDb();
  const { scope, people, target, key } = await shownPerson(ctx, raw);

  // ?view=day|week&date=YYYY-MM-DD; the week containing the date is always loaded.
  const view = raw.view === "day" || raw.view === "week" ? raw.view : null;
  const anchor =
    typeof raw.date === "string" && DATE_KEY.test(raw.date)
      ? zonedDateTimeToInstant({ date: raw.date, hours: 12, minutes: 0 }, viewer.timezone)
      : new Date();
  const dateKey = localDateKey(anchor, viewer.timezone);
  const { weekStart, weekEnd } = weekBounds(anchor, viewer.timezone, viewer.weekStart);
  const from = weekStart.toISOString();
  const to = weekEnd.toISOString();

  const [entries, projects, tagRows, recent] = await Promise.all([
    listEntriesInRange(db, scope, { from: weekStart, to: weekEnd }),
    listPickerProjects(db, scope),
    listTags(db, scope.workspaceId, { includeArchived: false }),
    listRecentDescriptions(db, scope),
  ]);

  const queryClient = new QueryClient();
  queryClient.setQueryData(trackerKeys.range(workspaceSlug, from, to, key), entries);
  queryClient.setQueryData(trackerKeys.people(workspaceSlug), people);
  queryClient.setQueryData<TrackerOptions>(trackerKeys.options(workspaceSlug, key), {
    projects,
    tags: tagRows.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    recent,
  });

  return (
    <>
      <PageHeader title="Calendar" />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <TargetProvider target={target}>
          <CalendarPageClient from={from} to={to} dateKey={dateKey} view={view} />
        </TargetProvider>
      </HydrationBoundary>
    </>
  );
}
