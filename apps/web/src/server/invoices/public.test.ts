import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { connectTestDb } from "../../../test/db";
import { type InvoiceFixture, NOW, setUpInvoiceFixture } from "../../../test/invoice-fixtures";
import type { Viewer } from "../catalog/viewer";
import { addManualLine, createInvoice, sendInvoice, voidInvoice } from "./invoices";
import { addPayment } from "./payments";
import { claimInvoiceDownload, publicInvoice, publicPdfUrl, resolvePublicInvoice } from "./public";
import { updateInvoiceSettings } from "./settings";

const store = vi.hoisted(() => ({ pdf: new Uint8Array([37, 80, 68, 70]) }));
vi.mock("../storage", () => ({
  uploadExport: async () => undefined,
  deleteExport: async () => undefined,
  presignedExportUrl: async (key: string, ttl: number, filename: string) =>
    `https://signed.test/${key}?ttl=${ttl}&name=${encodeURIComponent(filename)}`,
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

describe("the public invoice link", () => {
  it("opens a sent invoice and nothing else", async () => {
    await updateInvoiceSettings(db, owner, {
      companyName: "Workspace Inc.",
      address: "1 Main St",
      taxLine: "TIN 123",
      notes: "",
      paymentTermsDays: 30,
      numberPrefix: "INV-",
      nextNumber: 1,
      numberPadding: 4,
      tax1Name: null,
      tax1Bps: null,
      tax2Name: null,
      tax2Bps: null,
    });
    const inv = await createInvoice(
      db,
      owner,
      { clientId: f.acmeId, issueDate: "2026-10-28" },
      NOW,
    );
    await addManualLine(db, owner, inv.id, {
      description: "Design",
      quantityCenti: 200,
      unitPriceMinor: 10000,
    });
    expect(await resolvePublicInvoice(db, "a".repeat(43))).toBeNull();

    const sent = await sendInvoice(db, owner, inv.id, { email: false, now: NOW });
    const token = sent.publicPath!.slice("/invoice/".length);
    expect(await resolvePublicInvoice(db, token)).toEqual({
      invoiceId: inv.id,
      workspaceId: f.wsId,
    });
    expect(
      await resolvePublicInvoice(db, token.slice(0, -1) + (token.endsWith("A") ? "B" : "A")),
    ).toBeNull();
    expect(await resolvePublicInvoice(db, "../" + token)).toBeNull();
    expect(await resolvePublicInvoice(db, "")).toBeNull();

    const page = await publicInvoice(db, token, NOW);
    expect(page).toMatchObject({
      number: "INV-0001",
      status: "SENT",
      currency: "PHP",
      issueDate: "2026-10-28",
      dueDate: "2026-11-27",
      clientName: "Acme",
      company: { name: "Workspace Inc.", address: "1 Main St", taxLine: "TIN 123" },
      subtotalMinor: 20000,
      totalMinor: 20000,
      paidMinor: 0,
      balanceMinor: 20000,
      canDownload: true,
    });
    expect(page?.lines).toEqual([
      expect.objectContaining({
        description: "Design",
        quantityCenti: 200,
        unitPriceMinor: 10000,
        amountMinor: 20000,
      }),
    ]);
    await addPayment(db, owner, inv.id, { date: "2026-10-29", amountMinor: 5000, note: "" });
    expect(await publicInvoice(db, token, NOW)).toMatchObject({
      status: "PARTIALLY_PAID",
      paidMinor: 5000,
      balanceMinor: 15000,
    });

    expect(await claimInvoiceDownload(db, inv.id, NOW)).toBe(true);
    expect(await claimInvoiceDownload(db, inv.id, new Date(NOW.getTime() + 5_000))).toBe(false);
    expect(await claimInvoiceDownload(db, inv.id, new Date(NOW.getTime() + 11_000))).toBe(true);
    expect(await publicPdfUrl(db, inv.id)).toBe(
      `https://signed.test/invoices/${f.wsId}/${inv.id}.pdf?ttl=300&name=INV-0001.pdf`,
    );

    await voidInvoice(db, owner, inv.id);
    expect(await resolvePublicInvoice(db, token)).toBeNull();
    expect(await publicInvoice(db, token, NOW)).toBeNull();
  });
});
