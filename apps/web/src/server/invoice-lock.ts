import { sql } from "@timekeep/db";

/**
 * One invoice import per client at a time (Phase 6d, decision 23): a
 * transaction-scoped advisory lock. Deleting one of the client's projects
 * takes it too, so its "is any time invoiced" check cannot run between an
 * import's marks and its commit. In its own module so the catalog can take
 * it without loading the invoice service.
 */
export function clientLock(clientId: string) {
  return sql`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${clientId}`}))`;
}
