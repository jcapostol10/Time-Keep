"use server";

import { reopenRequestSchema, reviewRequestsSchema, submitPeriodSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { type ActionResult, fromZodError, ok } from "@/lib/action-result";
import type { ApprovalRequestDTO } from "@/lib/approval-types";
import { actionFailure } from "@/server/actions/errors";
import { reopenRequest, reviewRequests, submitPeriod, withdrawRequest } from "@/server/approvals";
import { authorize } from "@/server/authz";
import { drainSoon } from "@/server/outbox-after";
import { requireWorkspaceAccess, type WorkspaceContext } from "@/server/workspace-access";

/**
 * Everyone may submit their own periods; reviewing is checked per request in
 * the service (the approvers setting reads each request's person and projects).
 */
function ownPeriods(ctx: WorkspaceContext) {
  return authorize(ctx, "approval.submit", {
    kind: "approval",
    userId: ctx.user.id,
    projectIds: [],
  });
}

export async function submitPeriodAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<ApprovalRequestDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await ownPeriods(ctx);
    const parsed = submitPeriodSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const request = await submitPeriod(getDb(), viewer, parsed.data.periodStart);
    drainSoon();
    return ok(request);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function withdrawRequestAction(
  slug: string,
  requestId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await ownPeriods(ctx);
    await withdrawRequest(getDb(), viewer, requestId);
    return ok({ id: requestId });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function reviewRequestsAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<ApprovalRequestDTO[]>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await ownPeriods(ctx);
    const parsed = reviewRequestsSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const requests = await reviewRequests(getDb(), viewer, parsed.data);
    drainSoon();
    return ok(requests);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function reopenRequestAction(
  slug: string,
  requestId: string,
  input: unknown,
): Promise<ActionResult<ApprovalRequestDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await ownPeriods(ctx);
    const parsed = reopenRequestSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const request = await reopenRequest(getDb(), viewer, requestId, parsed.data.note);
    drainSoon();
    return ok(request);
  } catch (error) {
    return actionFailure(error);
  }
}
