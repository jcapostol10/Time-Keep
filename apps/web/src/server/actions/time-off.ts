"use server";

import {
  adjustmentSchema,
  holidayImportSchema,
  holidaySchema,
  localDateKey,
  timeOffPolicySchema,
} from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { type ActionResult, fromZodError, ok } from "@/lib/action-result";
import type { HolidayDTO, PolicyDTO } from "@/lib/time-off-types";
import { actionFailure } from "@/server/actions/errors";
import { authorize } from "@/server/authz";
import { addAdjustment } from "@/server/time-off/adjustments";
import { deleteHoliday, importHolidays, saveHoliday } from "@/server/time-off/holidays";
import { archivePolicy, savePolicy } from "@/server/time-off/policies";
import { requireWorkspaceAccess, type WorkspaceContext } from "@/server/workspace-access";

/** Policies, holidays and adjustments are the admins' (`timeOff.manage`). */
async function manager(slug: string) {
  const ctx = await requireWorkspaceAccess(slug);
  return { ctx, viewer: await authorize(ctx, "timeOff.manage", { kind: "none" }) };
}

function todayIn(ctx: WorkspaceContext): string {
  return localDateKey(new Date(), ctx.settings.timezone ?? "UTC");
}

export async function savePolicyAction(
  slug: string,
  input: unknown,
  id?: string,
): Promise<ActionResult<PolicyDTO>> {
  try {
    const { viewer } = await manager(slug);
    const parsed = timeOffPolicySchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await savePolicy(getDb(), viewer, parsed.data, id));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function archivePolicyAction(
  slug: string,
  id: string,
  archived: boolean,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { viewer } = await manager(slug);
    await archivePolicy(getDb(), viewer, id, archived === true);
    return ok({ id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function saveHolidayAction(
  slug: string,
  input: unknown,
  id?: string,
): Promise<ActionResult<HolidayDTO>> {
  try {
    const { viewer } = await manager(slug);
    const parsed = holidaySchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await saveHoliday(getDb(), viewer, parsed.data, id));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function deleteHolidayAction(
  slug: string,
  id: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { viewer } = await manager(slug);
    await deleteHoliday(getDb(), viewer, id);
    return ok({ id });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function importHolidaysAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ added: number }>> {
  try {
    const { viewer } = await manager(slug);
    const parsed = holidayImportSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await importHolidays(getDb(), viewer, parsed.data));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function addAdjustmentAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ userId: string }>> {
  try {
    const { ctx, viewer } = await manager(slug);
    const parsed = adjustmentSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    await addAdjustment(getDb(), viewer, parsed.data, todayIn(ctx));
    return ok({ userId: parsed.data.userId });
  } catch (error) {
    return actionFailure(error);
  }
}
