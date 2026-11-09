import "server-only";

import {
  RECEIPT_MAX_BYTES,
  type ReceiptType,
  receiptExtension,
  sniffReceipt,
} from "@timekeep/core";
import type { Database } from "@timekeep/db";

import type { ExpenseDTO } from "@/lib/expense-types";

import { WorkspaceAccessError } from "./access-error";
import type { Viewer } from "./catalog/viewer";
import { expenseScope, getExpense, setReceipt } from "./expenses";
import { deleteExport, presignedExportUrl, uploadExport } from "./storage";

/**
 * Receipts (Phase 6c decision 15): one file per expense in the private export
 * bucket, typed by its bytes, with an optional JPEG thumbnail the browser
 * made. Seen through 5-minute presigned URLs by whoever may read the
 * expense; written by whoever may write it, through the approval guard.
 */

const URL_SECONDS = 5 * 60;
/** A thumbnail is a small JPEG; anything else is dropped, not refused. */
const THUMB_MAX_BYTES = 256 * 1024;

export const RECEIPT_TOO_LARGE = "A receipt is at most 4 MB.";
export const RECEIPT_WRONG_TYPE = "Receipts are JPEG, PNG, WebP or PDF files.";

/** A refused receipt: the message is for the person. */
export class ReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptError";
  }
}

export function receiptKeys(
  workspaceId: string,
  expenseId: string,
): { file: string; thumb: string } {
  return {
    file: `receipts/${workspaceId}/${expenseId}`,
    thumb: `receipts/${workspaceId}/${expenseId}.thumb.jpg`,
  };
}

/**
 * The receipt's type, from its bytes. The browser declares a type from the file's
 * name, so a JPEG named `.png` is a JPEG and is stored as one; a PDF declared as an
 * image, an image declared as a PDF, or bytes of no receipt type are refused.
 */
export function assertReceipt(bytes: Uint8Array, declaredMime: string): ReceiptType {
  if (bytes.length > RECEIPT_MAX_BYTES) throw new ReceiptError(RECEIPT_TOO_LARGE);
  const type = sniffReceipt(bytes);
  if (!type) throw new ReceiptError(RECEIPT_WRONG_TYPE);
  if (declaredMime && (declaredMime === "application/pdf") !== (type === "application/pdf")) {
    throw new ReceiptError(RECEIPT_WRONG_TYPE);
  }
  return type;
}

function usableThumb(thumb: Uint8Array | null): Uint8Array | null {
  if (!thumb || thumb.length === 0 || thumb.length > THUMB_MAX_BYTES) return null;
  return sniffReceipt(thumb) === "image/jpeg" ? thumb : null;
}

async function deleteQuietly(keys: (string | null)[]): Promise<void> {
  for (const key of keys) {
    if (!key) continue;
    try {
      await deleteExport(key);
    } catch (error) {
      console.error("[receipts] delete failed", key, error);
    }
  }
}

/** Stores a receipt on an expense the viewer may write; a previous one is replaced. */
export async function saveReceipt(
  db: Database,
  viewer: Viewer,
  expenseId: string,
  input: { bytes: Uint8Array; mime: string; thumb: Uint8Array | null },
  opts: { note?: string; now?: Date } = {},
): Promise<ExpenseDTO> {
  const type = assertReceipt(input.bytes, input.mime);
  const thumb = usableThumb(input.thumb);
  const { scope, row } = await expenseScope(db, viewer, expenseId);
  if (row.deletedAt) throw new WorkspaceAccessError(404, "Not found");
  const keys = receiptKeys(scope.workspaceId, expenseId);
  const next = { fileKey: keys.file, thumbKey: thumb ? keys.thumb : null, mime: type };
  const { expense, previous } = await setReceipt(db, scope, expenseId, next, {
    ...opts,
    upload: async () => {
      await uploadExport({ key: keys.file, body: input.bytes, contentType: type });
      if (thumb) await uploadExport({ key: keys.thumb, body: thumb, contentType: "image/jpeg" });
    },
  });
  // Objects the row no longer names (an old thumbnail when the new receipt has none).
  await deleteQuietly(
    [previous.fileKey, previous.thumbKey].filter((k) => k !== next.fileKey && k !== next.thumbKey),
  );
  return expense;
}

export async function removeReceipt(
  db: Database,
  viewer: Viewer,
  expenseId: string,
  opts: { note?: string; now?: Date } = {},
): Promise<ExpenseDTO> {
  const { scope } = await expenseScope(db, viewer, expenseId);
  const { expense, previous } = await setReceipt(db, scope, expenseId, null, opts);
  await deleteQuietly([previous.fileKey, previous.thumbKey]);
  return expense;
}

/** A 5-minute inline link to the receipt (or its thumbnail) of an expense the viewer may read. */
export async function receiptUrl(
  db: Database,
  viewer: Viewer,
  expenseId: string,
  opts: { thumb?: boolean } = {},
): Promise<string> {
  const e = await getExpense(db, viewer, expenseId);
  if (!e.receipt) throw new WorkspaceAccessError(404, "Not found");
  const keys = receiptKeys(viewer.workspaceId, expenseId);
  if (opts.thumb) {
    if (!e.receipt.thumb) throw new WorkspaceAccessError(404, "Not found");
    return presignedExportUrl(keys.thumb, URL_SECONDS, "receipt-thumb.jpg", { inline: true });
  }
  return presignedExportUrl(keys.file, URL_SECONDS, `receipt.${receiptExtension(e.receipt.mime)}`, {
    inline: true,
  });
}
