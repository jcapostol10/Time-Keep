"use client";

import { Button } from "@timekeep/ui/components/button";
import Link from "next/link";
import { useState } from "react";

import { PageHeader } from "@/components/page-header";
import { workspaceRoutes } from "@/lib/routes";

import { InvoiceSettingsTab } from "./invoice-settings-tab";
import { InvoiceTable } from "./invoice-table";
import { NewInvoiceDialog } from "./new-invoice-dialog";
import { RecurringTab } from "./recurring-tab";

export type InvoicesTab = "invoices" | "recurring" | "settings";

const TABS: { tab: InvoicesTab; label: string }[] = [
  { tab: "invoices", label: "Invoices" },
  { tab: "recurring", label: "Recurring" },
  { tab: "settings", label: "Settings" },
];

/** The Invoices page: the list, the recurring templates and the numbering and branding. */
export function InvoicesPageClient({
  slug,
  tab,
  clients,
  today,
  currency,
}: {
  slug: string;
  tab: InvoicesTab;
  clients: { id: string; name: string }[];
  today: string;
  currency: string;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Invoices"
        description="Bill clients for their time and expenses, and record what they paid."
        actions={<Button onClick={() => setCreating(true)}>New invoice</Button>}
      />
      <nav role="tablist" aria-label="Invoices" className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.tab}
            role="tab"
            aria-selected={t.tab === tab}
            href={workspaceRoutes.invoices(slug, t.tab === "invoices" ? undefined : t.tab)}
            className={
              t.tab === tab
                ? "border-primary -mb-px border-b-2 px-3 py-2 text-sm font-medium"
                : "text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "recurring" ? (
        <RecurringTab slug={slug} clients={clients} today={today} currency={currency} />
      ) : tab === "settings" ? (
        <InvoiceSettingsTab slug={slug} />
      ) : (
        <InvoiceTable slug={slug} clients={clients} />
      )}
      {creating ? (
        <NewInvoiceDialog
          slug={slug}
          clients={clients}
          today={today}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}
