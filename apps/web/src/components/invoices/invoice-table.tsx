"use client";

import { COMPUTED_INVOICE_STATUSES, formatDateKey, formatMoney } from "@timekeep/core";
import { Badge } from "@timekeep/ui/components/badge";
import { Button } from "@timekeep/ui/components/button";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@timekeep/ui/components/table";
import Link from "next/link";
import { useMemo, useState } from "react";

import { workspaceRoutes } from "@/lib/routes";
import { EmptyNote, EmptyState } from "@/components/empty-state";

import { INVOICE_STATUS_LABELS } from "./status";
import { useInvoiceList } from "./use-invoices";

const ALL = "all";

/** The Invoices tab: a status and a client filter, the table, Load more. */
export function InvoiceTable({
  slug,
  clients,
  onCreate,
}: {
  slug: string;
  clients: { id: string; name: string }[];
  /** Opens the New invoice dialog (the empty list's button). */
  onCreate: () => void;
}) {
  const [status, setStatus] = useState<string>(ALL);
  const [clientId, setClientId] = useState<string>(ALL);
  const params = useMemo(() => {
    const p = new URLSearchParams({ status });
    if (clientId !== ALL) p.set("clientId", clientId);
    return p.toString();
  }, [status, clientId]);
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useInvoiceList(slug, params);
  const invoices = data?.pages.flatMap((p) => p.invoices) ?? [];
  const totals = data?.pages[0]?.totals;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" aria-label="Status" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {COMPUTED_INVOICE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {INVOICE_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger size="sm" aria-label="Client filter" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All clients</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {totals && totals.balanceMinor.length > 0 ? (
          <span className="text-muted-foreground text-sm">
            Outstanding:{" "}
            {totals.balanceMinor.map((m) => formatMoney(m.amountMinor, m.currency)).join(" · ")}
          </span>
        ) : null}
      </div>
      {!data ? (
        <Skeleton className="h-48 w-full" />
      ) : invoices.length === 0 ? (
        status !== ALL || clientId !== ALL ? (
          <EmptyNote>No invoices match. Try another status or client.</EmptyNote>
        ) : (
          <EmptyState
            title="Create an invoice"
            description="Pick a client, then import their billable time and expenses."
            action={<Button onClick={onCreate}>Create invoice</Button>}
          />
        )
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table aria-label="Invoices">
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">
                    <Link href={workspaceRoutes.invoice(slug, i.id)} className="hover:underline">
                      {i.number}
                    </Link>
                  </TableCell>
                  <TableCell>{i.clientName}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateKey(i.issueDate)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateKey(i.dueDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(i.totalMinor, i.currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {i.status === "SENT" ? formatMoney(i.balanceMinor, i.currency) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={i.computedStatus === "OVERDUE" ? "destructive" : "secondary"}>
                      {INVOICE_STATUS_LABELS[i.computedStatus]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {hasNextPage ? (
        <Button
          variant="outline"
          disabled={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}
