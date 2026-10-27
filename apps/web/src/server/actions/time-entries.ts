"use server";

import {
  createManualEntrySchema,
  entryIdsSchema,
  startTimerSchema,
  stopTimerSchema,
  updateEntrySchema,
} from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { type ActionResult, fail, fromZodError, ok } from "@/lib/action-result";
import type { TimeEntryDTO } from "@/lib/tracker-types";
import { userErrorMessage } from "@/server/actions/errors";
import {
  continueEntry,
  createManualEntry,
  deleteEntries,
  duplicateEntry,
  type EntryScope,
  restoreEntries,
  startTimer,
  stopTimer,
  updateEntry,
} from "@/server/time-entries";
import { requireWorkspaceAccess } from "@/server/workspace-access";
import { authorize } from "@/server/authz";

export type StartResult = { started: TimeEntryDTO; stopped: TimeEntryDTO | null };

/** Everyone acts on their own entries here; Phase 4b adds time for others. */
async function scopeFor(slug: string): Promise<EntryScope> {
  const ctx = await requireWorkspaceAccess(slug);
  return authorize(ctx, "entry.write", { kind: "entry", userId: ctx.user.id, projectId: null });
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
    return fail(userErrorMessage(error));
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
    return fail(userErrorMessage(error));
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
    return fail(userErrorMessage(error));
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
    return fail(userErrorMessage(error));
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
    return fail(userErrorMessage(error));
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
    return fail(userErrorMessage(error));
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
    return fail(userErrorMessage(error));
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
    return fail(userErrorMessage(error));
  }
}
