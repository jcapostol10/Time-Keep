import { can } from "@timekeep/core";

import { PageHeader } from "@/components/page-header";
import { ScheduleTabs } from "@/components/schedule/schedule-tabs";
import { viewerFor } from "@/server/authz";
import { requireWorkspacePage } from "@/server/workspace-access";

/** The schedule's frame (Phase 7a): its tabs, planners' first. */
export default async function ScheduleLayout({
  params,
  children,
}: LayoutProps<"/w/[workspaceSlug]/schedule">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspacePage(workspaceSlug, "member", `/w/${workspaceSlug}/schedule`);
  const viewer = await viewerFor(ctx);
  const planner = can(viewer.actor, "schedule.viewTeam", { kind: "none" });
  return (
    <div>
      <PageHeader
        title="Schedule"
        description={
          planner
            ? "Plan who works on what. Changes are drafts until you publish them."
            : "What you are scheduled for."
        }
      />
      <ScheduleTabs slug={workspaceSlug} planner={planner} />
      {children}
    </div>
  );
}
