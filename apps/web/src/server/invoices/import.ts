import "server-only";

import { randomUUID } from "node:crypto";

import {
  addDaysToKey,
  type ImportGroup,
  type InvoiceImportInput,
  localDateKey,
  zonedDateTimeToInstant,
} from "@timekeep/core";
import {
  and,
  asc,
  type Database,
  type DbExecutor,
  eq,
  expense,
  expenseCategory,
  gte,
  inArray,
  invoiceItem,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  project,
  sql,
  timeEntry,
  user,
} from "@timekeep/db";

import type { ImportPreviewDTO, InvoiceDTO } from "@/lib/invoice-types";

import { CatalogError } from "../catalog/errors";
import type { Viewer } from "../catalog/viewer";
import { markExpensesInvoiced } from "../expenses";
import { type InvoiceableEntry, invoiceableEntries } from "../reports";
import { markInvoiced } from "../time-entries";
import { clientLock, DRAFT_ONLY, nextPosition, recomputeTotals } from "./invoices";
import { findOwned, getInvoice, requireManage } from "./read";
import { type InvoiceWorkspace, invoiceWorkspace } from "./settings";

/**
 * "Import time and expenses" (decisions 22 and 23): the report engine selects
 * the client's billable, rated, free time in the invoice's currency for the
 * range, rounded by the workspace rule; the lines are its groups; what was
 * selected is marked under the client's lock, and the count must match.
 * Expenses (always the workspace currency) come only into an invoice in it.
 */

type Executor = DbExecutor;

interface ExpenseRow {
  id: string;
  date: string;
  amountMinor: number;
  description: string;
  userName: string;
  categoryId: string;
  categoryName: string;
}

interface Selection {
  entries: InvoiceableEntry[];
  expenses: ExpenseRow[];
  skipped: { otherCurrency: number; unrated: number };
}

interface LineDraft {
  description: string;
  quantityCenti: number;
  unitPriceMinor: number | null;
  amountMinor: number;
  entryIds: string[];
  expenseIds: string[];
}

const centiHours = (seconds: number) => Math.round(seconds / 36);

async function assertClientProjects(
  db: Executor,
  workspaceId: string,
  clientId: string,
  projectIds: string[],
): Promise<void> {
  if (projectIds.length === 0) return;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(project)
    .where(
      and(
        eq(project.workspaceId, workspaceId),
        eq(project.clientId, clientId),
        inArray(project.id, projectIds),
      ),
    );
  if (Number(row?.n ?? 0) !== new Set(projectIds).size) {
    throw new CatalogError("INVALID", "Pick projects of the invoice's client.");
  }
}

async function select(
  db: Executor,
  viewer: Viewer,
  ws: InvoiceWorkspace,
  inv: { clientId: string; currency: string },
  input: InvoiceImportInput,
): Promise<Selection> {
  const entries = await invoiceableEntries(
    db,
    viewer,
    {
      clientId: inv.clientId,
      currency: inv.currency,
      from: input.from,
      to: input.to,
      projectIds: input.projectIds,
    },
    ws,
  );
  const midnight = (key: string) =>
    zonedDateTimeToInstant({ date: key, hours: 0, minutes: 0 }, ws.timezone);
  const projectFilter =
    input.projectIds.length > 0 ? inArray(project.id, input.projectIds) : undefined;
  const [skipped] = await db
    .select({
      unrated: sql<number>`(count(*) filter (where ${timeEntry.amountMinor} is null))::int`,
      otherCurrency: sql<number>`(count(*) filter (where ${timeEntry.amountMinor} is not null and ${timeEntry.rateCurrency} <> ${inv.currency}))::int`,
    })
    .from(timeEntry)
    .innerJoin(project, eq(project.id, timeEntry.projectId))
    .where(
      and(
        eq(timeEntry.workspaceId, ws.id),
        isNull(timeEntry.deletedAt),
        isNotNull(timeEntry.end),
        eq(timeEntry.type, "work"),
        eq(timeEntry.billable, true),
        isNull(timeEntry.invoiceId),
        eq(project.clientId, inv.clientId),
        projectFilter,
        gte(timeEntry.start, midnight(input.from)),
        lt(timeEntry.start, midnight(addDaysToKey(input.to, 1))),
      ),
    );
  const expenses =
    input.expenses && inv.currency === ws.currency
      ? await db
          .select({
            id: expense.id,
            date: expense.date,
            amountMinor: expense.amountMinor,
            description: expense.description,
            userName: sql<string>`coalesce(${user.name}, '(former member)')`,
            categoryId: expense.categoryId,
            categoryName: expenseCategory.name,
          })
          .from(expense)
          .innerJoin(project, eq(project.id, expense.projectId))
          .innerJoin(expenseCategory, eq(expenseCategory.id, expense.categoryId))
          .leftJoin(user, eq(user.id, expense.userId))
          .where(
            and(
              eq(expense.workspaceId, ws.id),
              isNull(expense.deletedAt),
              eq(expense.billable, true),
              isNull(expense.invoiceId),
              eq(project.clientId, inv.clientId),
              projectFilter,
              gte(expense.date, input.from),
              lte(expense.date, input.to),
              ne(expense.amountMinor, 0),
            ),
          )
          .orderBy(asc(expense.date), asc(expense.createdAt), asc(expense.id))
      : [];
  return {
    entries,
    expenses,
    skipped: {
      otherCurrency: Number(skipped?.otherCurrency ?? 0),
      unrated: Number(skipped?.unrated ?? 0),
    },
  };
}

function sameRate(entries: InvoiceableEntry[]): number | null {
  const first = entries[0]?.rateMinor ?? null;
  if (first === null) return null;
  return entries.every((e) => e.rateMinor === first) ? first : null;
}

/** Decision 22: one line per group; the amount is the engine's sum, the price only when one rate. */
export function groupEntries(
  entries: InvoiceableEntry[],
  groupBy: ImportGroup,
  timezone: string,
): LineDraft[] {
  if (groupBy === "entry") {
    return entries.map((e) => ({
      description: `${localDateKey(new Date(e.start), timezone)} ${e.userName}: ${e.description.trim() || e.projectName}`,
      quantityCenti: centiHours(e.seconds),
      unitPriceMinor: e.rateMinor,
      amountMinor: e.amountMinor,
      entryIds: [e.id],
      expenseIds: [],
    }));
  }
  const keyOf = (e: InvoiceableEntry): [string, string] => {
    switch (groupBy) {
      case "project":
        return [e.projectId, e.projectName];
      case "task":
        return [
          `${e.projectId}|${e.taskId ?? ""}`,
          `${e.projectName} › ${e.taskName ?? "No task"}`,
        ];
      case "user":
        return [`${e.projectId}|${e.userId}`, `${e.projectName} — ${e.userName}`];
    }
  };
  const groups = new Map<string, { description: string; entries: InvoiceableEntry[] }>();
  for (const e of entries) {
    const [key, description] = keyOf(e);
    const g = groups.get(key) ?? { description, entries: [] };
    g.entries.push(e);
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.description.localeCompare(b.description))
    .map((g) => ({
      description: g.description,
      quantityCenti: centiHours(g.entries.reduce((n, e) => n + e.seconds, 0)),
      unitPriceMinor: sameRate(g.entries),
      amountMinor: g.entries.reduce((n, e) => n + e.amountMinor, 0),
      entryIds: g.entries.map((e) => e.id),
      expenseIds: [],
    }));
}

/** One line per category ("Travel (2 expenses)"), or per expense when grouping by entry. */
export function groupExpenses(expenses: ExpenseRow[], groupBy: ImportGroup): LineDraft[] {
  if (groupBy === "entry") {
    return expenses.map((x) => ({
      description: `${x.date} ${x.userName}: ${x.categoryName}${x.description.trim() ? ` — ${x.description.trim()}` : ""}`,
      quantityCenti: 100,
      unitPriceMinor: x.amountMinor,
      amountMinor: x.amountMinor,
      entryIds: [],
      expenseIds: [x.id],
    }));
  }
  const groups = new Map<string, { name: string; expenses: ExpenseRow[] }>();
  for (const x of expenses) {
    const g = groups.get(x.categoryId) ?? { name: x.categoryName, expenses: [] };
    g.expenses.push(x);
    groups.set(x.categoryId, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((g) => ({
      description: `${g.name} (${g.expenses.length} expense${g.expenses.length === 1 ? "" : "s"})`,
      quantityCenti: g.expenses.length * 100,
      unitPriceMinor: null,
      amountMinor: g.expenses.reduce((n, x) => n + x.amountMinor, 0),
      entryIds: [],
      expenseIds: g.expenses.map((x) => x.id),
    }));
}

/** What an import would take, and what it would leave out, without writing. */
export async function previewImport(
  db: Executor,
  viewer: Viewer,
  id: string,
  input: InvoiceImportInput,
): Promise<ImportPreviewDTO> {
  requireManage(viewer);
  const ws = await invoiceWorkspace(db, viewer.workspaceId);
  const inv = await findOwned(db, ws.id, id);
  await assertClientProjects(db, ws.id, inv.clientId, input.projectIds);
  const sel = await select(db, viewer, ws, inv, input);
  return {
    entries: sel.entries.length,
    seconds: sel.entries.reduce((n, e) => n + e.seconds, 0),
    amountMinor: sel.entries.reduce((n, e) => n + e.amountMinor, 0),
    expenses: sel.expenses.length,
    expenseMinor: sel.expenses.reduce((n, x) => n + x.amountMinor, 0),
    skipped: sel.skipped,
  };
}

/**
 * The import inside the caller's transaction (the action and the recurring
 * job): the client's lock, the selection, the lines, and the marks, whose
 * counts must equal the selection or the transaction fails.
 */
export async function importInto(
  tx: Executor,
  viewer: Viewer,
  id: string,
  input: InvoiceImportInput,
): Promise<void> {
  const ws = await invoiceWorkspace(tx, viewer.workspaceId);
  const inv = await findOwned(tx, ws.id, id, true);
  if (inv.status !== "DRAFT") throw new CatalogError("INVALID", DRAFT_ONLY);
  await assertClientProjects(tx, ws.id, inv.clientId, input.projectIds);
  await tx.execute(clientLock(inv.clientId));
  const sel = await select(tx, viewer, ws, inv, input);
  const lines = [
    ...groupEntries(sel.entries, input.groupBy, ws.timezone).map((l) => ({
      ...l,
      kind: "TIME" as const,
    })),
    ...groupExpenses(sel.expenses, input.groupBy).map((l) => ({ ...l, kind: "EXPENSE" as const })),
  ];
  if (lines.length === 0) return;
  let position = await nextPosition(tx, id);
  await tx.insert(invoiceItem).values(
    lines.map((l) => ({
      id: randomUUID(),
      invoiceId: id,
      position: position++,
      kind: l.kind,
      description: l.description,
      quantityCenti: l.quantityCenti,
      unitPriceMinor: l.unitPriceMinor,
      amountMinor: l.amountMinor,
      entryIds: l.entryIds,
      expenseIds: l.expenseIds,
    })),
  );
  const entryIds = sel.entries.map((e) => e.id);
  if ((await markInvoiced(tx, ws.id, entryIds, id)) !== entryIds.length) {
    throw new CatalogError("CONFLICT", "Some of this time was invoiced meanwhile. Try again.");
  }
  const expenseIds = sel.expenses.map((x) => x.id);
  if ((await markExpensesInvoiced(tx, ws.id, expenseIds, id)) !== expenseIds.length) {
    throw new CatalogError(
      "CONFLICT",
      "Some of these expenses were invoiced meanwhile. Try again.",
    );
  }
  await recomputeTotals(tx, id);
}

export async function importIntoInvoice(
  db: Database,
  viewer: Viewer,
  id: string,
  input: InvoiceImportInput,
  now: Date = new Date(),
): Promise<InvoiceDTO> {
  requireManage(viewer);
  await db.transaction((tx) => importInto(tx, viewer, id, input));
  return getInvoice(db, viewer, id, now);
}
