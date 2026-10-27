import { can } from "@timekeep/core";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { WorkspaceSettingsForm } from "@/components/settings/workspace-settings-form";
import { requireWorkspacePage } from "@/server/workspace-access";
import { viewerFor } from "@/server/authz";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: PageProps<"/w/[workspaceSlug]/settings">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspacePage(workspaceSlug);
  const viewer = await viewerFor(ctx);

  return (
    <>
      <PageHeader
        title="Workspace settings"
        description="Name, timezone and how times and durations are shown across the workspace."
      />
      <WorkspaceSettingsForm
        slug={workspaceSlug}
        readOnly={!can(viewer.actor, "workspace.update", { kind: "workspace" })}
        defaultValues={{
          name: ctx.workspace.name,
          timezone: ctx.settings.timezone,
          weekStart: ctx.settings.weekStart as 0 | 1 | 2 | 3 | 4 | 5 | 6,
          timeFormat: ctx.settings.timeFormat,
          durationFormat: ctx.settings.durationFormat,
          currency: ctx.settings.currency,
        }}
      />
    </>
  );
}
