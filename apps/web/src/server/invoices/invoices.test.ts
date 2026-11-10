import { invoiceSettingsSchema } from "@timekeep/core";
import { emailOutbox, eq, invoice, timeEntry } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { connectTestDb } from "../../../test/db";
import {
  at,
  type InvoiceFixture,
  NOW,
  setUpInvoiceFixture,
  WEEK,
} from "../../../test/invoice-fixtures";
import type { Viewer } from "../catalog/viewer";
import { importIntoInvoice } from "./import";
import {
  addManualLine,
  createInvoice,
  deleteInvoice,
  getInvoice,
  listInvoices,
  removeLine,
  reorderLines,
  sendInvoice,
  updateInvoice,
  updateLine,
  voidInvoice,
} from "./invoices";
import { getInvoiceSettings, updateInvoiceSettings } from "./settings";

const store = vi.hoisted(() => ({
  uploads: [] as { key: string; contentType: string; size: number }[],
  deletes: [] as string[],
  pdf: new Uint8Array([37, 80, 68, 70]),
}));
vi.mock("../storage", () => ({
  uploadExport: async (args: { key: string; body: Uint8Array; contentType: string }) => {
    store.uploads.push({ key: args.key, contentType: args.contentType, size: args.body.length });
  },
  deleteExport: async (key: string) => {
    store.deletes.push(key);
  },
  presignedExportUrl: async (key: string, ttl: number, filename: string) =>
    `https://signed.test/${key}?ttl=${ttl}&name=${encodeURIComponent(filename)}`,
  getExport: async () => store.pdf,
}));
vi.mock("./pdf", () => ({ buildInvoicePdf: async () => store.pdf }));

const h = connectTestDb();
const h2 = connectTestDb();
const db = h.db;
afterAll(() => Promise.all([h.close(), h2.close()]));

let f: InvoiceFixture;
let owner: Viewer;
const IMPORT = {
  from: WEEK.from,
  to: WEEK.to,
  projectIds: [],
  groupBy: "project" as const,
  expenses: false,
};

const create = (clientId: string, issueDate = "2026-10-28", dueDate?: string) =>
  createInvoice(db, owner, { clientId, issueDate, dueDate }, NOW);
const line = (id: string, description: string, quantityCenti: number, unitPriceMinor: number) =>
  addManualLine(db, owner, id, { description, quantityCenti, unitPriceMinor });
const invoiceIdOf = async (entryId: string) =>
  (await db.select({ v: timeEntry.invoiceId }).from(timeEntry).where(eq(timeEntry.id, entryId)))[0]
    ?.v;

beforeEach(async () => {
  store.uploads.length = 0;
  store.deletes.length = 0;
  f = await setUpInvoiceFixture(db);
  owner = await f.viewer("olga");
});

describe("createInvoice", () => {
  it("takes the client's currency and the next number under the sequence", async () => {
    const a = await create(f.acmeId);
    expect(a).toMatchObject({
      number: "INV-0001",
      currency: "PHP",
      clientName: "Acme",
      clientEmail: "billing@acme.test",
      status: "DRAFT",
      computedStatus: "DRAFT",
      issueDate: "2026-10-28",
      dueDate: "2026-11-27",
      subtotalMinor: 0,
      totalMinor: 0,
      paidMinor: 0,
      balanceMinor: 0,
      hasPdf: false,
      publicPath: null,
      lines: [],
      payments: [],
    });
    const b = await create(f.globexId, "2026-10-28", "2026-10-30");
    expect(b).toMatchObject({ number: "INV-0002", currency: "USD", dueDate: "2026-10-30" });

    await updateInvoiceSettings(
      db,
      owner,
      invoiceSettingsSchema.parse({
        numberPrefix: "ACME-",
        numberPadding: 3,
        nextNumber: 3,
        tax1Name: "VAT",
        tax1Bps: 1200,
        notes: "Thank you",
      }),
    );
    expect((await getInvoiceSettings(db, owner)).nextNumberPreview).toBe("ACME-003");
    const c = await create(f.acmeId);
    expect(c).toMatchObject({
      number: "ACME-003",
      tax1Name: "VAT",
      tax1Bps: 1200,
      notes: "Thank you",
    });

    for (const who of ["max", "bob"]) {
      await expect(
        createInvoice(
          db,
          await f.viewer(who),
          { clientId: f.acmeId, issueDate: "2026-10-28" },
          NOW,
        ),
      ).rejects.toMatchObject({ status: 403 });
    }
  });

  it("two concurrent creates take two numbers", async () => {
    const [a, b] = await Promise.all([
      createInvoice(h.db, owner, { clientId: f.acmeId, issueDate: "2026-10-28" }, NOW),
      createInvoice(h2.db, owner, { clientId: f.acmeId, issueDate: "2026-10-28" }, NOW),
    ]);
    expect([a.number, b.number].sort()).toEqual(["INV-0001", "INV-0002"]);
  });
});

describe("draft edits", () => {
  it("recompute the totals; a non-draft refuses them", async () => {
    const inv = await create(f.acmeId);
    await line(inv.id, "Design", 100, 10001);
    let dto = await line(inv.id, "Hosting", 200, 2500);
    expect(dto.lines.map((l) => [l.position, l.description, l.amountMinor])).toEqual([
      [1, "Design", 10001],
      [2, "Hosting", 5000],
    ]);
    expect(dto.subtotalMinor).toBe(15001);
    dto = await updateInvoice(db, owner, inv.id, {
      discountBps: 1000,
      tax1Name: "VAT",
      tax1Bps: 1200,
      tax2Name: "Local",
      tax2Bps: 125,
    });
    expect(dto).toMatchObject({
      subtotalMinor: 15001,
      discountMinor: 1500,
      tax1Minor: 1620,
      tax2Minor: 169,
      totalMinor: 15290,
      balanceMinor: 15290,
    });
    const [row] = await db
      .select({ subtotal: invoice.subtotalMinor, total: invoice.totalMinor })
      .from(invoice)
      .where(eq(invoice.id, inv.id));
    expect(row).toEqual({ subtotal: 15001, total: 15290 });

    const [l1, l2] = dto.lines as [(typeof dto.lines)[0], (typeof dto.lines)[0]];
    dto = await updateLine(db, owner, inv.id, l2.id, {
      description: "Hosting x2",
      quantityCenti: 400,
      unitPriceMinor: 2500,
    });
    expect(dto.lines[1]).toMatchObject({ description: "Hosting x2", amountMinor: 10000 });
    expect(dto.subtotalMinor).toBe(20001);
    dto = await reorderLines(db, owner, inv.id, [l2.id, l1.id]);
    expect(dto.lines.map((l) => [l.id, l.position])).toEqual([
      [l2.id, 1],
      [l1.id, 2],
    ]);
    dto = await removeLine(db, owner, inv.id, l2.id);
    expect(dto.lines.map((l) => [l.id, l.position])).toEqual([[l1.id, 1]]);
    expect(dto.subtotalMinor).toBe(10001);

    await sendInvoice(db, owner, inv.id, { email: false, now: NOW });
    const locked = "Only a draft can be changed.";
    await expect(line(inv.id, "Late", 1, 1)).rejects.toThrow(locked);
    await expect(updateInvoice(db, owner, inv.id, { discountBps: 0 })).rejects.toThrow(locked);
    await expect(
      updateLine(db, owner, inv.id, l1.id, { ...l1, unitPriceMinor: 1 }),
    ).rejects.toThrow(locked);
    await expect(removeLine(db, owner, inv.id, l1.id)).rejects.toThrow(locked);
    // Notes and the accounting reference stay editable after sending.
    await expect(
      updateInvoice(db, owner, inv.id, { notes: "Paid by wire", externalRef: "QB-9" }),
    ).resolves.toMatchObject({ notes: "Paid by wire", externalRef: "QB-9" });
  });

  it("a duplicate number is a conflict and a number change needs a draft", async () => {
    const a = await create(f.acmeId, "2026-10-27");
    const b = await create(f.acmeId, "2026-10-28");
    await expect(updateInvoice(db, owner, b.id, { number: "INV-0001" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "An invoice with this number exists.",
    });
    await expect(updateInvoice(db, owner, b.id, { number: "CUSTOM-7" })).resolves.toMatchObject({
      number: "CUSTOM-7",
    });
    await line(b.id, "Design", 100, 5000);
    await sendInvoice(db, owner, b.id, { email: false, now: NOW });
    await expect(updateInvoice(db, owner, b.id, { number: "X" })).rejects.toThrow(
      "Only a draft can be changed.",
    );

    const all = await listInvoices(db, owner, { status: "all" }, NOW);
    expect(all.invoices.map((i) => [i.number, i.computedStatus])).toEqual([
      ["CUSTOM-7", "SENT"],
      ["INV-0001", "DRAFT"],
    ]);
    expect(all.totals).toEqual({
      count: 2,
      totalMinor: [{ currency: "PHP", amountMinor: 5000 }],
      balanceMinor: [{ currency: "PHP", amountMinor: 5000 }],
    });
    expect(all.nextCursor).toBeNull();
    const drafts = await listInvoices(db, owner, { status: "DRAFT" }, NOW);
    expect(drafts.invoices.map((i) => i.id)).toEqual([a.id]);
    const paged = await listInvoices(db, owner, { status: "all", limit: 1 }, NOW);
    expect(paged.invoices.map((i) => i.id)).toEqual([b.id]);
    expect(paged.nextCursor).not.toBeNull();
    const next = await listInvoices(
      db,
      owner,
      { status: "all", limit: 1, cursor: paged.nextCursor! },
      NOW,
    );
    expect(next.invoices.map((i) => i.id)).toEqual([a.id]);
    await expect(getInvoice(db, await f.viewer("max"), a.id)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("delete and void", () => {
  it("delete releases a draft's time; void releases a sent invoice's and keeps the PDF", async () => {
    const e = await f.entry("bob", { start: at("2026-10-27", "09:00"), minutes: 60 });
    const draft = await create(f.acmeId);
    await importIntoInvoice(db, owner, draft.id, IMPORT, NOW);
    expect(await invoiceIdOf(e.id)).toBe(draft.id);
    await expect(voidInvoice(db, owner, draft.id)).rejects.toThrow(
      "Only a sent invoice can be voided.",
    );
    await deleteInvoice(db, owner, draft.id);
    expect(await invoiceIdOf(e.id)).toBeNull();
    await expect(getInvoice(db, owner, draft.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const sent = await create(f.acmeId);
    await importIntoInvoice(db, owner, sent.id, IMPORT, NOW);
    await sendInvoice(db, owner, sent.id, { email: false, now: NOW });
    await expect(deleteInvoice(db, owner, sent.id)).rejects.toThrow(
      "Only a draft can be deleted. Void it instead.",
    );
    const voided = await voidInvoice(db, owner, sent.id);
    expect(voided).toMatchObject({ status: "VOID", computedStatus: "VOID", hasPdf: true });
    expect(await invoiceIdOf(e.id)).toBeNull();
    expect(store.deletes).toEqual([]);
    // The number is not reused.
    expect((await create(f.acmeId)).number).toBe("INV-0003");
  });
});

describe("sendInvoice", () => {
  it("freezes a PDF, mints a token and emails the client with the attachment", async () => {
    const inv = await create(f.acmeId);
    await line(inv.id, "Design", 200, 10000);
    const sent = await sendInvoice(db, owner, inv.id, { email: true, now: NOW });
    expect(sent).toMatchObject({
      status: "SENT",
      computedStatus: "SENT",
      hasPdf: true,
      sentAt: NOW.toISOString(),
      totalMinor: 20000,
    });
    expect(sent.publicPath).toMatch(/^\/invoice\/[A-Za-z0-9_-]{20,}$/);
    expect(store.uploads).toEqual([
      { key: `invoices/${f.wsId}/${inv.id}.pdf`, contentType: "application/pdf", size: 4 },
    ]);
    const rows = await db.select().from(emailOutbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspaceId: f.wsId,
      toAddress: "billing@acme.test",
      kind: `invoice.sent:${inv.id}`,
      attachmentKey: `invoices/${f.wsId}/${inv.id}.pdf`,
      attachmentName: "INV-0001.pdf",
      status: "PENDING",
    });
    expect(rows[0]?.subject).toContain("INV-0001");
    expect(rows[0]?.html).toContain(sent.publicPath!);
    // The token is shown once.
    expect((await getInvoice(db, owner, inv.id)).publicPath).toBeNull();
    await expect(sendInvoice(db, owner, inv.id, { email: false, now: NOW })).rejects.toThrow(
      "This invoice was already sent.",
    );

    const empty = await create(f.acmeId);
    await expect(sendInvoice(db, owner, empty.id, { email: false, now: NOW })).rejects.toThrow(
      "Add a line before sending.",
    );

    const g = await create(f.globexId);
    await line(g.id, "Design", 100, 10000);
    await expect(sendInvoice(db, owner, g.id, { email: true, now: NOW })).rejects.toThrow(
      "This client has no email address.",
    );
    expect((await getInvoice(db, owner, g.id)).status).toBe("DRAFT");
    expect(store.uploads).toHaveLength(1);
    // Mark as sent: the PDF and the token, no email.
    const marked = await sendInvoice(db, owner, g.id, { email: false, now: NOW });
    expect(marked.status).toBe("SENT");
    expect(marked.publicPath).toMatch(/^\/invoice\//);
    expect(store.uploads).toHaveLength(2);
    expect(await db.select().from(emailOutbox)).toHaveLength(1);
  });

  it("two concurrent sends make one PDF and one email", async () => {
    const inv = await create(f.acmeId);
    await line(inv.id, "Design", 100, 10000);
    const results = await Promise.allSettled([
      sendInvoice(h.db, owner, inv.id, { email: true, now: NOW }),
      sendInvoice(h2.db, owner, inv.id, { email: true, now: NOW }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(store.uploads).toHaveLength(1);
    expect(await db.select().from(emailOutbox)).toHaveLength(1);
  });
});
