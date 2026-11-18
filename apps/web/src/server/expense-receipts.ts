import "server-only";

import {
  RECEIPT_MAX_BYTES,
  type ReceiptType,
  receiptExtension,
  sniffReceipt,
} from "@timekeep/core";
import type { Database } from "@timekeep/db";
import { randomUUID } from "node:crypto";

import type { ExpenseDTO } from "@/lib/expense-types";

import { WorkspaceAccessError } from "./access-error";
import type { Viewer } from "./catalog/viewer";
import {
  assertReceiptWritable,
  deletedReceipts,
  expenseScope,
  forgetDeletedReceipt,
  receiptRefOf,
  setReceipt,
} from "./expenses";
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

/** Deleted expenses keep their receipt this long, in case the expense is restored. */
const KEEP_DELETED_DAYS = 30;
const PURGE_BATCH = 1000;

/**
 * New object keys for a receipt. Every upload gets its own (a version under
 * the expense's name), so the row always names bytes that match its MIME: a write
 * that fails after the upload leaves the old receipt untouched. Rows saved
 * before this keep `receipts/<ws>/<expense>`; every reader uses the stored key.
 */
export function newReceiptKeys(
  workspaceId: string,
  expenseId: string,
): { file: string; thumb: string } {
  // A sibling of the old key, not a child: an object store that keeps keys as
  // paths refuses `a/b/c` while `a/b` is itself an object.
  const file = `receipts/${workspaceId}/${expenseId}.${randomUUID()}`;
  return { file, thumb: `${file}.thumb.jpg` };
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

/** Removes receipt objects no row names any more (a deleted project's purged expenses). */
export async function deleteReceiptObjects(keys: string[]): Promise<void> {
  await deleteQuietly(keys);
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
  // Asked first, so a write the guard refuses uploads nothing.
  await assertReceiptWritable(db, scope, expenseId, type, opts);
  // Uploaded before the transaction: the object store round trip holds neither a
  // connection nor the person's lock.
  const keys = newReceiptKeys(scope.workspaceId, expenseId);
  const next = { fileKey: keys.file, thumbKey: thumb ? keys.thumb : null, mime: type };
  await uploadExport({ key: keys.file, body: input.bytes, contentType: type });
  if (thumb) await uploadExport({ key: keys.thumb, body: thumb, contentType: "image/jpeg" });
  try {
    const { expense, previous } = await setReceipt(db, scope, expenseId, next, opts);
    await deleteQuietly([previous.fileKey, previous.thumbKey]);
    return expense;
  } catch (error) {
    // The row still names the old receipt: the new objects belong to nothing.
    await deleteQuietly([next.fileKey, next.thumbKey]);
    throw error;
  }
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
  const ref = await receiptRefOf(db, viewer, expenseId);
  if (opts.thumb) {
    if (!ref.thumbKey) throw new WorkspaceAccessError(404, "Not found");
    return presignedExportUrl(ref.thumbKey, URL_SECONDS, "receipt-thumb.jpg", { inline: true });
  }
  return presignedExportUrl(
    ref.fileKey,
    URL_SECONDS,
    `receipt.${receiptExtension(ref.mime as ReceiptType)}`,
    { inline: true },
  );
}

/**
 * The daily purge: receipts of expenses deleted over 30 days ago leave the
 * bucket, then the row forgets them. An object that cannot be deleted keeps
 * its row for the next run. Returns how many expenses were cleared.
 */
export async function purgeDeletedReceipts(db: Database, now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - KEEP_DELETED_DAYS * 24 * 3_600_000);
  let cleared = 0;
  for (const row of await deletedReceipts(db, before, PURGE_BATCH)) {
    try {
      if (row.fileKey) await deleteExport(row.fileKey);
      if (row.thumbKey) await deleteExport(row.thumbKey);
    } catch (error) {
      console.error("[receipts] purge failed", row.id, error);
      continue;
    }
    await forgetDeletedReceipt(db, row.id);
    cleared++;
  }
  return cleared;
}
