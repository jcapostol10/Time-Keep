"use server";

import {
  createManualEntrySchema,
  entryIdsSchema,
  projectInputSchema,
  startTimerSchema,
  stopTimerSchema,
  tagInputSchema,
  updateEntrySchema,
} from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import type { EntryTag, PickerProject, TimeEntryDTO } from "@/lib/tracker-types";
import { CatalogError } from "@/server/catalog/errors";
import { createProject } from "@/server/catalog/projects";
import { createTag } from "@/server/catalog/tags";
import {
  continueEntry,
  createManualEntry,
  deleteEntries,
  duplicateEntry,
  type EntryScope,
  restoreEntries,
  startTimer,
  stopTimer,
  TimeEntryError,
  updateEntry,
} from "@/server/time-entries";
import { requireWorkspaceAccess, WorkspaceAccessError } from "@/server/workspace-access";

export type StartResult = { started: TimeEntryDTO; stopped: TimeEntryDTO | null };

function errorMessage(error: unknown): string {
  if (error instanceof WorkspaceAccessError) return error.message;
  if (error instanceof TimeEntryError) return error.message;
  if (error instanceof CatalogError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

/** Members act only on their own entries until Phase 4 ("add time for others"). */
async function scopeFor(slug: string): Promise<EntryScope> {
  const ctx = await requireWorkspaceAccess(slug);
  return { workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role };
}

export async function startTimerAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<StartResult>> {
  try {
    const scope = await scopeFor(slug);
    const parsed = startTimerSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await startTimer(getDb(), scope, parsed.data));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function stopTimerAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<TimeEntryDTO>> {
  try {
    const scope = await scopeFor(slug);
    const parsed = stopTimerSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await stopTimer(getDb(), scope, parsed.data));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function createManualEntryAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<TimeEntryDTO>> {
  try {
    const scope = await scopeFor(slug);
    const parsed = createManualEntrySchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await createManualEntry(getDb(), scope, parsed.data));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function updateEntryAction(
  slug: string,
  entryId: string,
  input: unknown,
): Promise<ActionResult<TimeEntryDTO>> {
  try {
    const scope = await scopeFor(slug);
    const parsed = updateEntrySchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await updateEntry(getDb(), scope, entryId, parsed.data));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function deleteEntriesAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ deleted: string[] }>> {
  try {
    const scope = await scopeFor(slug);
    const parsed = entryIdsSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await deleteEntries(getDb(), scope, parsed.data.ids));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function restoreEntriesAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ restored: string[] }>> {
  try {
    const scope = await scopeFor(slug);
    const parsed = entryIdsSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await restoreEntries(getDb(), scope, parsed.data.ids));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function duplicateEntryAction(
  slug: string,
  entryId: string,
): Promise<ActionResult<TimeEntryDTO>> {
  try {
    const scope = await scopeFor(slug);
    return ok(await duplicateEntry(getDb(), scope, entryId));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function continueEntryAction(
  slug: string,
  entryId: string,
): Promise<ActionResult<StartResult>> {
  try {
    const scope = await scopeFor(slug);
    return ok(await continueEntry(getDb(), scope, entryId));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

/** Inline create from the picker. Admins only (the Phase 4 settings may open it up). */
export async function createProjectAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<PickerProject>> {
  try {
    const ctx = await requireWorkspaceAccess(slug, "admin");
    const parsed = projectInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const viewer = { workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.role };
    return ok(await createProject(getDb(), viewer, parsed.data));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

/** Inline create from the tag picker. Admins only. */
export async function createTagAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<EntryTag>> {
  try {
    const ctx = await requireWorkspaceAccess(slug, "admin");
    const parsed = tagInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const created = await createTag(getDb(), ctx.workspace.id, parsed.data);
    return ok({ id: created.id, name: created.name, color: created.color });
  } catch (error) {
    return fail(errorMessage(error));
  }
}
