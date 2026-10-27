import { CoinsIcon } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { requireWorkspacePage } from "@/server/workspace-access";
import { authorize, authorizePage } from "@/server/authz";

export const metadata: Metadata = { title: "Rates" };

export default async function ProjectRatesPage({
  params,
}: PageProps<"/w/[workspaceSlug]/projects/[projectId]/rates">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspacePage(workspaceSlug);
  await authorizePage(() => authorize(ctx, "rate.view"));
  return (
    <EmptyState
      icon={CoinsIcon}
      title="Billable rates arrive in Phase 4"
      description="Set rates per project, task or member, with history, and see amounts in reports."
    />
  );
}
