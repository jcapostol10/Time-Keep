"use client";

import { formatDateKey } from "@timekeep/core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@timekeep/ui/components/alert-dialog";
import { Badge } from "@timekeep/ui/components/badge";
import { Button } from "@timekeep/ui/components/button";
import { Input } from "@timekeep/ui/components/input";
import { Label } from "@timekeep/ui/components/label";
import { Skeleton } from "@timekeep/ui/components/skeleton";
import { Textarea } from "@timekeep/ui/components/textarea";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { InvoiceDTO } from "@/lib/invoice-types";
import { workspaceRoutes } from "@/lib/routes";
import {
  deleteInvoiceAction,
  updateInvoiceAction,
  voidInvoiceAction,
} from "@/server/actions/invoices";

import { invoiceUrls } from "../tracker/query-keys";
import { ImportDialog } from "./import-dialog";
import { LinesTable } from "./lines-table";
import { PaymentsCard } from "./payments-card";
import { SendDialog } from "./send-dialog";
import { INVOICE_STATUS_LABELS } from "./status";
import { TotalsCard } from "./totals-card";
import { useInvoice, useInvoiceWrite } from "./use-invoices";

/**
 * One invoice: a draft's number, dates, lines, discount and taxes are edited
 * here; sending freezes it; a sent one takes payments, or is voided.
 */
export function InvoiceEditor({
  slug,
  invoiceId,
  projects,
  today,
}: {
  slug: string;
  invoiceId: string;
  projects: { id: string; name: string }[];
  today: string;
}) {
  const { data: invoice } = useInvoice(slug, invoiceId);
  const write = useInvoiceWrite(slug);
  const router = useRouter();
  const [dialog, setDialog] = useState<"import" | "send" | "void" | "delete" | null>(null);
  const [publicPath, setPublicPath] = useState<string | null>(null);

  if (!invoice) return <Skeleton className="h-96 w-full" />;
  const draft = invoice.status === "DRAFT";
  const patch = (input: Record<string, unknown>) =>
    write(() => updateInvoiceAction(slug, invoice.id, input));

  return (
    <div className="space-y-6">
      <Link
        href={workspaceRoutes.invoices(slug)}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeftIcon className="size-4" /> Invoices
      </Link>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Invoice {invoice.number}</h1>
            <Badge
              data-testid="invoice-status"
              variant={invoice.computedStatus === "OVERDUE" ? "destructive" : "secondary"}
            >
              {INVOICE_STATUS_LABELS[invoice.computedStatus]}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {invoice.clientName} · {invoice.currency}
            {invoice.sentAt ? ` · sent ${formatDateKey(invoice.sentAt.slice(0, 10))}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {draft ? <Button onClick={() => setDialog("send")}>Send…</Button> : null}
          <Button asChild variant="outline">
            <a href={invoiceUrls.pdf(slug, invoice.id)} target="_blank" rel="noreferrer">
              Download PDF
            </a>
          </Button>
          {publicPath ? (
            <Button asChild variant="outline">
              <a href={publicPath} target="_blank" rel="noreferrer">
                Open public link
              </a>
            </Button>
          ) : null}
          {invoice.status === "SENT" ? (
            <Button variant="outline" onClick={() => setDialog("void")}>
              Void
            </Button>
          ) : null}
          {draft ? (
            <Button variant="outline" onClick={() => setDialog("delete")}>
              Delete
            </Button>
          ) : null}
        </div>
      </header>

      {publicPath ? (
        <p role="status" className="bg-muted rounded-md px-3 py-2 text-sm">
          The client&apos;s link, shown once: <code className="break-all">{publicPath}</code>
        </p>
      ) : null}

      <section aria-label="Details" className="grid gap-3 sm:grid-cols-3">
        <Field label="Number" id="invoice-number">
          <Input
            id="invoice-number"
            key={`n-${invoice.number}`}
            defaultValue={invoice.number}
            disabled={!draft}
            maxLength={40}
            onBlur={(e) => {
              const number = e.target.value.trim();
              if (number && number !== invoice.number) void patch({ number });
            }}
          />
        </Field>
        <Field label="Issue date" id="invoice-issue-date">
          <Input
            id="invoice-issue-date"
            type="date"
            key={`i-${invoice.issueDate}`}
            defaultValue={invoice.issueDate}
            disabled={!draft}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== invoice.issueDate)
                void patch({ issueDate: e.target.value, dueDate: invoice.dueDate });
            }}
          />
        </Field>
        <Field label="Due date" id="invoice-due-date">
          <Input
            id="invoice-due-date"
            type="date"
            key={`d-${invoice.dueDate}`}
            defaultValue={invoice.dueDate}
            disabled={!draft}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== invoice.dueDate)
                void patch({ issueDate: invoice.issueDate, dueDate: e.target.value });
            }}
          />
        </Field>
      </section>

      <LinesTable slug={slug} invoice={invoice} onImport={() => setDialog("import")} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="invoice-notes">Notes</Label>
          <Textarea
            id="invoice-notes"
            key={`notes-${invoice.notes}`}
            defaultValue={invoice.notes}
            maxLength={2000}
            rows={4}
            onBlur={(e) => {
              if (e.target.value.trim() !== invoice.notes) void patch({ notes: e.target.value });
            }}
          />
        </div>
        <TotalsCard slug={slug} invoice={invoice} />
      </div>

      {invoice.status !== "DRAFT" ? (
        <PaymentsCard slug={slug} invoice={invoice} today={today} />
      ) : null}

      {dialog === "import" ? (
        <ImportDialog
          slug={slug}
          invoice={invoice}
          projects={projects}
          today={today}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "send" ? (
        <SendDialog
          slug={slug}
          invoice={invoice}
          onSent={(sent: InvoiceDTO) => {
            setPublicPath(sent.publicPath);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      <AlertDialog
        open={dialog === "void" || dialog === "delete"}
        onOpenChange={(open) => (open ? null : setDialog(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog === "void" ? `Void ${invoice.number}?` : `Delete ${invoice.number}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog === "void"
                ? "Its time and expenses become free to invoice again. The invoice, its number and its PDF stay, marked void."
                : "Its time and expenses become free to invoice again. The number is not reused."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (dialog === "void") {
                  void write(() => voidInvoiceAction(slug, invoice.id), "Invoice voided");
                } else {
                  void write(() => deleteInvoiceAction(slug, invoice.id), "Draft deleted").then(
                    (done) => {
                      if (done !== null) router.push(workspaceRoutes.invoices(slug));
                    },
                  );
                }
                setDialog(null);
              }}
            >
              {dialog === "void" ? "Void invoice" : "Delete draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
