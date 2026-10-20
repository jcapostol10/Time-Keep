"use server";

import { copyWeekSchema, resolveViewerPrefs, timesheetTemplateInputSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import type { TimesheetTemplateDTO } from "@/lib/catalog-types";
import type { TimeEntryDTO } from "@/lib/tracker-types";
import { CatalogError } from "@/server/catalog/errors";
import { TimeEntryError } from "@/server/time-entries";
import { copyWeek, deleteTemplate, saveTemplate } from "@/server/timesheet";
import { requireWorkspaceAccess, WorkspaceAccessError } from "@/server/workspace-access";

/** Templates and copy-week are per member; no admin role needed. */

function errorMessage(error: unknown): string {
  if (error instanceof WorkspaceAccessError) return error.message;
  if (error instanceof CatalogError) return error.message;
  if (error instanceof TimeEntryError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export async function saveTemplateAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<TimesheetTemplateDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const parsed = timesheetTemplateInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const viewer = { workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role };
    return ok(await saveTemplate(getDb(), viewer, parsed.data));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function deleteTemplateAction(
  slug: string,
  templateId: string,
): Promise<ActionResult<null>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = { workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role };
    await deleteTemplate(getDb(), viewer, templateId);
    return ok(null);
  } catch (error) {
    return fail(errorMessage(error));
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
    const scope = { workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role };
    const tz = resolveViewerPrefs(ctx.user, ctx.settings).timezone;
    return ok(await copyWeek(getDb(), scope, { ...parsed.data, tz }));
  } catch (error) {
    return fail(errorMessage(error));
  }
}
