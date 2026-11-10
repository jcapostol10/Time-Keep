import type { ComputedInvoiceStatus } from "@timekeep/core";

export const INVOICE_STATUS_LABELS: Record<ComputedInvoiceStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  VOID: "Void",
};
