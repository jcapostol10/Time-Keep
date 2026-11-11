"use server";

import { assignmentInputSchema, assignmentPatchSchema, milestoneInputSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { z } from "zod";

import { type ActionResult, fromZodError, ok } from "@/lib/action-result";
import { actionFailure } from "@/server/actions/errors";
import { authorize } from "@/server/authz";
import { drainSoon } from "@/server/outbox-after";
import {
  copyAssignment,
  createAssignment,
  deleteAssignment,
  splitAssignmentAt,
  updateAssignment,
} from "@/server/schedule/assignments";
import { createMilestone, deleteMilestone, updateMilestone } from "@/server/schedule/milestones";
import { discardDrafts, publishSchedule } from "@/server/schedule/publish";
import { requireWorkspaceAccess } from "@/server/workspace-access";

/**
 * The schedule's writes (Phase 7a). Every action asks for the planner's
 * page first; the services then ask the matrix for the person and project
 * (`assignment.write`), the drafts (`schedule.publish`) or the project's
 * milestones (`milestone.manage`).
 */

const copySchema = z.object({ userId: z.string().min(1).optional(), startDate: z.iso.date() });
const splitSchema = z.object({ at: z.iso.date() });
const milestonePatchSchema = milestoneInputSchema.partial();

async function planner(slug: string) {
  const ctx = await requireWorkspaceAccess(slug);
  return authorize(ctx, "schedule.viewTeam");
}

export async function createAssignmentAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const viewer = await planner(slug);
    const parsed = assignmentInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok({ id: await createAssignment(getDb(), viewer, parsed.data) });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateAssignmentAction(
  slug: string,
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const viewer = await planner(slug);
    const parsed = assignmentPatchSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok({ id: await updateAssignment(getDb(), viewer, id, parsed.data) });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function deleteAssignmentAction(slug: string, id: string): Promise<ActionResult> {
  try {
    const viewer = await planner(slug);
    await deleteAssignment(getDb(), viewer, id);
    return ok(undefined);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function copyAssignmentAction(
  slug: string,
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const viewer = await planner(slug);
    const parsed = copySchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok({ id: await copyAssignment(getDb(), viewer, id, parsed.data) });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function splitAssignmentAction(
  slug: string,
  id: string,
  input: unknown,
): Promise<ActionResult<{ ids: [string, string] }>> {
  try {
    const viewer = await planner(slug);
    const parsed = splitSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok({ ids: await splitAssignmentAt(getDb(), viewer, id, parsed.data.at) });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function publishScheduleAction(
  slug: string,
): Promise<ActionResult<{ changed: number; notified: number }>> {
  try {
    const viewer = await planner(slug);
    const result = await publishSchedule(getDb(), viewer);
    if (result.notified > 0) drainSoon();
    return ok(result);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function discardScheduleAction(
  slug: string,
): Promise<ActionResult<{ discarded: number }>> {
  try {
    const viewer = await planner(slug);
    return ok({ discarded: await discardDrafts(getDb(), viewer) });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function createMilestoneAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const viewer = await planner(slug);
    const parsed = milestoneInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok({ id: await createMilestone(getDb(), viewer, parsed.data) });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateMilestoneAction(
  slug: string,
  id: string,
  input: unknown,
): Promise<ActionResult> {
  try {
    const viewer = await planner(slug);
    const parsed = milestonePatchSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await updateMilestone(getDb(), viewer, id, parsed.data);
    return ok(undefined);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function deleteMilestoneAction(slug: string, id: string): Promise<ActionResult> {
  try {
    const viewer = await planner(slug);
    await deleteMilestone(getDb(), viewer, id);
    return ok(undefined);
  } catch (error) {
    return actionFailure(error);
  }
}
