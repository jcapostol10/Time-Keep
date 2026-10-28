"use server";

import {
  bulkUpdateEntriesSchema,
  createManualEntrySchema,
  entryIdsSchema,
  splitEntrySchema,
  startTimerSchema,
  stopTimerSchema,
  updateEntrySchema,
} from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { type ActionResult, fromZodError, ok } from "@/lib/action-result";
import type { TimeEntryDTO } from "@/lib/tracker-types";
import { actionFailure } from "@/server/actions/errors";
import {
  bulkUpdateEntries,
  continueEntry,
  createManualEntry,
  deleteEntries,
  duplicateEntry,
  type EntryScope,
  restoreEntries,
  scopesForEntries,
  splitEntry,
  startTimer,
  stopTimer,
  TimeEntryError,
  updateEntry,
} from "@/server/time-entries";
import { requireWorkspaceAccess, type WorkspaceContext } from "@/server/workspace-access";
import { authorize, targetScope, viewerFor } from "@/server/authz";

export type StartResult = { started: TimeEntryDTO; stopped: TimeEntryDTO | null };

/** The caller's own scope: timers are always their own (decision 8). */
async function ownScope(ctx: WorkspaceContext): Promise<EntryScope> {
  return authorize(ctx, "entry.write", { kind: "entry", userId: ctx.user.id, projectId: null });
}

async function scopeFor(slug: string): Promise<EntryScope> {
  const ctx = await requireWorkspaceAccess(slug);
  return authorize(ctx, "entry.write", { kind: "entry", userId: ctx.user.id, projectId: null });
}

/** The scope of one entry by id (its owner's, acted for by the caller), or not found. */
async function entryScope(
  ctx: WorkspaceContext,
  entryId: string,
  includeDeleted = false,
): Promise<EntryScope> {
  const [group] = await scopesForEntries(getDb(), await viewerFor(ctx), [entryId], {
    includeDeleted,
  });
  if (!group) throw new TimeEntryError("NOT_FOUND", "Time entry not found.");
  return group.scope;
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
    return actionFailure(error);
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
    return actionFailure(error);
  }
}

export async function createManualEntryAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<TimeEntryDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const parsed = createManualEntrySchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const scope = await targetScope(ctx, parsed.data.userId ?? ctx.user.id);
    return ok(await createManualEntry(getDb(), scope, parsed.data));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateEntryAction(
  slug: string,
  entryId: string,
  input: unknown,
): Promise<ActionResult<TimeEntryDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const parsed = updateEntrySchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const scope = await entryScope(ctx, entryId);
    return ok(await updateEntry(getDb(), scope, entryId, parsed.data));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function deleteEntriesAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ deleted: string[] }>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const parsed = entryIdsSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const db = getDb();
    const deleted: string[] = [];
    for (const g of await scopesForEntries(db, await viewerFor(ctx), parsed.data.ids)) {
      deleted.push(...(await deleteEntries(db, g.scope, g.ids)).deleted);
    }
    return ok({ deleted });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function restoreEntriesAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ restored: string[] }>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const parsed = entryIdsSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const db = getDb();
    const groups = await scopesForEntries(db, await viewerFor(ctx), parsed.data.ids, {
      includeDeleted: true,
    });
    const restored: string[] = [];
    for (const g of groups) restored.push(...(await restoreEntries(db, g.scope, g.ids)).restored);
    return ok({ restored });
  } catch (error) {
    return actionFailure(error);
  }
}

export async function duplicateEntryAction(
  slug: string,
  entryId: string,
): Promise<ActionResult<TimeEntryDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    return ok(await duplicateEntry(getDb(), await entryScope(ctx, entryId), entryId));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function continueEntryAction(
  slug: string,
  entryId: string,
): Promise<ActionResult<StartResult>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const scope = await entryScope(ctx, entryId);
    return ok(await continueEntry(getDb(), scope, entryId, undefined, await ownScope(ctx)));
  } catch (error) {
    return actionFailure(error);
  }
}

/** Bulk edit: the selected entries, grouped by owner, all updated or none. */
export async function bulkUpdateEntriesAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ updated: TimeEntryDTO[] }>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const parsed = bulkUpdateEntriesSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const db = getDb();
    const groups = await scopesForEntries(db, await viewerFor(ctx), parsed.data.ids);
    return ok(await bulkUpdateEntries(db, groups, parsed.data.patch));
  } catch (error) {
    return actionFailure(error);
  }
}

/** Split: one entry becomes two at `at`; the owner's scope, acted for by the caller. */
export async function splitEntryAction(
  slug: string,
  entryId: string,
  input: unknown,
): Promise<ActionResult<{ first: TimeEntryDTO; second: TimeEntryDTO }>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const parsed = splitEntrySchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const scope = await entryScope(ctx, entryId);
    return ok(await splitEntry(getDb(), scope, entryId, parsed.data.at));
  } catch (error) {
    return actionFailure(error);
  }
}
