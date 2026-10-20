import { CoinsIcon } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Rates" };

export default async function ProjectRatesPage({
  params,
}: PageProps<"/w/[workspaceSlug]/projects/[projectId]/rates">) {
  const { workspaceSlug } = await params;
  await requireWorkspacePage(workspaceSlug, "admin");
  return (
    <EmptyState
      icon={CoinsIcon}
      title="Billable rates arrive in Phase 4"
      description="Set rates per project, task or member, with history, and see amounts in reports."
    />
  );
}
