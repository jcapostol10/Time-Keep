"use server";

import { expenseCategoryInputSchema, expenseCategoryPatchSchema } from "@timekeep/core";
import { getDb } from "@timekeep/db";

import { type ActionResult, fromZodError, ok } from "@/lib/action-result";
import type { ExpenseCategoryDTO } from "@/lib/expense-types";
import { actionFailure } from "@/server/actions/errors";
import { authorize } from "@/server/authz";
import { createExpenseCategory, updateExpenseCategory } from "@/server/expense-categories";
import { requireWorkspaceAccess } from "@/server/workspace-access";

/** Expense categories (Phase 6c): owners and admins. */

export async function createExpenseCategoryAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<ExpenseCategoryDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await authorize(ctx, "expenseCategory.manage");
    const parsed = expenseCategoryInputSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await createExpenseCategory(getDb(), viewer, parsed.data));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updateExpenseCategoryAction(
  slug: string,
  categoryId: string,
  input: unknown,
): Promise<ActionResult<ExpenseCategoryDTO>> {
  try {
    const ctx = await requireWorkspaceAccess(slug);
    const viewer = await authorize(ctx, "expenseCategory.manage");
    const parsed = expenseCategoryPatchSchema.safeParse(input);
    if (!parsed.success) return fromZodError(parsed.error);
    return ok(await updateExpenseCategory(getDb(), viewer, categoryId, parsed.data));
  } catch (error) {
    return actionFailure(error);
  }
}
