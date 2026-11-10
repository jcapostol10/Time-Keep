import type { ExpenseCategoryKind, ExpenseTotals, ReceiptType } from "@timekeep/core";

/** An expense category as the pickers and the Categories tab read it (Phase 6c). */
export interface ExpenseCategoryDTO {
  id: string;
  name: string;
  kind: ExpenseCategoryKind;
  unitName: string | null;
  /** Minor units of the workspace currency, for UNIT categories. */
  unitPriceMinor: number | null;
  billableDefault: boolean;
  archived: boolean;
}

/** An expense as the Expenses page lists it. Money is in the workspace currency. */
export interface ExpenseDTO {
  id: string;
  userId: string;
  userName: string;
  projectId: string;
  projectName: string;
  projectColor: string;
  clientName: string | null;
  categoryId: string;
  categoryName: string;
  categoryKind: ExpenseCategoryKind;
  unitName: string | null;
  /** "YYYY-MM-DD", a local date. */
  date: string;
  amountMinor: number;
  quantityCenti: number | null;
  /** The category's price when the expense was saved. */
  unitPriceMinor: number | null;
  billable: boolean;
  description: string;
  receipt: { mime: ReceiptType; thumb: boolean } | null;
  /** On an invoice (Phase 6d): read-only for everyone while set. */
  invoiced: boolean;
  invoiceNumber: string | null;
  /** The viewer may change it (the matrix); a lock may still refuse (`lockedReason`). */
  editable: boolean;
  /** Why a member or manager cannot change it: the lock date or a submitted period. */
  lockedReason: string | null;
  updatedAt: string;
}

export interface ExpensePage {
  /** The workspace currency. */
  currency: string;
  expenses: ExpenseDTO[];
  /** Over the whole filter, on the first page only (empty with a cursor). */
  totals: ExpenseTotals;
  /** `"<date>|<id>"` of the last row, newest first; null at the end. */
  nextCursor: string | null;
}
