import { resolveViewerPrefs } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import type { Metadata } from "next";

import { BudgetTab } from "@/components/projects/budget-tab";
import { workspaceRoutes } from "@/lib/routes";
import { authorizeProject } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";
import { getProjectBudget } from "@/server/budgets";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Budget" };

/** The project's estimate and progress (Phase 6b): owners, admins and the project's managers. */
export default async function ProjectBudgetPage({
  params,
}: PageProps<"/w/[workspaceSlug]/projects/[projectId]/budget">) {
  const { workspaceSlug, projectId } = await params;
  const ctx = await requireWorkspacePage(workspaceSlug);
  const viewer = await authorizePage(() => authorizeProject(ctx, "project.update", projectId));
  const prefs = resolveViewerPrefs(ctx.user, ctx.settings);
  const budget = await getProjectBudget(getDb(), viewer, projectId, new Date());
  return (
    <BudgetTab
      slug={workspaceSlug}
      projectId={projectId}
      budget={budget}
      durationFormat={prefs.durationFormat}
      settingsHref={`${workspaceRoutes.settings(workspaceSlug)}#budgets`}
    />
  );
}
