import { recurringInvoiceSchema } from "@timekeep/core";
import { emailOutbox, eq, timeEntry } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { connectTestDb } from "../../../test/db";
import { at, type InvoiceFixture, NOW, setUpInvoiceFixture } from "../../../test/invoice-fixtures";
import type { Viewer } from "../catalog/viewer";
import { getInvoice, listInvoices } from "./invoices";
import {
  createRecurring,
  deleteRecurring,
  listRecurring,
  runRecurringInvoices,
  updateRecurring,
} from "./recurring";
import { invoiceWorkspace } from "./settings";

const store = vi.hoisted(() => ({
  uploads: [] as string[],
  pdf: new Uint8Array([37, 80, 68, 70]),
}));
vi.mock("../storage", () => ({
  uploadExport: async (args: { key: string }) => {
    store.uploads.push(args.key);
  },
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
const noon = (key: string) => at(key, "12:00");
const RETAINER = { description: "Retainer", quantityCenti: 100, unitPriceMinor: 5000 };

const template = (over: Record<string, unknown>) =>
  recurringInvoiceSchema.parse({
    clientId: f.acmeId,
    name: "Retainer",
    schedule: "MONTHLY",
    dayOfMonth: 31,
    startDate: "2026-01-01",
    lines: [RETAINER],
    ...over,
  });

async function run(key: string) {
  return runRecurringInvoices(db, await invoiceWorkspace(db, f.wsId), noon(key));
}

async function invoices(now: Date) {
  const page = await listInvoices(db, owner, { status: "all" }, now);
  return Promise.all(page.invoices.map((i) => getInvoice(db, owner, i.id, now)));
}

beforeEach(async () => {
  store.uploads.length = 0;
  f = await setUpInvoiceFixture(db);
  owner = await f.viewer("olga");
});

describe("recurring invoices", () => {
  it("a monthly template on the 31st runs on the last day of February and bills January", async () => {
    const t = await createRecurring(db, owner, template({}), NOW);
    expect(t).toMatchObject({
      name: "Retainer",
      clientName: "Acme",
      schedule: "MONTHLY",
      dayOfMonth: 31,
      lines: [RETAINER],
      mode: "DRAFT",
      active: true,
      lastInvoice: null,
      nextRunDate: "2026-10-31",
    });

    expect(await run("2026-02-27")).toEqual({ created: 0, sent: 0 });
    expect(await run("2026-02-28")).toEqual({ created: 1, sent: 0 });
    const [jan] = await invoices(noon("2026-02-28"));
    expect(jan).toMatchObject({
      number: "INV-0001",
      status: "DRAFT",
      recurringId: t.id,
      periodKey: "2026-01-01",
      issueDate: "2026-02-28",
      dueDate: "2026-03-30",
      totalMinor: 5000,
    });
    expect(jan?.lines).toEqual([
      expect.objectContaining({ kind: "MANUAL", description: "Retainer", amountMinor: 5000 }),
    ]);
    // A second run the same day creates nothing.
    expect(
      await runRecurringInvoices(db, await invoiceWorkspace(db, f.wsId), at("2026-02-28", "13:00")),
    ).toEqual({
      created: 0,
      sent: 0,
    });
    expect(await run("2026-03-31")).toEqual({ created: 1, sent: 0 });
    expect((await invoices(noon("2026-03-31"))).map((i) => i.periodKey).sort()).toEqual([
      "2026-01-01",
      "2026-02-01",
    ]);
    const [listed] = await listRecurring(db, owner, noon("2026-03-31"));
    expect(listed?.lastInvoice).toMatchObject({ number: "INV-0002", periodKey: "2026-02-01" });
    expect(listed?.nextRunDate).toBe("2026-04-30");

    await updateRecurring(db, owner, t.id, template({ active: false }), NOW);
    expect(await run("2026-04-30")).toEqual({ created: 0, sent: 0 });
    expect((await listRecurring(db, owner, NOW))[0]?.nextRunDate).toBeNull();

    await deleteRecurring(db, owner, t.id);
    expect(await listRecurring(db, owner, NOW)).toEqual([]);
    // Its invoices stay, unlinked.
    expect((await invoices(NOW)).map((i) => i.recurringId)).toEqual([null, null]);
    await expect(
      createRecurring(db, await f.viewer("max"), template({}), NOW),
    ).rejects.toMatchObject({
      status: 403,
    });
  });

  it("a weekly template imports the week just ended", async () => {
    const bob = await f.entry("bob", { start: at("2026-10-27", "09:00"), minutes: 60 });
    await createRecurring(
      db,
      owner,
      template({
        schedule: "WEEKLY",
        weekday: 1,
        dayOfMonth: null,
        startDate: "2026-10-19",
        lines: [],
        importPeriod: true,
      }),
      NOW,
    );
    expect(await run("2026-11-02")).toEqual({ created: 1, sent: 0 });
    const [inv] = await invoices(noon("2026-11-02"));
    expect(inv).toMatchObject({ periodKey: "2026-10-26", totalMinor: 100_000 });
    expect(inv?.lines).toEqual([
      expect.objectContaining({
        kind: "TIME",
        description: "Web",
        quantityCenti: 100,
        amountMinor: 100_000,
      }),
    ]);
    const [row] = await db
      .select({ v: timeEntry.invoiceId })
      .from(timeEntry)
      .where(eq(timeEntry.id, bob.id));
    expect(row?.v).toBe(inv?.id);
    expect(await run("2026-11-02")).toEqual({ created: 0, sent: 0 });
    expect(await run("2026-11-09")).toEqual({ created: 1, sent: 0 });
    expect(await invoices(noon("2026-11-09"))).toHaveLength(2);
  });

  it("SEND mails the client, or leaves a draft and tells the admins", async () => {
    const acme = await createRecurring(db, owner, template({ mode: "SEND" }), NOW);
    const globex = await createRecurring(
      db,
      owner,
      template({ clientId: f.globexId, name: "Globex retainer", mode: "SEND" }),
      NOW,
    );
    expect(await run("2026-02-28")).toEqual({ created: 2, sent: 1 });
    const all = await invoices(noon("2026-02-28"));
    const sent = all.find((i) => i.recurringId === acme.id)!;
    const draft = all.find((i) => i.recurringId === globex.id)!;
    expect(sent).toMatchObject({ status: "SENT", hasPdf: true, clientName: "Acme" });
    expect(draft).toMatchObject({ status: "DRAFT", hasPdf: false, clientName: "Globex" });
    expect(store.uploads).toEqual([`invoices/${f.wsId}/${sent.id}.pdf`]);

    const mail = await db
      .select()
      .from(emailOutbox)
      .orderBy(emailOutbox.kind, emailOutbox.toAddress);
    expect(mail.map((m) => [m.kind, m.toAddress])).toEqual([
      [`invoice.recurring-unsent:${globex.id}:2026-01-01`, await userEmail("ann")],
      [`invoice.recurring-unsent:${globex.id}:2026-01-01`, await userEmail("olga")],
      [`invoice.sent:${sent.id}`, "billing@acme.test"],
    ]);
    expect(mail[0]?.subject).toContain(draft.number);
    // Nothing twice.
    expect(await run("2026-02-28")).toEqual({ created: 0, sent: 0 });
    expect(await db.select().from(emailOutbox)).toHaveLength(3);
  });

  it("a template started mid-period skips that period, and an ended one stops", async () => {
    const t = await createRecurring(
      db,
      owner,
      template({ schedule: "WEEKLY", weekday: 1, dayOfMonth: null, startDate: "2026-10-28" }),
      NOW,
    );
    expect(t.nextRunDate).toBe("2026-11-09");
    expect(await run("2026-11-02")).toEqual({ created: 0, sent: 0 });
    expect(await run("2026-11-09")).toEqual({ created: 1, sent: 0 });
    await updateRecurring(
      db,
      owner,
      t.id,
      template({
        schedule: "WEEKLY",
        weekday: 1,
        dayOfMonth: null,
        startDate: "2026-10-28",
        endDate: "2026-11-09",
      }),
      NOW,
    );
    expect(await run("2026-11-16")).toEqual({ created: 0, sent: 0 });
    expect((await listRecurring(db, owner, noon("2026-11-10")))[0]?.nextRunDate).toBeNull();
  });
});

async function userEmail(who: string): Promise<string> {
  const u = await db.query.user.findFirst({ where: (t, { eq: e }) => e(t.id, f.ids[who]!) });
  return u!.email;
}
