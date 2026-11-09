import { can, parseReportQuery, resolveViewerPrefs } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { expensesParams, expensesQuery } from "@/components/expenses/expense-query";
import { ExpensesPageClient } from "@/components/expenses/expenses-page-client";
import { expenseKeys, trackerKeys } from "@/components/tracker/query-keys";
import { searchParamsOf } from "@/lib/search-params";
import { authorize, writableUsers } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";
import { listExpenseCategories } from "@/server/expense-categories";
import { listExpenses } from "@/server/expenses";
import { reportFilterOptions } from "@/server/reports";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Expenses" };

/**
 * Expenses (Phase 6c): everyone's own, and the people an admin or manager may
 * add for; the Categories tab for those who manage them (a 404 otherwise).
 */
export default async function ExpensesPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/expenses">) {
  const { workspaceSlug } = await params;
  const raw = await searchParams;
  const ctx = await requireWorkspacePage(workspaceSlug, "member", `/w/${workspaceSlug}/expenses`);
  const viewer = await authorizePage(() =>
    authorize(ctx, "expense.read", { kind: "entry", userId: ctx.user.id, projectId: null }),
  );
  const manages = can(viewer.actor, "expenseCategory.manage", { kind: "none" });
  const tab = raw.tab === "categories" ? "categories" : "expenses";
  if (tab === "categories" && !manages) notFound();

  const urlParams = searchParamsOf(raw);
  const query = expensesQuery(parseReportQuery(urlParams), urlParams);
  const key = expensesParams(query);
  const prefs = resolveViewerPrefs(ctx.user, ctx.settings);
  const db = getDb();
  const [page, categories, options, people] = await Promise.all([
    listExpenses(db, viewer, query, prefs, {}),
    listExpenseCategories(db, viewer, { includeArchived: manages }),
    reportFilterOptions(db, viewer),
    writableUsers(db, viewer),
  ]);

  const queryClient = new QueryClient();
  queryClient.setQueryData(expenseKeys.list(workspaceSlug, key), {
    pages: [page],
    pageParams: [null],
  });
  queryClient.setQueryData(expenseKeys.categories(workspaceSlug, manages), categories);
  queryClient.setQueryData(trackerKeys.reportOptions(workspaceSlug), options);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ExpensesPageClient
        slug={workspaceSlug}
        tab={tab}
        manages={manages}
        people={people}
        currency={page.currency}
      />
    </HydrationBoundary>
  );
}
