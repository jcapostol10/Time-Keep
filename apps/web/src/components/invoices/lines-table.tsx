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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import { ArrowDownIcon, ArrowUpIcon, MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";

import type { InvoiceDTO, InvoiceLineDTO } from "@/lib/invoice-types";
import { removeLineAction, reorderLinesAction } from "@/server/actions/invoices";

import { LineDialog } from "./line-dialog";
import { useInvoiceWrite } from "./use-invoices";

const KIND_LABELS = { TIME: "Time", EXPENSE: "Expenses", MANUAL: null } as const;

/** The invoice's lines; on a draft they move, open for edit (manual ones) and go. */
export function LinesTable({
  slug,
  invoice,
  onImport,
}: {
  slug: string;
  invoice: InvoiceDTO;
  onImport: () => void;
}) {
  const write = useInvoiceWrite(slug);
  const [editing, setEditing] = useState<InvoiceLineDTO | "new" | null>(null);
  const draft = invoice.status === "DRAFT";
  const money = (minor: number) => formatMoney(minor, invoice.currency);
  const ids = invoice.lines.map((l) => l.id);
  const move = (index: number, by: -1 | 1) => {
    const next = [...ids];
    const [line] = next.splice(index, 1);
    next.splice(index + by, 0, line!);
    void write(() => reorderLinesAction(slug, invoice.id, { lineIds: next }));
  };

  return (
    <section aria-label="Invoice lines" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Lines</h2>
        {draft ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onImport}>
              Import time and expenses
            </Button>
            <Button variant="outline" onClick={() => setEditing("new")}>
              Add line
            </Button>
          </div>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table aria-label="Lines">
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit price</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              {draft ? <TableHead className="w-28" aria-label="Actions" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoice.lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={draft ? 5 : 4} className="text-muted-foreground text-center">
                  No lines yet: import billable time and expenses, or add a line.
                </TableCell>
              </TableRow>
            ) : null}
            {invoice.lines.map((l, i) => (
              <TableRow key={l.id}>
                <TableCell>
                  <span>{l.description}</span>
                  {KIND_LABELS[l.kind] ? (
                    <Badge variant="outline" className="ml-2">
                      {KIND_LABELS[l.kind]}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {(l.quantityCenti / 100).toFixed(2)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {l.unitPriceMinor === null ? "—" : money(l.unitPriceMinor)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(l.amountMinor)}</TableCell>
                {draft ? (
                  <TableCell className="whitespace-nowrap text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${l.description} up`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${l.description} down`}
                      disabled={i === invoice.lines.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="More actions">
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {l.kind === "MANUAL" ? (
                          <DropdownMenuItem onSelect={() => setEditing(l)}>Edit</DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          onSelect={() =>
                            void write(
                              () => removeLineAction(slug, invoice.id, l.id),
                              "Line removed",
                            )
                          }
                        >
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing ? (
        <LineDialog
          slug={slug}
          invoice={invoice}
          line={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}
