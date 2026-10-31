/**
 * The email outbox (Phase 5a decision 1): every email is a row written in the
 * same transaction as its cause and sent after the request, with retries.
 */
export const OUTBOX_STATUSES = ["PENDING", "SENT", "FAILED", "SKIPPED"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** Minutes to wait after the 1st, 2nd, 3rd and 4th failed attempt; the 5th gives up. */
export const OUTBOX_BACKOFF_MINUTES = [1, 5, 30, 120] as const;
export const OUTBOX_MAX_ATTEMPTS = OUTBOX_BACKOFF_MINUTES.length + 1;

/** A claimed row is leased this long, so a crashed sender's rows are retried. */
export const OUTBOX_LEASE_MINUTES = 10;

/** Placeholder addresses (limited users, decision 18) never receive mail. */
export function isUndeliverable(address: string): boolean {
  return address.trim().toLowerCase().endsWith(".invalid");
}
