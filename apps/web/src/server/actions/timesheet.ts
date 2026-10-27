"use server";

import { copyWeekSchema, resolveViewerPrefs, timesheetTemplateInputSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import type { TimesheetTemplateDTO } from "@/lib/catalog-types";
import type { TimeEntryDTO } from "@/lib/tracker-types";
import { userErrorMessage } from "@/server/actions/errors";
import { copyWeek, deleteTemplate, saveTemplate } from "@/server/timesheet";
import { requireWorkspaceAccess } from "@/server/workspace-access";
import { viewerFor } from "@/server/authz";

/** Templates and copy-week are per member; no admin role needed. */

export async function saveTemplateAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<TimesheetTemplateDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const parsed = timesheetTemplateInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const viewer = await viewerFor(ctx);
    return ok(await saveTemplate(getDb(), viewer, parsed.data));
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function deleteTemplateAction(
  slug: string,
  templateId: string,
): Promise<ActionResult<null>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await viewerFor(ctx);
    await deleteTemplate(getDb(), viewer, templateId);
    return ok(null);
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}

export async function copyWeekAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<TimeEntryDTO[]>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const parsed = copyWeekSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const scope = await viewerFor(ctx);
    const tz = resolveViewerPrefs(ctx.user, ctx.settings).timezone;
    return ok(await copyWeek(getDb(), scope, { ...parsed.data, tz }));
  } catch (error) {
    return fail(userErrorMessage(error));
  }
}
