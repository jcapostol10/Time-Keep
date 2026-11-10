import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb } from "../../../test/db";
import { type InvoiceFixture, NOW, setUpInvoiceFixture } from "../../../test/invoice-fixtures";
import type { Viewer } from "../catalog/viewer";
import { localChromePath } from "../report-pdf";
import { addManualLine, createInvoice, updateInvoice } from "./invoices";
import { buildInvoicePdf, renderInvoiceHtml } from "./pdf";
import { getInvoiceSettings, updateInvoiceSettings } from "./settings";

const h = connectTestDb();
const db = h.db;
afterAll(() => h.close());

let f: InvoiceFixture;
let owner: Viewer;

beforeEach(async () => {
  f = await setUpInvoiceFixture(db);
  owner = await f.viewer("olga");
  await updateInvoiceSettings(db, owner, {
    companyName: "Workspace <Inc.>",
    address: "1 Main St\nManila",
    taxLine: "TIN 123",
    notes: "",
    paymentTermsDays: 30,
    numberPrefix: "INV-",
    nextNumber: 1,
    numberPadding: 4,
    tax1Name: "VAT",
    tax1Bps: 1200,
    tax2Name: null,
    tax2Bps: null,
  });
});

async function draft() {
  const inv = await createInvoice(db, owner, { clientId: f.acmeId, issueDate: "2026-10-28" }, NOW);
  await addManualLine(db, owner, inv.id, {
    description: "Design & build",
    quantityCenti: 150,
    unitPriceMinor: 100_000,
  });
  await addManualLine(db, owner, inv.id, {
    description: "Hosting",
    quantityCenti: 100,
    unitPriceMinor: 5_000,
  });
  return updateInvoice(db, owner, inv.id, { discountBps: 1000, notes: "Pay by wire." });
}

describe("the invoice template", () => {
  it("renders a self-contained page with the parties, the lines and the totals, escaped", async () => {
    const invoice = await draft();
    const settings = await getInvoiceSettings(db, owner);
    const html = renderInvoiceHtml({ invoice, settings, workspaceName: "Workspace" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/<(script|link)\b/);
    for (const text of [
      "INV-0001",
      "Workspace &lt;Inc.&gt;",
      "TIN 123",
      "Acme",
      "billing@acme.test",
      "Design &amp; build",
      "Hosting",
      "1.50",
      "₱1,000.00",
      "₱1,500.00",
      "₱50.00",
      "₱1,550.00", // subtotal
      "₱155.00", // discount 10%
      "VAT (12%)",
      "₱167.40", // tax on 1,395.00
      "₱1,562.40", // total
      "Pay by wire.",
      "2026-10-28",
      "2026-11-27",
    ]) {
      expect(html).toContain(text);
    }
  });

  it.skipIf(!localChromePath())("prints a PDF", async () => {
    const invoice = await draft();
    const bytes = await buildInvoicePdf(db, owner, invoice.id);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("%PDF");
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
