"use server";

import { targetRuleSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { type ActionResult, fromZodError, ok } from "@/lib/action-result";
import type { TargetRuleDTO } from "@/lib/target-types";
import { actionFailure } from "@/server/actions/errors";
import { authorize } from "@/server/authz";
import { deleteTargetRule, saveTargetRule } from "@/server/targets";
import { requireWorkspaceAccess } from "@/server/workspace-access";

async function manager(slug: string) {
  const ctx = await requireWorkspaceAccess(slug);
  return authorize(ctx, "target.manage", { kind: "none" });
}

export async function saveTargetRuleAction(
  slug: string,
  input: unknown,
  id?: string,
): Promise<ActionResult<TargetRuleDTO>> {
  try {
    const viewer = await manager(slug);
    const parsed = targetRuleSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await saveTargetRule(getDb(), viewer, parsed.data, id));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function deleteTargetRuleAction(
  slug: string,
  id: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const viewer = await manager(slug);
    await deleteTargetRule(getDb(), viewer, id);
    return ok({ id });
  } catch (error) {
    return actionFailure(error);
  }
}
