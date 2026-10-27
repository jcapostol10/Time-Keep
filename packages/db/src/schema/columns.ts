import { sql } from "drizzle-orm";
import { timestamp } from "drizzle-orm/pg-core";

/**
 * Shared timestamp columns. All timestamps are timestamptz and stored in UTC.
 * Both come from the database clock (`now()`): the app server's clock can be
 * hundreds of milliseconds off Postgres's, so mixing them could order an
 * update before the insert it follows.
 */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
};
