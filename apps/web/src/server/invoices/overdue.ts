import "server-only";

import { formatMoney, localDateKey } from "@timekeep/core";
import { and, client, type Database, emailOutbox, eq, invoice, lt, sql } from "@timekeep/db";

import { env } from "../env";
import { enqueueEmail } from "../outbox";
import { activeAdminEmails, invoiceOverdueEmail } from "./emails";
import type { RecurringZone } from "./recurring";
import { invoiceStatusSql, paidMinorSql } from "./status-sql";

/**
 * Decision 21: the daily job marks nothing; it sends "overdue" once per
 * invoice (the outbox `kind` is the dedupe) to the active owners and admins.
 * Returns how many invoices were announced.
 */
export async function sendOverdueEmails(
  db: Database,
  ws: RecurringZone,
  now: Date,
): Promise<number> {
  const today = localDateKey(now, ws.timezone);
  const kindOf = (id: string) => `invoice.overdue:${id}`;
  const rows = await db
    .select({
      id: invoice.id,
      number: invoice.number,
      dueDate: invoice.dueDate,
      currency: invoice.currency,
      totalMinor: invoice.totalMinor,
      paid: paidMinorSql(),
      clientName: client.name,
    })
    .from(invoice)
    .innerJoin(client, eq(client.id, invoice.clientId))
    .where(
      and(
        eq(invoice.workspaceId, ws.id),
        eq(invoice.status, "SENT"),
        lt(invoice.dueDate, today),
        sql`${invoiceStatusSql(today)} = 'OVERDUE'`,
        sql`not exists (select 1 from ${emailOutbox} where ${emailOutbox.workspaceId} = ${ws.id} and ${emailOutbox.kind} = 'invoice.overdue:' || "invoice"."id")`,
      ),
    )
    .orderBy(invoice.dueDate, invoice.id);
  if (rows.length === 0) return 0;
  const to = await activeAdminEmails(db, ws.id);
  for (const row of rows) {
    const content = invoiceOverdueEmail({
      appUrl: env().APP_URL,
      slug: ws.slug,
      invoiceId: row.id,
      number: row.number,
      clientName: row.clientName,
      balanceText: formatMoney(Math.max(0, row.totalMinor - Number(row.paid)), row.currency),
      dueDate: row.dueDate,
    });
    for (const address of to) {
      await enqueueEmail(db, { workspaceId: ws.id, to: address, kind: kindOf(row.id), ...content });
    }
  }
  return rows.length;
}
