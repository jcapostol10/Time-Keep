"use server";

import { entryNoteInputSchema, expenseInputSchema, expensePatchSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { type ActionResult, fromZodError, ok } from "@/lib/action-result";
import type { ExpenseDTO } from "@/lib/expense-types";
import { actionFailure } from "@/server/actions/errors";
import { authorize, targetScope, viewerFor } from "@/server/authz";
import {
  createExpense,
  deleteExpense,
  expenseScope,
  restoreExpense,
  updateExpense,
} from "@/server/expenses";
import { requireWorkspaceAccess } from "@/server/workspace-access";

/**
 * Expenses (Phase 6c): the caller's own, or someone else's for those who may
 * add for them (`expense.write`, the entries' rule). A write into a submitted
 * period by an owner or admin needs a `note`; the client asks and resends.
 */

export async function createExpenseAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<ExpenseDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const parsed = expenseInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const userId = parsed.data.userId ?? ctx.user.id;
    // Someone outside the caller's people is not found (targetScope); then the expense rule.
    const scope = await targetScope(ctx, userId);
    await authorize(ctx, "expense.write", {
      kind: "entry",
      userId,
      projectId: parsed.data.projectId,
    });
    return ok(await createExpense(getDb(), scope, parsed.data));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateExpenseAction(
  slug: string,
  expenseId: string,
  input: unknown,
): Promise<ActionResult<ExpenseDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const parsed = expensePatchSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const db = getDb();
    const { scope } = await expenseScope(db, await viewerFor(ctx), expenseId);
    return ok(await updateExpense(db, scope, expenseId, parsed.data));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function deleteExpenseAction(
  slug: string,
  expenseId: string,
  input: unknown = {},
): Promise<ActionResult> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const parsed = entryNoteInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const db = getDb();
    const { scope } = await expenseScope(db, await viewerFor(ctx), expenseId);
    await deleteExpense(db, scope, expenseId, { note: parsed.data.note });
    return ok(undefined);
  } catch (error) {
    return actionFailure(error);
  }
}

export async function restoreExpenseAction(
  slug: string,
  expenseId: string,
  input: unknown = {},
): Promise<ActionResult<ExpenseDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const parsed = entryNoteInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    const db = getDb();
    const { scope } = await expenseScope(db, await viewerFor(ctx), expenseId);
    return ok(await restoreExpense(db, scope, expenseId, { note: parsed.data.note }));
  } catch (error) {
    return actionFailure(error);
  }
}
