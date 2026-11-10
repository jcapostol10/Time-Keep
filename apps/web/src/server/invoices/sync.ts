import "server-only";

import type { InvoiceDTO } from "@/lib/invoice-types";

/**
 * The accounting hook (decision 28): an adapter pushes an invoice and returns
 * the other system's reference, stored in `invoice.external_ref`. The
 * registry is empty; nothing calls out. QuickBooks and Xero are the obvious
 * first entries (BACKLOG).
 */
export interface AccountingAdapter {
  name: string;
  pushInvoice(invoice: InvoiceDTO): Promise<{ externalRef: string }>;
}

export const ACCOUNTING_ADAPTERS: readonly AccountingAdapter[] = [];

export function adapterFor(name: string): AccountingAdapter | null {
  return ACCOUNTING_ADAPTERS.find((a) => a.name === name) ?? null;
}
