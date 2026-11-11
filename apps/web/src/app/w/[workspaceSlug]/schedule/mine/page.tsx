import { getDb } from "@timekeep/db";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";

import { MySchedule } from "@/components/schedule/my-schedule";
import { scheduleKeys } from "@/components/tracker/query-keys";
import { viewerFor } from "@/server/authz";
import { readSchedule } from "@/server/schedule/read";
import { requireWorkspacePage } from "@/server/workspace-access";

import { scheduleRangeParams } from "../range-params";

export const metadata: Metadata = { title: "My schedule" };

/** Everyone's own published plan (Phase 7a). */
export default async function MySchedulePage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/schedule/mine">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspacePage(
    workspaceSlug,
    "member",
    `/w/${workspaceSlug}/schedule/mine`,
  );
  const viewer = await viewerFor(ctx);
  const r = scheduleRangeParams(ctx, await searchParams, ["week", "month"]);
  const data = await readSchedule(getDb(), viewer, { ...r.range, plan: "published" });
  const qc = new QueryClient();
  qc.setQueryData(scheduleKeys.mine(workspaceSlug, r.range.from, r.range.to), data);
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <MySchedule
        slug={workspaceSlug}
        from={r.from}
        zoom={r.zoom}
        today={r.today}
        weekStart={r.weekStart}
      />
    </HydrationBoundary>
  );
}
