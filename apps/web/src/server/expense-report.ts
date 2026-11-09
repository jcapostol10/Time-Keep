import "server-only";

import {
  EMPTY_EXPENSE_TOTALS,
  type ExpenseGroupKey,
  type ExpenseTotals,
  type ReportQuery,
  resolveReportRange,
  type ViewerPrefs,
} from "@timekeep/core";
import {
  and,
  client,
  type Database,
  eq,
  expense,
  expenseCategory,
  project,
  sql,
  user,
} from "@timekeep/db";

import type { ExpenseReport } from "@/lib/report-types";

import { workspaceCurrency } from "./catalog/clients";
import type { Viewer } from "./catalog/viewer";
import { expenseConditions } from "./expenses";

/**
 * The one expense aggregate (Phase 6c decisions 18 and 19): the Expenses
 * report and the Profit tab's expense side both read it, so their numbers
 * cannot drift. The filters are the Expenses page's (`expenseConditions`):
 * the viewer's scope, the range as local date keys, people, groups, clients,
 * projects, categories and billable.
 */

type Executor = Pick<Database, "query" | "select" | "insert" | "update" | "delete" | "execute">;

export interface ExpenseGroupTotals {
  label: string;
  totals: ExpenseTotals;
}

/** The Profit tab also groups by client (the project's); the Expenses report never does. */
export type ExpenseAggregateKey = ExpenseGroupKey | "client";

const KEY_COLUMNS = {
  category: { id: expense.categoryId, label: expenseCategory.name, none: "" },
  project: { id: expense.projectId, label: project.name, none: "" },
  user: { id: expense.userId, label: user.name, none: "(former member)" },
  client: { id: project.clientId, label: client.name, none: "No client" },
} as const;

/** Totals per category, project, person or client, keyed by id, in no particular order. */
export async function expenseTotalsBy(
  db: Executor,
  viewer: Viewer,
  by: ExpenseAggregateKey,
  query: ReportQuery,
  prefs: ViewerPrefs,
  now: Date = new Date(),
): Promise<Map<string | null, ExpenseGroupTotals>> {
  const key = KEY_COLUMNS[by];
  const rows = await db
    .select({
      id: key.id,
      label: key.label,
      count: sql<number>`count(*)::int`,
      amountMinor: sql`coalesce(sum(${expense.amountMinor}), 0)::bigint`.mapWith(Number),
      billableMinor:
        sql`coalesce(sum(${expense.amountMinor}) filter (where ${expense.billable}), 0)::bigint`.mapWith(
          Number,
        ),
    })
    .from(expense)
    .innerJoin(project, eq(project.id, expense.projectId))
    .innerJoin(expenseCategory, eq(expenseCategory.id, expense.categoryId))
    .leftJoin(user, eq(user.id, expense.userId))
    .leftJoin(client, eq(client.id, project.clientId))
    .where(and(...expenseConditions(viewer, query, prefs, now)))
    // By ordinal: Drizzle numbers the same parameter differently in SELECT and GROUP BY.
    .groupBy(sql.raw("1"), sql.raw("2"));
  const out = new Map<string | null, ExpenseGroupTotals>();
  for (const r of rows) {
    out.set(r.id, {
      label: r.label ?? key.none,
      totals: { count: r.count, amountMinor: r.amountMinor, billableMinor: r.billableMinor },
    });
  }
  return out;
}

/** The Expenses report tab: groups by the query's `expenseBy`, sorted by amount then label. */
export async function expenseReport(
  db: Executor,
  viewer: Viewer,
  query: ReportQuery,
  prefs: ViewerPrefs,
  now: Date = new Date(),
): Promise<ExpenseReport> {
  const range = resolveReportRange(query, prefs, now);
  const [grouped, currency] = await Promise.all([
    expenseTotalsBy(db, viewer, query.expenseBy, query, prefs, now),
    workspaceCurrency(db, viewer.workspaceId),
  ]);
  const groups = [...grouped.entries()]
    .map(([id, g]) => ({ id, label: g.label, totals: g.totals }))
    .sort((a, b) => b.totals.amountMinor - a.totals.amountMinor || a.label.localeCompare(b.label));
  const totals = groups.reduce<ExpenseTotals>(
    (sum, g) => ({
      count: sum.count + g.totals.count,
      amountMinor: sum.amountMinor + g.totals.amountMinor,
      billableMinor: sum.billableMinor + g.totals.billableMinor,
    }),
    EMPTY_EXPENSE_TOTALS,
  );
  return {
    currency,
    range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
    by: query.expenseBy,
    groups,
    totals,
  };
}
