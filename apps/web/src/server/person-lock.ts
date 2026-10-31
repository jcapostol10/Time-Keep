import { sql } from "@timekeep/db";

/**
 * The per-person lock (a transaction-scoped advisory lock): starting a timer,
 * deactivation and removal (invariant 4), and, from Phase 5a, every guarded
 * entry write and the submission of a period take it, so a submission's
 * totals never miss an edit that the guard let through.
 */
export function timerLock(workspaceId: string, userId: string) {
  return sql`SELECT pg_advisory_xact_lock(hashtext(${`${workspaceId}:${userId}`}))`;
}
