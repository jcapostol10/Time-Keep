import { can } from "@timekeep/core";
import { redirect } from "next/navigation";

import { workspaceRoutes } from "@/lib/routes";
import { viewerFor } from "@/server/authz";
import { requireWorkspacePage } from "@/server/workspace-access";

/** Planners land on the team grid, everyone else on their own schedule. */
export default async function SchedulePage({ params }: PageProps<"/w/[workspaceSlug]/schedule">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspacePage(workspaceSlug, "member", `/w/${workspaceSlug}/schedule`);
  const viewer = await viewerFor(ctx);
  const planner = can(viewer.actor, "schedule.viewTeam", { kind: "none" });
  redirect(workspaceRoutes.schedule(workspaceSlug, planner ? "team" : "mine"));
}
