import { randomUUID } from "node:crypto";

import { type InvoiceStatus, invoiceStatus } from "@timekeep/core";
import { eq, invoice, payment, sql } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb } from "../../../test/db";
import { type InvoiceFixture, setUpInvoiceFixture } from "../../../test/invoice-fixtures";
import { invoiceStatusSql, paidMinorSql } from "./status-sql";

/** Decision 21: the SQL CASE and core `invoiceStatus` agree on every branch. */

const h = connectTestDb();
const db = h.db;
afterAll(() => h.close());

let f: InvoiceFixture;
beforeEach(async () => {
  f = await setUpInvoiceFixture(db);
});

async function row(
  status: InvoiceStatus,
  totalMinor: number,
  paid: number[],
  dueDate = "2026-03-10",
) {
  const id = randomUUID();
  await db.insert(invoice).values({
    id,
    workspaceId: f.wsId,
    clientId: f.acmeId,
    number: id.slice(0, 8),
    issueDate: "2026-03-01",
    dueDate,
    currency: "PHP",
    status,
    totalMinor,
    subtotalMinor: totalMinor,
  });
  for (const amountMinor of paid) {
    await db
      .insert(payment)
      .values({ id: randomUUID(), invoiceId: id, date: "2026-03-05", amountMinor });
  }
  return { id, status, totalMinor, paidMinor: paid.reduce((a, b) => a + b, 0), dueDate };
}

describe("invoiceStatusSql", () => {
  it("agrees with core on every branch and every day around the due date", async () => {
    const cases = await Promise.all([
      row("DRAFT", 10000, []),
      row("SENT", 10000, []),
      row("SENT", 10000, [4000]),
      row("SENT", 10000, [4000, 6000]),
      row("SENT", 10000, [12000]),
      row("SENT", 0, []),
      row("SENT", 0, [1]),
      row("VOID", 10000, [4000]),
      row("VOID", 10000, []),
    ]);
    for (const today of ["2026-03-09", "2026-03-10", "2026-03-11"]) {
      for (const c of cases) {
        const [r] = await db
          .select({ status: invoiceStatusSql(today), paid: paidMinorSql() })
          .from(invoice)
          .where(eq(invoice.id, c.id));
        expect([today, c.status, c.totalMinor, c.paidMinor, r?.status]).toEqual([
          today,
          c.status,
          c.totalMinor,
          c.paidMinor,
          invoiceStatus(c, today),
        ]);
        expect(Number(r?.paid)).toBe(c.paidMinor);
      }
    }
    // The filter form.
    const overdue = await db
      .select({ id: invoice.id })
      .from(invoice)
      .where(sql`${invoiceStatusSql("2026-03-11")} = 'OVERDUE'`);
    expect(overdue.map((r) => r.id).sort()).toEqual(
      cases
        .filter((c) => invoiceStatus(c, "2026-03-11") === "OVERDUE")
        .map((c) => c.id)
        .sort(),
    );
    expect(overdue).toHaveLength(2);
  });
});
