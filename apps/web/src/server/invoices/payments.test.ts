import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { connectTestDb } from "../../../test/db";
import { type InvoiceFixture, NOW, setUpInvoiceFixture } from "../../../test/invoice-fixtures";
import type { Viewer } from "../catalog/viewer";
import { addManualLine, createInvoice, getInvoice, sendInvoice, updateInvoice } from "./invoices";
import { addPayment, removePayment } from "./payments";

const store = vi.hoisted(() => ({ pdf: new Uint8Array([37, 80, 68, 70]) }));
vi.mock("../storage", () => ({
  uploadExport: async () => undefined,
  deleteExport: async () => undefined,
  presignedExportUrl: async (key: string) => `https://signed.test/${key}`,
  getExport: async () => store.pdf,
}));
vi.mock("./pdf", () => ({ buildInvoicePdf: async () => store.pdf }));

const h = connectTestDb();
const db = h.db;
afterAll(() => h.close());

let f: InvoiceFixture;
let owner: Viewer;

beforeEach(async () => {
  f = await setUpInvoiceFixture(db);
  owner = await f.viewer("olga");
});

/** A sent invoice of 15,290: lines 100.01 + 50.00, 10% off, 12% + 1.25% tax. */
async function sentInvoice() {
  const inv = await createInvoice(db, owner, { clientId: f.acmeId, issueDate: "2026-10-28" }, NOW);
  await addManualLine(db, owner, inv.id, {
    description: "Design",
    quantityCenti: 100,
    unitPriceMinor: 10001,
  });
  await addManualLine(db, owner, inv.id, {
    description: "Hosting",
    quantityCenti: 100,
    unitPriceMinor: 5000,
  });
  await updateInvoice(db, owner, inv.id, {
    discountBps: 1000,
    tax1Name: "VAT",
    tax1Bps: 1200,
    tax2Name: "Local",
    tax2Bps: 125,
  });
  return sendInvoice(db, owner, inv.id, { email: false, now: NOW });
}

describe("payments", () => {
  it("move the status and the balance; an overpayment is refused", async () => {
    const inv = await sentInvoice();
    expect(inv.totalMinor).toBe(15290);

    let dto = await addPayment(db, owner, inv.id, {
      date: "2026-10-29",
      amountMinor: 5000,
      note: "Deposit",
    });
    expect(dto).toMatchObject({
      computedStatus: "PARTIALLY_PAID",
      paidMinor: 5000,
      balanceMinor: 10290,
    });
    expect(dto.payments).toEqual([
      expect.objectContaining({
        date: "2026-10-29",
        amountMinor: 5000,
        note: "Deposit",
        createdBy: f.ids.olga,
      }),
    ]);
    dto = await addPayment(db, owner, inv.id, { date: "2026-10-30", amountMinor: 10290, note: "" });
    expect(dto).toMatchObject({ computedStatus: "PAID", paidMinor: 15290, balanceMinor: 0 });
    await expect(
      addPayment(db, owner, inv.id, { date: "2026-10-31", amountMinor: 1, note: "" }),
    ).rejects.toThrow("This payment is more than the balance.");

    const first = dto.payments[0]!;
    dto = await removePayment(db, owner, inv.id, first.id);
    expect(dto).toMatchObject({
      computedStatus: "PARTIALLY_PAID",
      paidMinor: 10290,
      balanceMinor: 5000,
    });
    expect(dto.payments.map((p) => p.amountMinor)).toEqual([10290]);
    expect((await getInvoice(db, owner, inv.id)).paidMinor).toBe(10290);

    const draft = await createInvoice(
      db,
      owner,
      { clientId: f.acmeId, issueDate: "2026-10-28" },
      NOW,
    );
    await expect(
      addPayment(db, owner, draft.id, { date: "2026-10-29", amountMinor: 1, note: "" }),
    ).rejects.toThrow("Only a sent invoice takes payments.");
    await expect(
      addPayment(db, await f.viewer("max"), inv.id, {
        date: "2026-10-29",
        amountMinor: 1,
        note: "",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("an overdue invoice reads overdue until a payment, then paid", async () => {
    const inv = await sentInvoice();
    const later = new Date("2026-12-01T04:00:00.000Z");
    expect((await getInvoice(db, owner, inv.id, later)).computedStatus).toBe("OVERDUE");
    await addPayment(db, owner, inv.id, { date: "2026-12-01", amountMinor: 15290, note: "" });
    expect((await getInvoice(db, owner, inv.id, later)).computedStatus).toBe("PAID");
  });
});
