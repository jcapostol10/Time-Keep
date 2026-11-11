import { getDb } from "@timekeep/db";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";

import { scheduleParams } from "@/components/schedule/schedule-model";
import { TeamSchedule } from "@/components/schedule/team-schedule";
import { scheduleKeys } from "@/components/tracker/query-keys";
import { authorize } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";
import { readSchedule } from "@/server/schedule/read";
import { requireWorkspacePage } from "@/server/workspace-access";

import { scheduleRangeParams } from "../range-params";

export const metadata: Metadata = { title: "Team schedule" };

/** The team grid (Phase 7a): planners only; a member gets the not-found page. */
export default async function TeamSchedulePage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/schedule/team">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspacePage(
    workspaceSlug,
    "member",
    `/w/${workspaceSlug}/schedule/team`,
  );
  const viewer = await authorizePage(() => authorize(ctx, "schedule.viewTeam"));
  const r = scheduleRangeParams(ctx, await searchParams);
  const data = await readSchedule(getDb(), viewer, { ...r.range, plan: "working" });
  const qc = new QueryClient();
  qc.setQueryData(scheduleKeys.team(workspaceSlug, scheduleParams(r.range)), data);
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <TeamSchedule
        slug={workspaceSlug}
        viewerId={ctx.user.id}
        from={r.from}
        zoom={r.zoom}
        today={r.today}
        weekStart={r.weekStart}
      />
    </HydrationBoundary>
  );
}
