"use client";

import { formatDateKey } from "@timekeep/core";
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
import { MoreHorizontalIcon, RepeatIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { RecurringInvoiceDTO } from "@/lib/invoice-types";
import { workspaceRoutes } from "@/lib/routes";
import { deleteRecurringAction } from "@/server/actions/recurring-invoices";

import { RecurringDialog } from "./recurring-dialog";
import { scheduleText } from "./status";
import { useInvoiceWrite, useRecurringInvoices } from "./use-invoices";

/** The Recurring tab: templates the daily job turns into one invoice per period. */
export function RecurringTab({
  slug,
  clients,
  today,
  currency,
}: {
  slug: string;
  clients: { id: string; name: string }[];
  today: string;
  currency: string;
}) {
  const { data } = useRecurringInvoices(slug);
  const write = useInvoiceWrite(slug);
  const [editing, setEditing] = useState<RecurringInvoiceDTO | "new" | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground max-w-xl text-sm">
          Each day the job creates the invoices that are due, one per template and period, as a
          draft or sent to the client.
        </p>
        <Button variant="outline" onClick={() => setEditing("new")}>
          New recurring invoice
        </Button>
      </div>
      {!data ? (
        <Skeleton className="h-32 w-full" />
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center">
          <RepeatIcon className="text-muted-foreground mb-3 size-8" />
          <p className="font-medium">No recurring invoices</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table aria-label="Recurring invoices">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Next run</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Last invoice</TableHead>
                <TableHead className="w-12" aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">
                    {t.name}
                    {t.active ? null : (
                      <Badge variant="outline" className="ml-2">
                        Paused
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{t.clientName}</TableCell>
                  <TableCell>{scheduleText(t)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {t.nextRunDate ? formatDateKey(t.nextRunDate) : "—"}
                  </TableCell>
                  <TableCell>{t.mode === "SEND" ? "Create and send" : "Create a draft"}</TableCell>
                  <TableCell>
                    {t.lastInvoice ? (
                      <Link
                        href={workspaceRoutes.invoice(slug, t.lastInvoice.id)}
                        className="hover:underline"
                      >
                        {t.lastInvoice.number}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="More actions">
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(t)}>Edit</DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            void write(() => deleteRecurringAction(slug, t.id), "Template deleted")
                          }
                        >
                          Delete
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
        <RecurringDialog
          slug={slug}
          template={editing === "new" ? null : editing}
          clients={clients}
          today={today}
          currency={currency}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
