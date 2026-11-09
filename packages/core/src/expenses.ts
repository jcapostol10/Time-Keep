/**
 * Expenses (Phase 6c, decisions 14–19): what a person spent on a project,
 * always in the workspace currency. A category is a fixed amount or a price
 * per unit; a unit expense stores a quantity in hundredths and the unit price
 * snapshotted when it was saved, so a later price change touches no history.
 */

export const EXPENSE_CATEGORY_KINDS = ["FIXED", "UNIT"] as const;
export type ExpenseCategoryKind = (typeof EXPENSE_CATEGORY_KINDS)[number];

/** Decision 15: receipts are capped at 4 MB. */
export const RECEIPT_MAX_BYTES = 4 * 1024 * 1024;
export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type ReceiptType = (typeof RECEIPT_TYPES)[number];

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  signature.every((b, i) => bytes[offset + i] === b);

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = ascii("RIFF");
const WEBP = ascii("WEBP");
const PDF = ascii("%PDF-");

/** The type a file's first bytes say it is; null for anything that is not a receipt type. */
export function sniffReceipt(bytes: Uint8Array): ReceiptType | null {
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return "image/webp";
  if (startsWith(bytes, PDF)) return "application/pdf";
  return null;
}

const EXTENSIONS: Record<ReceiptType, "jpg" | "png" | "webp" | "pdf"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function receiptExtension(type: ReceiptType): "jpg" | "png" | "webp" | "pdf" {
  return EXTENSIONS[type];
}

/** round_half_up(quantity × unit price / 100), in minor units; the quantity is in hundredths. */
export function expenseAmount(quantityCenti: number, unitPriceMinor: number): number {
  return Number((BigInt(quantityCenti) * BigInt(unitPriceMinor) + BigInt(50)) / BigInt(100));
}

const QUANTITY = /^(\d+)(?:[.,](\d{1,2}))?$/;

/** "12.5" or "1,5" → hundredths; null for empty, invalid, more than two decimals, or zero. */
export function parseQuantity(input: string): number | null {
  const match = QUANTITY.exec(input.trim());
  if (!match) return null;
  const [, whole = "0", fraction = ""] = match;
  const centi = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(centi) || centi <= 0) return null;
  return centi;
}

/** 1250 → "12.5", 1200 → "12", 1234 → "12.34". */
export function formatQuantity(centi: number): string {
  const whole = Math.floor(centi / 100);
  const fraction = (centi % 100).toString().padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** What the Expenses report groups by (decision 18). */
export const EXPENSE_GROUP_KEYS = ["category", "project", "user"] as const;
export type ExpenseGroupKey = (typeof EXPENSE_GROUP_KEYS)[number];

export interface ExpenseTotals {
  count: number;
  /** Every expense, in the workspace currency. */
  amountMinor: number;
  /** The billable ones: revenue to bill on. */
  billableMinor: number;
}

export const EMPTY_EXPENSE_TOTALS: ExpenseTotals = { count: 0, amountMinor: 0, billableMinor: 0 };

export function addExpenseTotals(a: ExpenseTotals, b: ExpenseTotals): ExpenseTotals {
  return {
    count: a.count + b.count,
    amountMinor: a.amountMinor + b.amountMinor,
    billableMinor: a.billableMinor + b.billableMinor,
  };
}
