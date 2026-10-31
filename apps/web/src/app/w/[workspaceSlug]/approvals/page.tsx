import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ApprovalsPageClient } from "@/components/approvals/approvals-page-client";
import { PageHeader } from "@/components/page-header";
import { mayReviewAny } from "@/components/shell/nav-items";
import type { ApprovalsTab } from "@/lib/approval-types";
import { authorize } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Approvals" };

const TABS: readonly ApprovalsTab[] = ["pending", "unsubmitted", "archive", "mine"];

/** Periods to review (Phase 5a): for owners, admins and, per the setting, managers. */
export default async function ApprovalsPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/approvals">) {
  const { workspaceSlug } = await params;
  const raw = await searchParams;
  const ctx = await requireWorkspacePage(workspaceSlug);
  const viewer = await authorizePage(() =>
    authorize(ctx, "approval.submit", { kind: "approval", userId: ctx.user.id, projectIds: [] }),
  );
  if (!ctx.settings.approvalEnabled) notFound();
  const reviewer = mayReviewAny(viewer.actor);
  // Everyone sees their own requests (Mine); reviewers also the team's.
  const asked = TABS.find((t) => t === raw.tab);
  const tab = reviewer ? (asked ?? "pending") : "mine";
  return (
    <>
      <PageHeader
        title="Approvals"
        description="Periods people submitted for approval, the closed periods nobody submitted yet, and the decisions made."
      />
      <ApprovalsPageClient slug={workspaceSlug} tab={tab} reviewer={reviewer} />
    </>
  );
}
