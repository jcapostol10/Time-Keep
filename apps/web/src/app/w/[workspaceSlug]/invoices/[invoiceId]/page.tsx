import { localDateKey } from "@timekeep/core";
import { getDb } from "@timekeep/db";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { InvoiceEditor } from "@/components/invoices/invoice-editor";
import { invoiceKeys } from "@/components/tracker/query-keys";
import { authorize } from "@/server/authz";
import { authorizePage } from "@/server/authz-page";
import { CatalogError } from "@/server/catalog/errors";
import { clientProjects } from "@/server/invoices/import";
import { getInvoice } from "@/server/invoices/invoices";
import { invoiceWorkspace } from "@/server/invoices/settings";
import { requireWorkspacePage } from "@/server/workspace-access";

export const metadata: Metadata = { title: "Invoice" };

/** One invoice (Phase 6d): a draft is edited here, a sent one takes payments. */
export default async function InvoicePage({
  params,
}: PageProps<"/w/[workspaceSlug]/invoices/[invoiceId]">) {
  const { workspaceSlug, invoiceId } = await params;
  const ctx = await requireWorkspacePage(
    workspaceSlug,
    "member",
    `/w/${workspaceSlug}/invoices/${invoiceId}`,
  );
  const viewer = await authorizePage(() => authorize(ctx, "invoice.manage"));
  const db = getDb();
  const invoice = await getInvoice(db, viewer, invoiceId).catch((error: unknown) => {
    if (error instanceof CatalogError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const [ws, projects] = await Promise.all([
    invoiceWorkspace(db, viewer.workspaceId),
    clientProjects(db, viewer, invoice.clientId),
  ]);
  const queryClient = new QueryClient();
  queryClient.setQueryData(invoiceKeys.one(workspaceSlug, invoiceId), invoice);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <InvoiceEditor
        slug={workspaceSlug}
        invoiceId={invoiceId}
        projects={projects}
        today={localDateKey(new Date(), ws.timezone)}
      />
    </HydrationBoundary>
  );
}
