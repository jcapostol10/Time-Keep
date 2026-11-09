"use client";

import { formatMoney } from "@timekeep/core";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { ExpenseCategoryDTO } from "@/lib/expense-types";
import { updateExpenseCategoryAction } from "@/server/actions/expense-categories";

import { expenseKeys } from "../tracker/query-keys";
import { CategoryDialog } from "./category-dialog";
import { useExpenseCategories } from "./use-expenses";

/** Owners and admins: the workspace's categories, archived ones shown apart. */
export function CategoriesTab({ slug, currency }: { slug: string; currency: string }) {
  const qc = useQueryClient();
  const { data, isPending } = useExpenseCategories(slug, true);
  const [editing, setEditing] = useState<ExpenseCategoryDTO | "new" | null>(null);

  async function archive(c: ExpenseCategoryDTO) {
    const result = await updateExpenseCategoryAction(slug, c.id, { archived: !c.archived });
    if (!result.ok) toast.error(result.error);
    else toast.success(c.archived ? "Category restored" : "Category archived");
    await qc.invalidateQueries({ queryKey: expenseKeys.all(slug) });
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>Add category</Button>
      </div>
      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (data ?? []).length === 0 ? (
        <p className="text-muted-foreground py-6 text-sm">
          No categories yet. Add one, like Travel, or Mileage at a price per km.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table aria-label="Expense categories">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="hidden sm:table-cell">Unit</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="hidden sm:table-cell">Billable by default</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((c) => (
                <TableRow key={c.id} className={c.archived ? "opacity-60" : undefined}>
                  <TableCell className="font-medium">
                    {c.name}
                    {c.archived ? (
                      <Badge variant="outline" className="ml-2">
                        Archived
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{c.kind === "UNIT" ? "Per unit" : "Fixed amount"}</TableCell>
                  <TableCell className="hidden sm:table-cell">{c.unitName ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.unitPriceMinor !== null
                      ? `${formatMoney(c.unitPriceMinor, currency)}${c.unitName ? ` / ${c.unitName}` : ""}`
                      : "—"}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {c.billableDefault ? "Yes" : "No"}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="More actions">
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(c)}>Edit</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void archive(c)}>
                          {c.archived ? "Restore" : "Archive"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing ? (
        <CategoryDialog
          slug={slug}
          category={editing === "new" ? null : editing}
          currency={currency}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
