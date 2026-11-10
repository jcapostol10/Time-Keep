import "server-only";

import type { ComputedInvoiceStatus } from "@timekeep/core";
import { sql } from "@timekeep/db";
import type { SQL } from "drizzle-orm";

/**
 * Decision 21 in SQL, for the list's filter and the daily job: the same
 * branches as core `invoiceStatus`, over the `invoice` table of the outer
 * query (`status-sql.test.ts` runs both over every branch). The identifiers
 * are written out: Drizzle drops the table from a column it renders as a
 * top-level select field, and `payment` has an `id` of its own.
 */

/** The invoice's payments, summed; 0 without any. */
export function paidMinorSql(): SQL<number> {
  return sql<number>`coalesce((select sum(p.amount_minor) from payment p where p.invoice_id = "invoice"."id"), 0)::bigint`.mapWith(
    Number,
  );
}

/** PAID, PARTIALLY_PAID or OVERDUE (against `todayKey`, the workspace's local date), else the stored status. */
export function invoiceStatusSql(todayKey: string): SQL<ComputedInvoiceStatus> {
  const paid = paidMinorSql();
  return sql<ComputedInvoiceStatus>`(case
    when "invoice"."status" <> 'SENT' then "invoice"."status"::text
    when ${paid} >= "invoice"."total_minor" then 'PAID'
    when "invoice"."due_date" < ${todayKey}::date then 'OVERDUE'
    when ${paid} > 0 then 'PARTIALLY_PAID'
    else 'SENT'
  end)`;
}
