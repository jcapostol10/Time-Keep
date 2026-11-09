"use client";

import { Button } from "@timekeep/ui/components/button";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import type { ExpenseDTO } from "@/lib/expense-types";
import { workspaceRoutes } from "@/lib/routes";

import { useReportQuery } from "../reports/report-url";
import { CategoriesTab } from "./categories-tab";
import { ExpenseDialog } from "./expense-dialog";
import { ExpenseFilters } from "./expense-filters";
import { expensesParams, expensesQuery } from "./expense-query";
import { ExpenseTable } from "./expense-table";
import { useExpenses, useExpenseWrites } from "./use-expenses";

export type ExpensesTab = "expenses" | "categories";

/** The Expenses page: the list with its filters, and the Categories tab for those who manage them. */
export function ExpensesPageClient({
  slug,
  tab,
  manages,
  people,
  currency,
}: {
  slug: string;
  tab: ExpensesTab;
  manages: boolean;
  people: { id: string; name: string }[];
  currency: string;
}) {
  const [dialog, setDialog] = useState<ExpenseDTO | "new" | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Expenses"
        description="What was spent on projects, with receipts."
        actions={<Button onClick={() => setDialog("new")}>Add expense</Button>}
      />
      {manages ? (
        <nav role="tablist" aria-label="Expenses" className="flex flex-wrap gap-1 border-b">
          {(["expenses", "categories"] as const).map((t) => (
            <Link
              key={t}
              role="tab"
              aria-selected={t === tab}
              href={workspaceRoutes.expenses(slug, t === "categories" ? "categories" : undefined)}
              className={
                t === tab
                  ? "border-primary -mb-px border-b-2 px-3 py-2 text-sm font-medium"
                  : "text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
              }
            >
              {t === "expenses" ? "Expenses" : "Categories"}
            </Link>
          ))}
        </nav>
      ) : null}
      {tab === "categories" ? (
        <CategoriesTab slug={slug} currency={currency} />
      ) : (
        <ExpensesList slug={slug} currency={currency} onEdit={(e) => setDialog(e)} />
      )}
      {dialog ? (
        <ExpenseDialog
          slug={slug}
          expense={dialog === "new" ? null : dialog}
          people={people}
          currency={currency}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function ExpensesList({
  slug,
  currency,
  onEdit,
}: {
  slug: string;
  currency: string;
  onEdit: (expense: ExpenseDTO) => void;
}) {
  const { query: fromUrl, set } = useReportQuery();
  const search = useSearchParams();
  const current = search.toString();
  const query = useMemo(
    () => expensesQuery(fromUrl, new URLSearchParams(current)),
    [fromUrl, current],
  );
  const params = useMemo(() => expensesParams(query), [query]);
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useExpenses(slug, params);
  const writes = useExpenseWrites(slug);
  return (
    <div className="space-y-4">
      <ExpenseFilters query={query} onChange={(patch) => set(patch)} />
      <ExpenseTable
        slug={slug}
        pages={data?.pages}
        currency={currency}
        hasMore={Boolean(hasNextPage)}
        loadingMore={isFetchingNextPage}
        onLoadMore={() => void fetchNextPage()}
        onEdit={onEdit}
        onDelete={(e) => void writes.remove(e)}
      />
    </div>
  );
}
