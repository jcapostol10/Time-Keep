import { timestamp } from "drizzle-orm/pg-core";

/** Shared timestamp columns. All timestamps are timestamptz and stored in UTC. */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
