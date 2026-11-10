import type {
  ComputedInvoiceStatus,
  InvoiceLineKind,
  InvoiceSettingsInput,
  InvoiceStatus,
  MoneyAmount,
  RecurringInvoiceInput,
} from "@timekeep/core";

/** A recurring template (decision 27) as the Recurring tab lists it. */
export interface RecurringInvoiceDTO extends RecurringInvoiceInput {
  id: string;
  clientName: string;
  /** The latest invoice it made. */
  lastInvoice: { id: string; number: string; periodKey: string } | null;
  /** The next day the daily job will run it, from today; null when inactive or ended. */
  nextRunDate: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What crosses the server boundary for invoices (Phase 6d): JSON with ISO strings and date keys. */

export interface InvoiceSettingsDTO extends InvoiceSettingsInput {
  /** The workspace logo (Workspace settings), printed on the PDF. */
  logoUrl: string | null;
  /** What the next invoice will be numbered, e.g. "INV-0007". */
  nextNumberPreview: string;
}

export interface InvoiceLineDTO {
  id: string;
  position: number;
  kind: InvoiceLineKind;
  description: string;
  /** Hundredths: hours for time, a count for expenses, the typed quantity for a manual line. */
  quantityCenti: number;
  /** Null when an imported line's entries have different rates. */
  unitPriceMinor: number | null;
  amountMinor: number;
  /** The entries or expenses an imported line took. */
  entryCount: number;
}

export interface PaymentDTO {
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  amountMinor: number;
  note: string;
  createdBy: string | null;
  createdAt: string;
}

export interface InvoiceListItem {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  clientAddress: string;
  currency: string;
  status: InvoiceStatus;
  computedStatus: ComputedInvoiceStatus;
  issueDate: string;
  dueDate: string;
  discountBps: number;
  tax1Name: string | null;
  tax1Bps: number | null;
  tax2Name: string | null;
  tax2Bps: number | null;
  notes: string;
  subtotalMinor: number;
  discountMinor: number;
  tax1Minor: number;
  tax2Minor: number;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  sentAt: string | null;
  hasPdf: boolean;
  /** `/invoice/<token>`, only in the answer to a send: the token is shown once. */
  publicPath: string | null;
  recurringId: string | null;
  periodKey: string | null;
  externalRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceDTO extends InvoiceListItem {
  lines: InvoiceLineDTO[];
  payments: PaymentDTO[];
}

export interface InvoiceListQuery {
  status: ComputedInvoiceStatus | "all";
  clientId?: string;
  cursor?: string;
  limit?: number;
}

export interface InvoiceListPage {
  invoices: InvoiceListItem[];
  nextCursor: string | null;
  /** Over the whole filter, by currency (never added across currencies). */
  totals: { count: number; totalMinor: MoneyAmount[]; balanceMinor: MoneyAmount[] };
}

export interface ImportPreviewDTO {
  entries: number;
  /** Rounded by the workspace rule. */
  seconds: number;
  amountMinor: number;
  expenses: number;
  expenseMinor: number;
  skipped: {
    /** Billable, rated entries of the client's projects in another currency. */
    otherCurrency: number;
    /** Billable entries without an amount. */
    unrated: number;
  };
}

/** The public page (decision 25): what a client sees, nothing about the workspace's people. */
export interface PublicInvoiceDTO {
  number: string;
  status: ComputedInvoiceStatus;
  currency: string;
  issueDate: string;
  dueDate: string;
  clientName: string;
  clientAddress: string;
  company: { name: string; address: string; taxLine: string; logoUrl: string | null };
  lines: InvoiceLineDTO[];
  discountBps: number;
  tax1Name: string | null;
  tax1Bps: number | null;
  tax2Name: string | null;
  tax2Bps: number | null;
  subtotalMinor: number;
  discountMinor: number;
  tax1Minor: number;
  tax2Minor: number;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  payments: { date: string; amountMinor: number }[];
  notes: string;
  /** A PDF was frozen on send. */
  canDownload: boolean;
}
