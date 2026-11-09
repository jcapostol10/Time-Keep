import "server-only";

import { randomUUID } from "node:crypto";

import {
  type Actor,
  addDaysInZone,
  can,
  EMPTY_EXPENSE_TOTALS,
  expenseAmount,
  type ExpenseInput,
  type ExpensePatch,
  type ExpenseTotals,
  localDateKey,
  NONE_ID,
  type ReceiptType,
  type ReportQuery,
  resolveReportRange,
  type ViewerPrefs,
} from "@timekeep/core";
import {
  and,
  client,
  type Database,
  desc,
  eq,
  type Expense,
  expense,
  expenseCategory,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  project,
  sql,
  user,
  userGroup,
  userGroupMember,
} from "@timekeep/db";
import type { SQL } from "drizzle-orm";

import type { ExpenseDTO, ExpensePage } from "@/lib/expense-types";

import { WorkspaceAccessError } from "./access-error";
import { assertCan, scopeForUser } from "./authz";
import { workspaceCurrency } from "./catalog/clients";
import { CatalogError } from "./catalog/errors";
import { requireVisibleProject } from "./catalog/projects";
import type { Viewer } from "./catalog/viewer";
import { TimeEntryError } from "./entry-error";
import { assertExpenseWritable, expenseLockedReasons } from "./expense-guard";
import { timerLock } from "./person-lock";
import type { EntryScope } from "./time-entries";

/**
 * The expense service (Phase 6c): the only writer of `expense`. Every write
 * runs under the person's advisory lock and through `assertExpenseWritable`
 * (`expense-writable-coverage.test.ts`). Reads are scoped by the matrix's
 * `expense.read` over the expense's person and project, in SQL through
 * `expenseScopeFilter`; `expenseConditions` is the one filter the list, the
 * report and the receipts zip share.
 */

type Executor = Pick<Database, "query" | "select" | "insert" | "update" | "delete" | "execute">;

const NOT_FOUND = "Expense not found.";
const PROJECT_UNAVAILABLE = "This project is not available.";
const CATEGORY_UNAVAILABLE = "This category is not available.";
const CATEGORY_ARCHIVED = "This category is archived.";
const AMOUNT_REQUIRED = "Enter an amount.";
const QUANTITY_REQUIRED = "Enter a quantity.";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Which `expense` rows the actor may read (`expense.read`): none filtered for
 * owners and admins, nor for members when the workspace shows the team's
 * time; own, their people's and their projects' for a manager; own for a
 * member. Combine with the workspace filter; never use alone.
 */
export function expenseScopeFilter(actor: Actor): SQL | undefined {
  if (actor.role === "owner" || actor.role === "admin") return undefined;
  if (actor.role === "member") {
    return actor.settings.membersSeeTeamTime ? undefined : eq(expense.userId, actor.userId);
  }
  const parts: SQL[] = [eq(expense.userId, actor.userId)];
  if (actor.managedUserIds.size > 0) {
    parts.push(inArray(expense.userId, [...actor.managedUserIds]));
  }
  if (actor.managedProjectIds.size > 0) {
    parts.push(inArray(expense.projectId, [...actor.managedProjectIds]));
  }
  return parts.length === 1 ? parts[0] : or(...parts);
}

/** The local date keys a report range covers, inclusive, in the viewer's zone. */
export function rangeDateKeys(
  query: ReportQuery,
  prefs: ViewerPrefs,
  now: Date,
): { from: string; to: string; label: string } {
  const range = resolveReportRange(query, prefs, now);
  const tz = prefs.timezone;
  return {
    from: localDateKey(range.from, tz),
    to: localDateKey(addDaysInZone(range.to, -1, tz), tz),
    label: range.label,
  };
}

/**
 * The filters of the Expenses page, report and receipts zip: the range as
 * date keys, people, groups, clients, projects, categories and billable,
 * live rows only, inside the viewer's scope. A member's scope is their own
 * rows, so a person filter never widens it; a manager's narrows within it.
 */
export function expenseConditions(
  viewer: Viewer,
  query: ReportQuery,
  prefs: ViewerPrefs,
  now: Date,
): SQL[] {
  const keys = rangeDateKeys(query, prefs, now);
  const conds: SQL[] = [
    eq(expense.workspaceId, viewer.workspaceId),
    isNull(expense.deletedAt),
    gte(expense.date, keys.from),
    lte(expense.date, keys.to),
  ];
  const scope = expenseScopeFilter(viewer.actor);
  if (scope) conds.push(scope);
  // A member's query is pinned to themselves, as the report engine's `effectiveQuery` does;
  // a manager's person or group filter narrows within the scope filter, never widens it.
  const eff = can(viewer.actor, "report.readTeam", { kind: "none" })
    ? query
    : { ...query, userIds: [viewer.userId], groupIds: [] };
  if (eff.userIds.length > 0) conds.push(inArray(expense.userId, eff.userIds));
  if (eff.groupIds.length > 0) {
    conds.push(
      inArray(
        expense.userId,
        sql`(select ${userGroupMember.userId} from ${userGroupMember} inner join ${userGroup} on ${userGroup.id} = ${userGroupMember.groupId} where ${userGroup.workspaceId} = ${viewer.workspaceId} and ${inArray(userGroupMember.groupId, eff.groupIds)})`,
      ),
    );
  }
  if (query.clientIds.length > 0) {
    const real = query.clientIds.filter((id) => id !== NONE_ID);
    const parts: SQL[] = [];
    if (real.length > 0) parts.push(inArray(project.clientId, real));
    if (query.clientIds.includes(NONE_ID)) parts.push(isNull(project.clientId));
    conds.push(
      inArray(
        expense.projectId,
        sql`(select ${project.id} from ${project} where ${project.workspaceId} = ${viewer.workspaceId} and ${parts.length === 1 ? parts[0]! : or(...parts)!})`,
      ),
    );
  }
  if (query.projectIds.length > 0) {
    conds.push(
      inArray(
        expense.projectId,
        query.projectIds.filter((id) => id !== NONE_ID),
      ),
    );
  }
  if (query.categoryIds.length > 0) conds.push(inArray(expense.categoryId, query.categoryIds));
  if (query.billable !== "all") conds.push(eq(expense.billable, query.billable === "yes"));
  return conds;
}

type ExpenseRow = {
  expense: Expense;
  userName: string | null;
  projectName: string;
  projectColor: string;
  clientName: string | null;
  categoryName: string;
  categoryKind: Expense extends never ? never : "FIXED" | "UNIT";
  unitName: string | null;
};

const ROW_SELECT = {
  expense,
  userName: user.name,
  projectName: project.name,
  projectColor: project.color,
  clientName: client.name,
  categoryName: expenseCategory.name,
  categoryKind: expenseCategory.kind,
  unitName: expenseCategory.unitName,
};

/** The list's select with its joins; conditions are the caller's. */
function selectRows(db: Executor) {
  return db
    .select(ROW_SELECT)
    .from(expense)
    .leftJoin(user, eq(user.id, expense.userId))
    .innerJoin(project, eq(project.id, expense.projectId))
    .leftJoin(client, eq(client.id, project.clientId))
    .innerJoin(expenseCategory, eq(expenseCategory.id, expense.categoryId));
}

export function toExpenseDTO(
  row: ExpenseRow,
  flags: { editable: boolean; lockedReason: string | null },
): ExpenseDTO {
  const e = row.expense;
  return {
    id: e.id,
    userId: e.userId,
    userName: row.userName ?? "(former member)",
    projectId: e.projectId,
    projectName: row.projectName,
    projectColor: row.projectColor,
    clientName: row.clientName,
    categoryId: e.categoryId,
    categoryName: row.categoryName,
    categoryKind: row.categoryKind,
    unitName: row.unitName,
    date: e.date,
    amountMinor: e.amountMinor,
    quantityCenti: e.quantityCenti,
    unitPriceMinor: e.unitPriceMinor,
    billable: e.billable,
    description: e.description,
    receipt:
      e.receiptKey && e.receiptMime
        ? { mime: e.receiptMime as ReceiptType, thumb: e.receiptThumbKey !== null }
        : null,
    invoiced: e.invoiceId !== null,
    editable: flags.editable,
    lockedReason: flags.lockedReason,
    updatedAt: e.updatedAt.toISOString(),
  };
}

/** The owner's scope for the guard: the viewer themselves, or the owner acted for by the viewer. */
function scopeOf(viewer: EntryScope, ownerId: string): EntryScope {
  if (ownerId === viewer.userId) return viewer;
  return { ...viewer, userId: ownerId, actedBy: viewer.actedBy ?? viewer.actor };
}

function canEdit(viewer: EntryScope, e: Pick<Expense, "userId" | "projectId">): boolean {
  return can(viewer.actedBy ?? viewer.actor, "expense.write", {
    kind: "entry",
    userId: e.userId,
    projectId: e.projectId,
  });
}

/** Rows to DTOs with the viewer's flags; locked reasons are read per owner. */
async function toDTOs(
  db: Executor,
  viewer: EntryScope,
  rows: ExpenseRow[],
  now: Date,
): Promise<ExpenseDTO[]> {
  const byOwner = new Map<string, ExpenseRow[]>();
  for (const row of rows) {
    const list = byOwner.get(row.expense.userId) ?? [];
    list.push(row);
    byOwner.set(row.expense.userId, list);
  }
  const locked = new Map<string, string>();
  for (const [ownerId, owned] of byOwner) {
    const reasons = await expenseLockedReasons(
      db,
      scopeOf(viewer, ownerId),
      owned.map((r) => ({ id: r.expense.id, date: r.expense.date })),
      now,
    );
    for (const [id, reason] of reasons) locked.set(id, reason);
  }
  return rows.map((row) =>
    toExpenseDTO(row, {
      editable: canEdit(viewer, row.expense),
      lockedReason: locked.get(row.expense.id) ?? null,
    }),
  );
}

async function loadDTO(
  db: Executor,
  viewer: EntryScope,
  id: string,
  now: Date,
): Promise<ExpenseDTO> {
  const [row] = await selectRows(db).where(eq(expense.id, id));
  if (!row) throw new TimeEntryError("NOT_FOUND", NOT_FOUND);
  const [dto] = await toDTOs(db, viewer, [row], now);
  return dto!;
}

function parseCursor(cursor: string): { date: string; id: string } {
  const at = cursor.indexOf("|");
  if (at < 0) throw new TimeEntryError("INVALID", "Invalid cursor.");
  const date = cursor.slice(0, at);
  const id = cursor.slice(at + 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !id)
    throw new TimeEntryError("INVALID", "Invalid cursor.");
  return { date, id };
}

/**
 * The Expenses page: the viewer's visible expenses matching the query, newest
 * first, by keyset on (date, id). Totals cover the whole filter and come with
 * the first page only.
 */
export async function listExpenses(
  db: Executor,
  viewer: EntryScope,
  query: ReportQuery,
  prefs: ViewerPrefs,
  paging: { cursor?: string; limit?: number } = {},
  now: Date = new Date(),
): Promise<ExpensePage> {
  const limit = Math.min(Math.max(paging.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const conds = expenseConditions(viewer, query, prefs, now);
  const where = [...conds];
  if (paging.cursor) {
    const c = parseCursor(paging.cursor);
    where.push(or(lt(expense.date, c.date), and(eq(expense.date, c.date), lt(expense.id, c.id)))!);
  }
  const [rows, totals, currency] = await Promise.all([
    selectRows(db)
      .where(and(...where))
      .orderBy(desc(expense.date), desc(expense.id))
      .limit(limit + 1),
    paging.cursor ? Promise.resolve(EMPTY_EXPENSE_TOTALS) : expenseTotals(db, conds),
    workspaceCurrency(db, viewer.workspaceId),
  ]);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    currency,
    expenses: await toDTOs(db, viewer, page, now),
    totals,
    nextCursor: rows.length > limit && last ? `${last.expense.date}|${last.expense.id}` : null,
  };
}

/** Count and sums over `conds` (the whole filter). */
export async function expenseTotals(db: Executor, conds: SQL[]): Promise<ExpenseTotals> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      amountMinor: sql`coalesce(sum(${expense.amountMinor}), 0)::bigint`.mapWith(Number),
      billableMinor:
        sql`coalesce(sum(${expense.amountMinor}) filter (where ${expense.billable}), 0)::bigint`.mapWith(
          Number,
        ),
    })
    .from(expense)
    .where(and(...conds));
  return row ?? EMPTY_EXPENSE_TOTALS;
}

/**
 * One person's live expenses dated in `[from, to]` (date keys), by date: the
 * approval period view. The caller has already checked who may see the period.
 */
export async function listExpensesForPerson(
  db: Executor,
  viewer: EntryScope,
  userId: string,
  range: { start: string; end: string },
  now: Date = new Date(),
): Promise<ExpenseDTO[]> {
  const rows = await selectRows(db)
    .where(
      and(
        eq(expense.workspaceId, viewer.workspaceId),
        eq(expense.userId, userId),
        isNull(expense.deletedAt),
        gte(expense.date, range.start),
        lte(expense.date, range.end),
      ),
    )
    .orderBy(expense.date, expense.id);
  return toDTOs(db, viewer, rows, now);
}

/** One expense the viewer may read (`expense.read` over its person and project), else 404. */
export async function getExpense(
  db: Executor,
  viewer: EntryScope,
  expenseId: string,
  now: Date = new Date(),
): Promise<ExpenseDTO> {
  const [row] = await selectRows(db).where(
    and(
      eq(expense.id, expenseId),
      eq(expense.workspaceId, viewer.workspaceId),
      isNull(expense.deletedAt),
    ),
  );
  if (!row) throw new WorkspaceAccessError(404, "Not found");
  assertCan(viewer.actedBy ?? viewer.actor, "expense.read", {
    kind: "entry",
    userId: row.expense.userId,
    projectId: row.expense.projectId,
  });
  const [dto] = await toDTOs(db, viewer, [row], now);
  return dto!;
}

/**
 * The write scope of an existing expense: its row, live and in the workspace,
 * and its owner's scope acted for by the viewer (`scopeForUser`). Outside the
 * viewer's people (anyone, for a member) it is not found.
 */
export async function expenseScope(
  db: Executor,
  viewer: Viewer,
  expenseId: string,
): Promise<{ scope: EntryScope; row: Expense }> {
  const [row] = await db
    .select()
    .from(expense)
    .where(and(eq(expense.id, expenseId), eq(expense.workspaceId, viewer.workspaceId)));
  if (!row) throw new WorkspaceAccessError(404, "Not found");
  const scope = await scopeForUser(db, viewer, row.userId);
  return { scope, row };
}

/** The project, visible to the owner and taking expenses, else INVALID. */
async function usableProject(db: Executor, scope: EntryScope, projectId: string) {
  try {
    const row = await requireVisibleProject(db, scope, projectId);
    if (row.archived) throw new TimeEntryError("INVALID", PROJECT_UNAVAILABLE);
    return row;
  } catch (error) {
    if (error instanceof CatalogError) throw new TimeEntryError("INVALID", PROJECT_UNAVAILABLE);
    throw error;
  }
}

async function usableCategory(db: Executor, workspaceId: string, categoryId: string) {
  const [row] = await db
    .select()
    .from(expenseCategory)
    .where(and(eq(expenseCategory.id, categoryId), eq(expenseCategory.workspaceId, workspaceId)));
  if (!row) throw new TimeEntryError("INVALID", CATEGORY_UNAVAILABLE);
  if (row.archived) throw new TimeEntryError("INVALID", CATEGORY_ARCHIVED);
  return row;
}

interface Money {
  amountMinor: number;
  quantityCenti: number | null;
  unitPriceMinor: number | null;
}

/** The stored money of an expense from what was typed and the category's kind and price. */
function moneyOf(
  kind: "FIXED" | "UNIT",
  typed: { amountMinor?: number | null; quantityCenti?: number | null },
  unitPriceMinor: number | null,
): Money {
  if (kind === "FIXED") {
    if (typed.amountMinor === undefined || typed.amountMinor === null) {
      throw new TimeEntryError("INVALID", AMOUNT_REQUIRED);
    }
    return { amountMinor: typed.amountMinor, quantityCenti: null, unitPriceMinor: null };
  }
  if (typed.quantityCenti === undefined || typed.quantityCenti === null) {
    throw new TimeEntryError("INVALID", QUANTITY_REQUIRED);
  }
  const price = unitPriceMinor ?? 0;
  return {
    amountMinor: expenseAmount(typed.quantityCenti, price),
    quantityCenti: typed.quantityCenti,
    unitPriceMinor: price,
  };
}

/** Records an expense for the scope's person (the caller, or someone they add for). */
export async function createExpense(
  db: Database,
  scope: EntryScope,
  input: ExpenseInput,
  opts: { note?: string; now?: Date } = {},
): Promise<ExpenseDTO> {
  const now = opts.now ?? new Date();
  await usableProject(db, scope, input.projectId);
  const category = await usableCategory(db, scope.workspaceId, input.categoryId);
  const money = moneyOf(category.kind, input, category.unitPriceMinor);
  return db.transaction(async (tx) => {
    await tx.execute(timerLock(scope.workspaceId, scope.userId));
    const id = randomUUID();
    await assertExpenseWritable(
      tx,
      scope,
      { expenseId: id, after: input.date },
      { note: opts.note ?? input.note, now },
    );
    await tx.insert(expense).values({
      id,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      projectId: input.projectId,
      categoryId: input.categoryId,
      date: input.date,
      ...money,
      billable: input.billable,
      description: input.description.trim(),
      createdBy: (scope.actedBy ?? scope.actor).userId,
    });
    return loadDTO(tx, scope, id, now);
  });
}

/** The patched fields that change, for the ADMIN_EDIT log. */
function changesOf(
  row: Expense,
  next: Pick<Expense, "projectId" | "categoryId" | "date" | "billable" | "description"> & Money,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const put = (key: string, from: unknown, to: unknown) => {
    if (from !== to) out[key] = { from, to };
  };
  put("projectId", row.projectId, next.projectId);
  put("categoryId", row.categoryId, next.categoryId);
  put("date", row.date, next.date);
  put("amountMinor", row.amountMinor, next.amountMinor);
  put("quantityCenti", row.quantityCenti, next.quantityCenti);
  put("billable", row.billable, next.billable);
  put("description", row.description, next.description);
  return out;
}

async function liveRow(tx: Executor, scope: EntryScope, expenseId: string): Promise<Expense> {
  const [row] = await tx
    .select()
    .from(expense)
    .where(
      and(
        eq(expense.id, expenseId),
        eq(expense.workspaceId, scope.workspaceId),
        eq(expense.userId, scope.userId),
      ),
    );
  if (!row) throw new TimeEntryError("NOT_FOUND", NOT_FOUND);
  return row;
}

/**
 * Patches an expense. A category change re-snapshots the unit price; a
 * quantity change recomputes the amount with the stored price.
 */
export async function updateExpense(
  db: Database,
  scope: EntryScope,
  expenseId: string,
  patch: ExpensePatch,
  opts: { note?: string; now?: Date } = {},
): Promise<ExpenseDTO> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    await tx.execute(timerLock(scope.workspaceId, scope.userId));
    const row = await liveRow(tx, scope, expenseId);
    if (row.deletedAt) throw new TimeEntryError("NOT_FOUND", NOT_FOUND);
    const projectId = patch.projectId ?? row.projectId;
    if (projectId !== row.projectId) await usableProject(tx, scope, projectId);
    const categoryChanged = patch.categoryId !== undefined && patch.categoryId !== row.categoryId;
    const category = categoryChanged
      ? await usableCategory(tx, scope.workspaceId, patch.categoryId!)
      : await currentCategory(tx, row.categoryId);
    // The price in force: the new category's, or the one saved on the expense.
    const price = categoryChanged
      ? category.unitPriceMinor
      : (row.unitPriceMinor ?? category.unitPriceMinor);
    const money = moneyOf(
      category.kind,
      {
        amountMinor: patch.amountMinor ?? (categoryChanged ? undefined : row.amountMinor),
        quantityCenti: patch.quantityCenti ?? (categoryChanged ? undefined : row.quantityCenti),
      },
      price,
    );
    const next = {
      projectId,
      categoryId: category.id,
      date: patch.date ?? row.date,
      billable: patch.billable ?? row.billable,
      description: patch.description?.trim() ?? row.description,
      ...money,
    };
    await assertExpenseWritable(
      tx,
      scope,
      { expenseId, before: row.date, after: next.date, changes: changesOf(row, next) },
      { note: opts.note ?? patch.note, now },
    );
    await tx.update(expense).set(next).where(eq(expense.id, expenseId));
    return loadDTO(tx, scope, expenseId, now);
  });
}

async function currentCategory(tx: Executor, categoryId: string) {
  const [row] = await tx.select().from(expenseCategory).where(eq(expenseCategory.id, categoryId));
  if (!row) throw new TimeEntryError("INVALID", CATEGORY_UNAVAILABLE);
  return row;
}

/** Soft-deletes an expense; `restoreExpense` undoes it. */
export async function deleteExpense(
  db: Database,
  scope: EntryScope,
  expenseId: string,
  opts: { note?: string; now?: Date } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  await db.transaction(async (tx) => {
    await tx.execute(timerLock(scope.workspaceId, scope.userId));
    const row = await liveRow(tx, scope, expenseId);
    if (row.deletedAt) return;
    await assertExpenseWritable(
      tx,
      scope,
      { expenseId, before: row.date, changes: { deleted: { from: false, to: true } } },
      { note: opts.note, now },
    );
    await tx.update(expense).set({ deletedAt: now }).where(eq(expense.id, expenseId));
  });
}

export async function restoreExpense(
  db: Database,
  scope: EntryScope,
  expenseId: string,
  opts: { note?: string; now?: Date } = {},
): Promise<ExpenseDTO> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    await tx.execute(timerLock(scope.workspaceId, scope.userId));
    const row = await liveRow(tx, scope, expenseId);
    if (row.deletedAt) {
      await assertExpenseWritable(
        tx,
        scope,
        { expenseId, after: row.date, changes: { deleted: { from: true, to: false } } },
        { note: opts.note, now },
      );
      await tx.update(expense).set({ deletedAt: null }).where(eq(expense.id, expenseId));
    }
    return loadDTO(tx, scope, expenseId, now);
  });
}

export interface ReceiptRef {
  fileKey: string;
  thumbKey: string | null;
  mime: ReceiptType;
}

/**
 * Sets or clears an expense's receipt (Phase 6c decision 15). The guard runs
 * first; `opts.upload` (the object store write) runs inside the transaction
 * after it, so a refused write uploads nothing and a failed upload changes no
 * row. Returns the previous keys, for the caller to delete what is now unused.
 */
export async function setReceipt(
  db: Database,
  scope: EntryScope,
  expenseId: string,
  receipt: ReceiptRef | null,
  opts: { note?: string; now?: Date; upload?: () => Promise<void> } = {},
): Promise<{ expense: ExpenseDTO; previous: { fileKey: string | null; thumbKey: string | null } }> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    await tx.execute(timerLock(scope.workspaceId, scope.userId));
    const row = await liveRow(tx, scope, expenseId);
    if (row.deletedAt) throw new TimeEntryError("NOT_FOUND", NOT_FOUND);
    await assertExpenseWritable(
      tx,
      scope,
      {
        expenseId,
        before: row.date,
        after: row.date,
        changes: { receipt: { from: row.receiptMime, to: receipt?.mime ?? null } },
      },
      { note: opts.note, now },
    );
    await opts.upload?.();
    await tx
      .update(expense)
      .set({
        receiptKey: receipt?.fileKey ?? null,
        receiptThumbKey: receipt?.thumbKey ?? null,
        receiptMime: receipt?.mime ?? null,
      })
      .where(eq(expense.id, expenseId));
    return {
      expense: await loadDTO(tx, scope, expenseId, now),
      previous: { fileKey: row.receiptKey, thumbKey: row.receiptThumbKey },
    };
  });
}
