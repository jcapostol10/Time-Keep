"use client";

import { EXPENSE_GROUP_KEYS, type ExpenseGroupKey, formatMoney } from "@timekeep/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { Skeleton } from "@timekeep/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";

import { useTracker } from "../tracker/tracker-provider";
import { useReportQuery } from "./report-url";
import { useExpensesReport } from "./use-report";

const LABELS: Record<ExpenseGroupKey, string> = {
  category: "Category",
  project: "Project",
  user: "Person",
};

/** The Expenses tab (Phase 6c): totals by category, project or person, in the workspace currency. */
export function ExpensesView() {
  const { slug } = useTracker();
  const { query, params, set } = useReportQuery();
  const { data } = useExpensesReport(slug, params);
  const currency = data?.currency ?? "USD";
  const money = (minor: number) => formatMoney(minor, currency);
  const largest = Math.max(1, ...(data?.groups ?? []).map((g) => g.totals.amountMinor));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-sm">{data?.range.label ?? "…"}</p>
          <p className="text-3xl font-semibold tabular-nums" data-testid="report-total">
            {data ? money(data.totals.amountMinor) : "…"}
          </p>
          {data ? (
            <p className="text-muted-foreground text-sm">
              {data.totals.count} {data.totals.count === 1 ? "expense" : "expenses"} ·{" "}
              {money(data.totals.billableMinor)} billable
            </p>
          ) : null}
        </div>
        <Select
          value={query.expenseBy}
          onValueChange={(key) => set({ expenseBy: key as ExpenseGroupKey })}
        >
          <SelectTrigger className="w-40" aria-label="Group by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPENSE_GROUP_KEYS.map((key) => (
              <SelectItem key={key} value={key}>
                {LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {!data ? (
        <Skeleton className="h-64 w-full" />
      ) : data.groups.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          No expenses in this range.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table aria-label="Expenses report">
            <TableHeader>
              <TableRow>
                <TableHead>{LABELS[data.by]}</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Billable</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.groups.map((g) => (
                <TableRow key={g.id ?? "none"}>
                  <TableCell className="min-w-40 font-medium">
                    {g.label}
                    <span
                      aria-hidden
                      className="bg-primary mt-1 block h-1.5 rounded-full"
                      style={{ width: `${Math.round((g.totals.amountMinor / largest) * 100)}%` }}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{g.totals.count}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {money(g.totals.amountMinor)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {money(g.totals.billableMinor)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">{data.totals.count}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {money(data.totals.amountMinor)}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">
                  {money(data.totals.billableMinor)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}
