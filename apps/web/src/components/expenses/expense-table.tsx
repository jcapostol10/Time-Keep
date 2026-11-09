"use client";

import { formatDateKey, formatMoney, formatQuantity } from "@timekeep/core";
import { Badge } from "@timekeep/ui/components/badge";
import { Button } from "@timekeep/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@timekeep/ui/components/dropdown-menu";
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
import { FileTextIcon, LockIcon, MoreHorizontalIcon, ReceiptIcon } from "lucide-react";

import type { ExpenseDTO, ExpensePage } from "@/lib/expense-types";

import { ColorDot } from "../tracker/project-picker";
import { expenseUrls } from "../tracker/query-keys";

/** The Expenses page's table: newest first, with the whole filter's total in the footer. */
export function ExpenseTable({
  slug,
  pages,
  currency,
  hasMore,
  loadingMore,
  onLoadMore,
  onEdit,
  onDelete,
}: {
  slug: string;
  pages: ExpensePage[] | undefined;
  currency: string;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onEdit: (expense: ExpenseDTO) => void;
  onDelete: (expense: ExpenseDTO) => void;
}) {
  if (!pages) return <Skeleton className="h-64 w-full" />;
  const expenses = pages.flatMap((p) => p.expenses);
  const totals = pages[0]?.totals ?? { count: 0, amountMinor: 0, billableMinor: 0 };
  const money = (minor: number) => formatMoney(minor, currency);

  if (expenses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center">
        <ReceiptIcon className="text-muted-foreground mb-3 size-8" />
        <p className="font-medium">No expenses in this range</p>
        <p className="text-muted-foreground mt-1 max-w-sm text-sm">
          Add one with what you spent on a project, and a photo of the receipt.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <Table aria-label="Expenses">
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="hidden md:table-cell">Person</TableHead>
              <TableHead>Project</TableHead>
              <TableHead className="hidden sm:table-cell">Category</TableHead>
              <TableHead className="hidden lg:table-cell">Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="hidden sm:table-cell" />
              <TableHead className="w-0">Receipt</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {expenses.map((e) => {
              const locked = e.lockedReason !== null;
              return (
                <TableRow key={e.id} title={e.lockedReason ?? undefined}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    <span className="flex items-center gap-1.5">
                      {locked ? (
                        <LockIcon
                          className="text-muted-foreground size-4 shrink-0"
                          role="img"
                          aria-label={e.lockedReason ?? "Locked"}
                        />
                      ) : null}
                      {formatDateKey(e.date)}
                    </span>
                    <span className="text-muted-foreground block text-xs md:hidden">
                      {e.userName}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{e.userName}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <ColorDot color={e.projectColor} />
                      <span className="font-medium">{e.projectName}</span>
                    </span>
                    {e.clientName ? (
                      <span className="text-muted-foreground block text-xs">{e.clientName}</span>
                    ) : null}
                    <span className="text-muted-foreground block text-xs sm:hidden">
                      {e.categoryName}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {e.categoryName}
                    {e.quantityCenti !== null ? (
                      <span className="text-muted-foreground block text-xs tabular-nums">
                        {formatQuantity(e.quantityCenti)} {e.unitName ?? ""}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden max-w-60 truncate lg:table-cell">
                    {e.description || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {money(e.amountMinor)}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant={e.billable ? "default" : "outline"}>
                      {e.billable ? "Billable" : "Non-billable"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {e.receipt ? (
                      <a
                        href={expenseUrls.receipt(slug, e.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="block"
                        aria-label={e.receipt.thumb ? undefined : "Open receipt"}
                      >
                        {e.receipt.thumb ? (
                          // A presigned image behind our redirect: no Next image loader applies.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={expenseUrls.receipt(slug, e.id, true)}
                            alt="Receipt"
                            className="size-10 rounded object-cover"
                          />
                        ) : (
                          <FileTextIcon className="text-muted-foreground size-5" aria-hidden />
                        )}
                      </a>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="More actions"
                          disabled={!e.editable || locked}
                        >
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onEdit(e)}>Edit</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onSelect={() => onDelete(e)}>
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2} className="md:hidden">
                Total
              </TableCell>
              <TableCell colSpan={3} className="hidden md:table-cell">
                Total
              </TableCell>
              <TableCell className="hidden lg:table-cell" />
              <TableCell className="hidden sm:table-cell md:hidden" />
              <TableCell className="text-right font-semibold tabular-nums">
                {money(totals.amountMinor)}
              </TableCell>
              <TableCell colSpan={3} className="text-muted-foreground text-xs">
                {totals.count} {totals.count === 1 ? "expense" : "expenses"} ·{" "}
                {money(totals.billableMinor)} billable
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      {hasMore ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
