import "server-only";

import { randomUUID } from "node:crypto";

import type { ExpenseCategoryInput, ExpenseCategoryPatch } from "@timekeep/core";
import {
  and,
  asc,
  type Database,
  eq,
  expense,
  type ExpenseCategory,
  expenseCategory,
  sql,
} from "@timekeep/db";

import type { ExpenseCategoryDTO } from "@/lib/expense-types";

import { assertCan } from "./authz";
import { CatalogError, isUniqueViolation } from "./catalog/errors";
import type { Viewer } from "./catalog/viewer";

/**
 * Expense categories (Phase 6c decision 14): what an expense can be. Owners
 * and admins manage them; everyone lists the active ones. A UNIT category's
 * price is snapshotted on each expense, so changing it touches no history.
 */

type Executor = Pick<Database, "select" | "insert" | "update">;

const NAME_TAKEN = "A category with this name exists.";
const NOT_FOUND = "Category not found.";
const KIND_IN_USE = "This category has expenses; its kind cannot change.";

export function toCategoryDTO(row: ExpenseCategory): ExpenseCategoryDTO {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    unitName: row.unitName,
    unitPriceMinor: row.unitPriceMinor,
    billableDefault: row.billableDefault,
    archived: row.archived,
  };
}

/** Every active category of the workspace, by name; archived ones on request. */
export async function listExpenseCategories(
  db: Executor,
  viewer: Pick<Viewer, "workspaceId">,
  opts: { includeArchived?: boolean } = {},
): Promise<ExpenseCategoryDTO[]> {
  const rows = await db
    .select()
    .from(expenseCategory)
    .where(
      and(
        eq(expenseCategory.workspaceId, viewer.workspaceId),
        opts.includeArchived ? undefined : eq(expenseCategory.archived, false),
      ),
    )
    .orderBy(asc(expenseCategory.name));
  return rows.map(toCategoryDTO);
}

export async function createExpenseCategory(
  db: Executor,
  viewer: Viewer,
  input: ExpenseCategoryInput,
): Promise<ExpenseCategoryDTO> {
  assertCan(viewer.actor, "expenseCategory.manage", { kind: "none" });
  const unit = input.kind === "UNIT";
  try {
    const [row] = await db
      .insert(expenseCategory)
      .values({
        id: randomUUID(),
        workspaceId: viewer.workspaceId,
        name: input.name.trim(),
        kind: input.kind,
        unitName: unit ? input.unitName : null,
        unitPriceMinor: unit ? input.unitPriceMinor : null,
        billableDefault: input.billableDefault,
      })
      .returning();
    if (!row) throw new Error("insert returned no row");
    return toCategoryDTO(row);
  } catch (error) {
    if (isUniqueViolation(error, "expense_category_workspace_name_uq")) {
      throw new CatalogError("CONFLICT", NAME_TAKEN);
    }
    throw error;
  }
}

/** Patches a category; saved expenses keep their own snapshots of the price. */
export async function updateExpenseCategory(
  db: Executor,
  viewer: Viewer,
  categoryId: string,
  patch: ExpenseCategoryPatch,
): Promise<ExpenseCategoryDTO> {
  assertCan(viewer.actor, "expenseCategory.manage", { kind: "none" });
  const [before] = await db
    .select()
    .from(expenseCategory)
    .where(
      and(eq(expenseCategory.id, categoryId), eq(expenseCategory.workspaceId, viewer.workspaceId)),
    );
  if (!before) throw new CatalogError("NOT_FOUND", NOT_FOUND);
  const kind = patch.kind ?? before.kind;
  if (kind !== before.kind) {
    // Saved expenses are priced by their category's kind: a FIXED one has no quantity to
    // price, a UNIT one no typed amount. Once any exist, the kind is fixed.
    const [used] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(expense)
      .where(eq(expense.categoryId, categoryId));
    if ((used?.n ?? 0) > 0) throw new CatalogError("CONFLICT", KIND_IN_USE);
  }
  try {
    const [row] = await db
      .update(expenseCategory)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.unitName !== undefined || kind === "FIXED"
          ? { unitName: kind === "UNIT" ? patch.unitName : null }
          : {}),
        ...(patch.unitPriceMinor !== undefined || kind === "FIXED"
          ? { unitPriceMinor: kind === "UNIT" ? patch.unitPriceMinor : null }
          : {}),
        ...(patch.billableDefault !== undefined ? { billableDefault: patch.billableDefault } : {}),
        ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
      })
      .where(eq(expenseCategory.id, categoryId))
      .returning();
    if (!row) throw new CatalogError("NOT_FOUND", NOT_FOUND);
    return toCategoryDTO(row);
  } catch (error) {
    if (isUniqueViolation(error, "expense_category_workspace_name_uq")) {
      throw new CatalogError("CONFLICT", NAME_TAKEN);
    }
    throw error;
  }
}
