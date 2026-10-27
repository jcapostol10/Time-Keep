import { resolveViewerPrefs, can } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { AppShell } from "@/components/shell/app-shell";
import { TimezoneDetector } from "@/components/tracker/timezone-detector";
import { TrackerProvider } from "@/components/tracker/tracker-provider";
import { getTrackerSettings } from "@/server/queries/user-settings";
import { getRunningEntry } from "@/server/time-entries";
import { listUserWorkspaces, requireWorkspacePage } from "@/server/workspace-access";
import { viewerFor } from "@/server/authz";
import { hiddenNavLabels } from "@/components/shell/nav-items";

export default async function WorkspaceLayout({
  children,
  params,
}: LayoutProps<"/w/[workspaceSlug]">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspacePage(workspaceSlug, "member", `/w/${workspaceSlug}`);
  const db = getDb();
  const scope = await viewerFor(ctx);
  const [workspaces, running, trackerSettings] = await Promise.all([
    listUserWorkspaces(db, ctx.user.id),
    getRunningEntry(db, scope),
    getTrackerSettings(db, ctx.user.id),
  ]);
  const viewer = resolveViewerPrefs(ctx.user, ctx.settings);

  return (
    <TrackerProvider
      slug={ctx.workspace.slug}
      workspaceId={ctx.workspace.id}
      canCreate={{
        project: can(scope.actor, "project.create", { kind: "project", projectId: null }),
        tag: can(scope.actor, "tag.create", { kind: "none" }),
      }}
      canSeeAmounts={can(scope.actor, "report.viewAmounts", { kind: "none" })}
      currency={ctx.settings.currency}
      viewer={viewer}
      settings={trackerSettings}
      initialRunning={running}
    >
      <AppShell
        user={{ name: ctx.user.name, email: ctx.user.email, image: ctx.user.image ?? null }}
        workspace={{
          id: ctx.workspace.id,
          name: ctx.workspace.name,
          slug: ctx.workspace.slug,
          role: ctx.role,
        }}
        workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, slug: w.slug, role: w.role }))}
        hiddenNav={hiddenNavLabels(scope.actor)}
      >
        {children}
      </AppShell>
      <TimezoneDetector hasTimezone={Boolean(ctx.user.timezone)} />
    </TrackerProvider>
  );
}
