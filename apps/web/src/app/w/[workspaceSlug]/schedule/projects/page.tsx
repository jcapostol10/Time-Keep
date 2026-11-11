import { getDb } from "@timekeep/db";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";

import { ProjectSchedule } from "@/components/schedule/project-schedule";
import { scheduleParams } from "@/components/schedule/schedule-model";
import { scheduleKeys } from "@/components/tracker/query-keys";
import { authorize } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";
import { manageableProjects } from "@/server/schedule/milestones";
import { readSchedule } from "@/server/schedule/read";
import { requireWorkspacePage } from "@/server/workspace-access";

import { scheduleRangeParams } from "../range-params";

export const metadata: Metadata = { title: "Project schedule" };

/** Projects on a timeline with milestones (Phase 7a): planners only. */
export default async function ProjectSchedulePage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/schedule/projects">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspacePage(
    workspaceSlug,
    "member",
    `/w/${workspaceSlug}/schedule/projects`,
  );
  const viewer = await authorizePage(() => authorize(ctx, "schedule.viewTeam"));
  const r = scheduleRangeParams(ctx, await searchParams);
  const db = getDb();
  const [data, manageable] = await Promise.all([
    readSchedule(db, viewer, { ...r.range, plan: "working" }),
    manageableProjects(db, viewer),
  ]);
  const qc = new QueryClient();
  qc.setQueryData(scheduleKeys.team(workspaceSlug, scheduleParams(r.range)), data);
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ProjectSchedule
        slug={workspaceSlug}
        from={r.from}
        zoom={r.zoom}
        today={r.today}
        weekStart={r.weekStart}
        manageable={manageable}
      />
    </HydrationBoundary>
  );
}
