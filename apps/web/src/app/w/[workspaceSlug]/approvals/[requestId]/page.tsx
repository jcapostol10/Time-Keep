import { getDb } from "@timekeep/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PeriodView } from "@/components/approvals/period-view";
import { WorkspaceAccessError } from "@/server/access-error";
import { periodView } from "@/server/approvals";
import { authorize } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Approval" };

/** One submitted period: its days, totals and history; its owner and reviewers only. */
export default async function ApprovalPage({
  params,
}: PageProps<"/w/[workspaceSlug]/approvals/[requestId]">) {
  const { workspaceSlug, requestId } = await params;
  const ctx = await requireWorkspacePage(workspaceSlug);
  const viewer = await authorizePage(() =>
    authorize(ctx, "approval.submit", { kind: "approval", userId: ctx.user.id, projectIds: [] }),
  );
  let view;
  try {
    view = await periodView(getDb(), viewer, requestId);
  } catch (error) {
    // Someone else's period the viewer may not review: the same 404 as none.
    if (error instanceof WorkspaceAccessError) notFound();
    throw error;
  }
  return <PeriodView slug={workspaceSlug} view={view} />;
}
