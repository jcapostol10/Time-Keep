import { localDateKey } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";

import { InvoicesPageClient, type InvoicesTab } from "@/components/invoices/invoices-page-client";
import { invoiceKeys } from "@/components/tracker/query-keys";
import { authorize } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";
import { listClientOptions } from "@/server/catalog/clients";
import { listInvoices } from "@/server/invoices/invoices";
import { invoiceWorkspace } from "@/server/invoices/settings";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Invoices" };

/** Invoices (Phase 6d): owners and admins; everyone else gets the 404 page. */
export default async function InvoicesPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/invoices">) {
  const { workspaceSlug } = await params;
  const raw = await searchParams;
  const ctx = await requireWorkspacePage(workspaceSlug, "member", `/w/${workspaceSlug}/invoices`);
  const viewer = await authorizePage(() => authorize(ctx, "invoice.manage"));
  const tab: InvoicesTab =
    raw.tab === "recurring" ? "recurring" : raw.tab === "settings" ? "settings" : "invoices";
  const db = getDb();
  const [ws, clients, page] = await Promise.all([
    invoiceWorkspace(db, viewer.workspaceId),
    listClientOptions(db, viewer.workspaceId),
    listInvoices(db, viewer, { status: "all" }),
  ]);
  const queryClient = new QueryClient();
  queryClient.setQueryData(invoiceKeys.list(workspaceSlug, "status=all"), {
    pages: [page],
    pageParams: [null],
  });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <InvoicesPageClient
        slug={workspaceSlug}
        tab={tab}
        clients={clients.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name }))}
        today={localDateKey(new Date(), ws.timezone)}
        currency={ws.currency}
      />
    </HydrationBoundary>
  );
}
