"use client";

import { Button } from "@timekeep/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@timekeep/ui/components/dialog";
import { Input } from "@timekeep/ui/components/input";
import { Label } from "@timekeep/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@timekeep/ui/components/select";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { workspaceRoutes } from "@/lib/routes";
import { createInvoiceAction } from "@/server/actions/invoices";

import { useInvoiceWrite } from "./use-invoices";

/** A new draft: the client, the issue date and, optionally, the due date (else the payment terms). */
export function NewInvoiceDialog({
  slug,
  clients,
  today,
  onClose,
}: {
  slug: string;
  clients: { id: string; name: string }[];
  today: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const write = useInvoiceWrite(slug);
  const [clientId, setClientId] = useState("");
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const invoice = await write(() =>
        createInvoiceAction(slug, { clientId, issueDate, dueDate: dueDate || undefined }),
      );
      if (invoice) router.push(workspaceRoutes.invoice(slug, invoice.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <DialogHeader>
            <DialogTitle>New invoice</DialogTitle>
          </DialogHeader>
          {clients.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Add a client first: an invoice bills one client.
            </p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="invoice-client">Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="invoice-client" aria-label="Client" className="w-full">
                <SelectValue placeholder="Pick a client" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="invoice-issue">Issue date</Label>
              <Input
                id="invoice-issue"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-due">Due date</Label>
              <Input
                id="invoice-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">Empty: the payment terms decide.</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !clientId || !issueDate}>
              Create invoice
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
