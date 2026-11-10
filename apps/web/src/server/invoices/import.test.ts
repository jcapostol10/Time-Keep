import { randomUUID } from "node:crypto";

import { DEFAULT_REPORT_QUERY, type InvoiceImportInput } from "@timekeep/core";
import { eq, expense, isNotNull, rate, sql, task, timeEntry } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { connectTestDb } from "../../../test/db";
import {
  at,
  type InvoiceFixture,
  NOW,
  PREFS,
  setUpInvoiceFixture,
  WEEK,
} from "../../../test/invoice-fixtures";
import type { Viewer } from "../catalog/viewer";
import { createExpenseCategory } from "../expense-categories";
import { createExpense } from "../expenses";
import { summaryReport } from "../reports";
import { importIntoInvoice, previewImport } from "./import";
import { createInvoice, deleteInvoice, removeLine, sendInvoice } from "./invoices";

const store = vi.hoisted(() => ({ pdf: new Uint8Array([37, 80, 68, 70]) }));
vi.mock("../storage", () => ({
  uploadExport: async () => undefined,
  deleteExport: async () => undefined,
  presignedExportUrl: async (key: string) => `https://signed.test/${key}`,
  getExport: async () => store.pdf,
}));
vi.mock("./pdf", () => ({ buildInvoicePdf: async () => store.pdf }));

const h = connectTestDb();
const h2 = connectTestDb();
const db = h.db;
afterAll(() => Promise.all([h.close(), h2.close()]));

let f: InvoiceFixture;
let owner: Viewer;
let bobId: string;
let olgaId: string;
let maxId: string;
let usdOnAppId: string;

const imp = (over: Partial<InvoiceImportInput> = {}): InvoiceImportInput => ({
  from: WEEK.from,
  to: WEEK.to,
  projectIds: [],
  groupBy: "project",
  expenses: true,
  ...over,
});
const create = (clientId: string) =>
  createInvoice(db, owner, { clientId, issueDate: "2026-10-28" }, NOW);
const invoiceIdOf = async (entryId: string) =>
  (await db.select({ v: timeEntry.invoiceId }).from(timeEntry).where(eq(timeEntry.id, entryId)))[0]
    ?.v;
const invoicedCount = async () =>
  (
    await db
      .select({ n: sql<number>`count(*)::int` })
      .from(timeEntry)
      .where(isNotNull(timeEntry.invoiceId))
  )[0]!.n;

beforeEach(async () => {
  f = await setUpInvoiceFixture(db);
  owner = await f.viewer("olga");
  // Bob 1:20 billable on Web (rounds up to 1:30), Carol 0:50 unbillable on Web,
  // Olga 1:00 on App before the rate existed (unrated), Max 1:00 on Globex's Portal ($40).
  bobId = (await f.entry("bob", { start: at("2026-10-27", "09:00"), minutes: 80 })).id;
  await f.entry("carol", { start: at("2026-10-27", "11:00"), minutes: 50, billable: false });
  olgaId = (
    await f.entry("olga", { start: at("2026-10-26", "08:00"), minutes: 60, projectId: f.appId })
  ).id;
  maxId = (
    await f.entry("max", { start: at("2026-10-27", "09:00"), minutes: 60, projectId: f.portalId })
  ).id;
  // An hour on App rated in USD before Acme was billed in PHP: another currency, skipped.
  usdOnAppId = randomUUID();
  await db.insert(timeEntry).values({
    id: usdOnAppId,
    workspaceId: f.wsId,
    userId: f.ids.bob!,
    projectId: f.appId,
    billable: true,
    start: at("2026-10-28", "09:00"),
    end: at("2026-10-28", "10:00"),
    durationSeconds: 3600,
    billableRateMinor: 4000,
    rateCurrency: "USD",
    rateSource: "project",
    amountMinor: 4000,
  });
});

describe("importIntoInvoice", () => {
  it("takes billable rated time in the invoice's currency on the client's projects, grouped, rounded by the rule", async () => {
    const inv = await create(f.acmeId);
    expect(await previewImport(db, owner, inv.id, imp())).toEqual({
      entries: 1,
      seconds: 5400,
      amountMinor: 150_000,
      expenses: 0,
      expenseMinor: 0,
      skipped: { otherCurrency: 1, unrated: 1, expensesOtherCurrency: 0 },
    });
    const dto = await importIntoInvoice(db, owner, inv.id, imp(), NOW);
    expect(dto.lines).toEqual([
      expect.objectContaining({
        kind: "TIME",
        position: 1,
        description: "Web",
        quantityCenti: 150,
        unitPriceMinor: 100_000,
        amountMinor: 150_000,
        entryCount: 1,
      }),
    ]);
    expect(dto.subtotalMinor).toBe(150_000);
    expect(dto.totalMinor).toBe(150_000);
    expect(await invoiceIdOf(bobId)).toBe(inv.id);
    for (const id of [olgaId, maxId, usdOnAppId]) expect(await invoiceIdOf(id)).toBeNull();

    // The engine agrees: the Summary over the same client, range and rule.
    const summary = await summaryReport(
      db,
      owner,
      {
        ...DEFAULT_REPORT_QUERY,
        preset: "custom",
        from: at(WEEK.from, "00:00").toISOString(),
        to: at("2026-11-02", "00:00").toISOString(),
        clientIds: [f.acmeId],
        billable: "yes",
      },
      PREFS,
      NOW,
    );
    expect(summary.totals.amountMinor).toBe(150_000);

    // Nothing is left to take.
    const again = await importIntoInvoice(db, owner, inv.id, imp(), NOW);
    expect(again.lines).toHaveLength(1);
    expect(await previewImport(db, owner, inv.id, imp())).toMatchObject({ entries: 0 });

    // Globex is billed in USD: Max's hour, nothing else.
    const usd = await create(f.globexId);
    expect(await previewImport(db, owner, usd.id, imp())).toMatchObject({
      entries: 1,
      amountMinor: 4000,
      skipped: { otherCurrency: 0, unrated: 0, expensesOtherCurrency: 0 },
    });
  });

  it("groups by task, person and entry", async () => {
    const taskId = randomUUID();
    await db.insert(task).values({
      id: taskId,
      workspaceId: f.wsId,
      projectId: f.webId,
      name: "Build",
      status: "ACTIVE",
    });
    // Carol at ₱500/h, so a group with both has no single unit price.
    await db.insert(rate).values({
      id: randomUUID(),
      workspaceId: f.wsId,
      level: "member",
      userId: f.ids.carol!,
      amountMinor: 50_000,
      currency: "PHP",
      effectiveFrom: at("2026-10-26", "10:00"),
    });
    await db.insert(timeEntry).values({
      id: randomUUID(),
      workspaceId: f.wsId,
      userId: f.ids.bob!,
      projectId: f.webId,
      taskId,
      description: "Fix nav",
      billable: true,
      start: at("2026-10-27", "13:00"),
      end: at("2026-10-27", "14:00"),
      durationSeconds: 3600,
      billableRateMinor: 100_000,
      rateCurrency: "PHP",
      rateSource: "workspace",
      amountMinor: 100_000,
    });
    await f.entry("carol", {
      start: at("2026-10-27", "14:00"),
      minutes: 30,
      description: "",
    });

    const lines = async (groupBy: InvoiceImportInput["groupBy"]) => {
      const inv = await create(f.acmeId);
      const dto = await importIntoInvoice(db, owner, inv.id, imp({ groupBy }), NOW);
      await deleteInvoice(db, owner, inv.id);
      return dto.lines.map((l) => ({
        description: l.description,
        quantityCenti: l.quantityCenti,
        unitPriceMinor: l.unitPriceMinor,
        amountMinor: l.amountMinor,
        entryCount: l.entryCount,
      }));
    };
    expect(await lines("project")).toEqual([
      {
        description: "Web",
        quantityCenti: 300,
        unitPriceMinor: null,
        amountMinor: 275_000,
        entryCount: 3,
      },
    ]);
    expect(await lines("task")).toEqual([
      {
        description: "Web › Build",
        quantityCenti: 100,
        unitPriceMinor: 100_000,
        amountMinor: 100_000,
        entryCount: 1,
      },
      {
        description: "Web › No task",
        quantityCenti: 200,
        unitPriceMinor: null,
        amountMinor: 175_000,
        entryCount: 2,
      },
    ]);
    expect(await lines("user")).toEqual([
      {
        description: "Web — Bob Member",
        quantityCenti: 250,
        unitPriceMinor: 100_000,
        amountMinor: 250_000,
        entryCount: 2,
      },
      {
        description: "Web — Carol Member",
        quantityCenti: 50,
        unitPriceMinor: 50_000,
        amountMinor: 25_000,
        entryCount: 1,
      },
    ]);
    expect(await lines("entry")).toEqual([
      {
        description: "2026-10-27 Bob Member: Work",
        quantityCenti: 150,
        unitPriceMinor: 100_000,
        amountMinor: 150_000,
        entryCount: 1,
      },
      {
        description: "2026-10-27 Bob Member: Fix nav",
        quantityCenti: 100,
        unitPriceMinor: 100_000,
        amountMinor: 100_000,
        entryCount: 1,
      },
      {
        description: "2026-10-27 Carol Member: Web",
        quantityCenti: 50,
        unitPriceMinor: 50_000,
        amountMinor: 25_000,
        entryCount: 1,
      },
    ]);
    expect(await invoicedCount()).toBe(0);
  });

  it("two concurrent imports invoice each entry once", async () => {
    const [a, b] = await Promise.all([create(f.acmeId), create(f.acmeId)]);
    const [ra, rb] = await Promise.all([
      importIntoInvoice(h.db, owner, a.id, imp(), NOW),
      importIntoInvoice(h2.db, owner, b.id, imp(), NOW),
    ]);
    const timeLines = [ra, rb].map((r) => r.lines.filter((l) => l.kind === "TIME").length).sort();
    expect(timeLines).toEqual([0, 1]);
    expect(await invoicedCount()).toBe(1);
    expect([a.id, b.id]).toContain(await invoiceIdOf(bobId));
  });

  it("imports expenses in the workspace currency only", async () => {
    const travel = await createExpenseCategory(db, owner, {
      name: "Travel",
      kind: "FIXED",
      unitName: null,
      unitPriceMinor: null,
      billableDefault: true,
    });
    const add = async (
      who: string,
      projectId: string,
      amountMinor: number,
      billable = true,
      description = "",
    ) =>
      createExpense(
        db,
        await f.as(who),
        {
          projectId,
          categoryId: travel.id,
          date: "2026-10-27",
          amountMinor,
          billable,
          description,
        },
        { now: NOW },
      );
    const taxi = await add("bob", f.webId, 500, true, "Taxi");
    const train = await add("bob", f.webId, 300);
    const lunch = await add("carol", f.appId, 200, false);
    const abroad = await add("bob", f.portalId, 900);

    const usd = await create(f.globexId);
    // Billable expenses on a client billed in another currency are counted, never imported.
    expect((await previewImport(db, owner, usd.id, imp())).skipped.expensesOtherCurrency).toBe(1);
    const usdDto = await importIntoInvoice(db, owner, usd.id, imp(), NOW);
    expect(usdDto.lines.map((l) => l.kind)).toEqual(["TIME"]);

    const php = await create(f.acmeId);
    expect(await previewImport(db, owner, php.id, imp())).toMatchObject({
      expenses: 2,
      expenseMinor: 800,
    });
    const dto = await importIntoInvoice(db, owner, php.id, imp(), NOW);
    expect(
      dto.lines.map((l) => [
        l.kind,
        l.description,
        l.quantityCenti,
        l.unitPriceMinor,
        l.amountMinor,
      ]),
    ).toEqual([
      ["TIME", "Web", 150, 100_000, 150_000],
      ["EXPENSE", "Travel (2 expenses)", 200, null, 800],
    ]);
    const invoiceOf = async (id: string) =>
      (await db.select({ v: expense.invoiceId }).from(expense).where(eq(expense.id, id)))[0]?.v;
    expect(await invoiceOf(taxi.id)).toBe(php.id);
    expect(await invoiceOf(train.id)).toBe(php.id);
    expect(await invoiceOf(lunch.id)).toBeNull();
    expect(await invoiceOf(abroad.id)).toBeNull();

    // Removing the line frees them; by entry, one line per expense.
    const expenseLine = dto.lines.find((l) => l.kind === "EXPENSE")!;
    await removeLine(db, owner, php.id, expenseLine.id);
    expect(await invoiceOf(taxi.id)).toBeNull();
    const byEntry = await importIntoInvoice(db, owner, php.id, imp({ groupBy: "entry" }), NOW);
    expect(byEntry.lines.filter((l) => l.kind === "EXPENSE").map((l) => l.description)).toEqual([
      "2026-10-27 Bob Member: Travel — Taxi",
      "2026-10-27 Bob Member: Travel",
    ]);
    // Without expenses, nothing of theirs moves.
    const off = await previewImport(db, owner, php.id, imp({ expenses: false }));
    expect(off.expenses).toBe(0);
  });

  it("removing an imported line releases its entries", async () => {
    const inv = await create(f.acmeId);
    const dto = await importIntoInvoice(db, owner, inv.id, imp(), NOW);
    expect(await invoiceIdOf(bobId)).toBe(inv.id);
    const after = await removeLine(db, owner, inv.id, dto.lines[0]!.id);
    expect(after.lines).toEqual([]);
    expect(after.totalMinor).toBe(0);
    expect(await invoiceIdOf(bobId)).toBeNull();
  });

  it("refuses a sent invoice, another client's projects and a manager", async () => {
    const inv = await create(f.acmeId);
    await expect(
      importIntoInvoice(db, owner, inv.id, imp({ projectIds: [f.portalId] }), NOW),
    ).rejects.toThrow("Pick projects of the invoice's client.");
    await expect(
      importIntoInvoice(db, await f.viewer("max"), inv.id, imp(), NOW),
    ).rejects.toMatchObject({ status: 403 });
    await importIntoInvoice(db, owner, inv.id, imp(), NOW);
    await sendInvoice(db, owner, inv.id, { email: false, now: NOW });
    await expect(importIntoInvoice(db, owner, inv.id, imp(), NOW)).rejects.toThrow(
      "Only a draft can be changed.",
    );
    // A project filter narrows the import.
    const other = await create(f.acmeId);
    expect(await previewImport(db, owner, other.id, imp({ projectIds: [f.appId] }))).toMatchObject({
      entries: 0,
    });
  });
});
