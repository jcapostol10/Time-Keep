import "server-only";

import { sql } from "@timekeep/db";

/**
 * One currency decision at a time per workspace. A change of a client's, a
 * project's or the workspace's currency, and a rate saved in a currency, each
 * read what they are about to relabel and then write it: taken first inside
 * the transaction, this lock keeps a second writer from deciding on a state
 * the first is about to change.
 */
export const currencyLock = (workspaceId: string) =>
  sql`select pg_advisory_xact_lock(hashtext(${`currency:${workspaceId}`}))`;
