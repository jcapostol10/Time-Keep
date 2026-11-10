import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * The public invoice link (decision 25): a 32-byte token in the URL, only
 * its sha256 in the database, so a database read cannot reproduce a link.
 */

export const INVOICE_TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

/** Seconds between PDF downloads from one public link: each one is a signed fetch of the frozen file. */
export const INVOICE_DOWNLOAD_INTERVAL_MS = 10_000;

export function newInvoiceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInvoiceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function publicInvoicePath(token: string): string {
  return `/invoice/${token}`;
}
