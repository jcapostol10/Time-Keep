import { getDb } from "@timekeep/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicInvoice } from "@/components/invoices/public-invoice";
import { publicInvoice } from "@/server/invoices/public";

export const metadata: Metadata = {
  title: "Invoice",
  // An invoice link is for its client, not for search engines.
  robots: { index: false, follow: false },
};

/** A sent invoice by link (Phase 6d, decision 25): no session, read-only. */
export default async function PublicInvoicePage({ params }: PageProps<"/invoice/[token]">) {
  const { token } = await params;
  const invoice = await publicInvoice(getDb(), token);
  if (!invoice) notFound();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <PublicInvoice invoice={invoice} pdfHref={`/invoice/${token}/pdf`} />
    </main>
  );
}
