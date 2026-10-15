import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Outgoing email stored instead of sent, on preview deployments only
 * (MAIL_CAPTURE). The e2e suite reads it the way it reads Mailpit locally.
 * Rows are e2e traffic and are pruned by `db:e2e-cleanup`.
 */
export const capturedEmail = pgTable(
  "captured_email",
  {
    id: text("id").primaryKey(),
    /** Lower-cased recipient address. */
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("captured_email_to_created_idx").on(t.toAddress, t.createdAt.desc())],
);

export type CapturedEmail = typeof capturedEmail.$inferSelect;
