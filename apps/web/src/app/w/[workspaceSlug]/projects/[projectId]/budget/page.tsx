import { PiggyBankIcon } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { requireWorkspacePage } from "@/server/workspace-access";
import { authorize } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";

export const metadata: Metadata = { title: "Budget" };

export default async function ProjectBudgetPage({
  params,
}: PageProps<"/w/[workspaceSlug]/projects/[projectId]/budget">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspacePage(workspaceSlug);
  await authorizePage(() => authorize(ctx, "rate.view"));
  return (
    <EmptyState
      icon={PiggyBankIcon}
      title="Budgets and estimates arrive in Phase 6"
      description="Set a time or money estimate, watch progress on the projects list and get alerts as it fills up."
    />
  );
}
