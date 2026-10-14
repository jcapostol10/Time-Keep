"use server";

import {
  createManualEntrySchema,
  createProjectSchema,
  createTagSchema,
  entryIdsSchema,
  startTimerSchema,
  stopTimerSchema,
  updateEntrySchema,
} from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import type { EntryProject, EntryTag, TimeEntryDTO } from "@/lib/tracker-types";
import {
  continueEntry,
  createManualEntry,
  createProject,
  createTag,
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
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

/** Members act only on their own entries in Phase 1 ("add time for others" is Phase 4). */
async function scopeFor(slug: string): Promise<EntryScope> {
  const ctx = await requireWorkspaceAccess(slug);
  return { workspaceId: ctx.workspace.id, userId: ctx.user.id };
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

export async function createProjectAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<EntryProject>> {
  try {
    const scope = await scopeFor(slug);
    const parsed = createProjectSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await createProject(getDb(), scope.workspaceId, parsed.data));
  } catch (error) {
    return fail(errorMessage(error));
  }
}

export async function createTagAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<EntryTag>> {
  try {
    const scope = await scopeFor(slug);
    const parsed = createTagSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await createTag(getDb(), scope.workspaceId, parsed.data));
  } catch (error) {
    return fail(errorMessage(error));
  }
}
