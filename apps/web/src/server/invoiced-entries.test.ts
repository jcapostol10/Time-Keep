import { randomUUID } from "node:crypto";

import { DEFAULT_REPORT_QUERY, type ReportQuery, type ViewerPrefs } from "@timekeep/core";
import { eq, expense, invoice, rate, sql, timeEntry, workspaceSettings } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import { loadViewer, scopeForUser } from "./authz";
import { createClient, deleteClient, updateClient } from "./catalog/clients";
import { createProject, deleteProject, updateProject } from "./catalog/projects";
import type { Viewer } from "./catalog/viewer";
import { createExpenseCategory } from "./expense-categories";
import {
  createExpense,
  listExpenses,
  markExpensesInvoiced,
  releaseExpensesInvoiced,
  updateExpense,
} from "./expenses";
import { requestRateRecalc, runRateRecalcJob } from "./rate-recalc";
import { detailedReport } from "./reports";
import {
  bulkUpdateEntries,
  continueEntry,
  createManualEntry,
  deleteEntries,
  duplicateEntry,
  type EntryScope,
  listEntriesPage,
  markInvoiced,
  releaseInvoiced,
  splitEntry,
  startTimer,
  updateEntry,
} from "./time-entries";

/**
 * Phase 6d decision 23: time and expenses on an invoice are read-only for
 * everyone, the rate job skips them, and the reports badge and filter them.
 * The invoice rows are inserted directly: the service comes in Task 3.
 */

const handle = connectTestDb();
const handle2 = connectTestDb();
const db = handle.db;
afterAll(() => Promise.all([handle.close(), handle2.close()]));

// Asia/Manila; "now" is Wednesday 28 Oct 2026 12:00 local.
const NOW = new Date("2026-10-28T04:00:00.000Z");
const PREFS: ViewerPrefs = {
  timezone: "Asia/Manila",
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
const MON_9 = new Date("2026-10-27T01:00:00.000Z"); // Tue 27 Oct 09:00 Manila
const H = 3_600_000;
const INVOICED = "This entry is on invoice INV-0007.";

let wsId: string;
let ids: Record<string, string>;
let acmeId: string;
let webId: string;
let euroId: string;

const viewer = (who: string): Promise<Viewer> => loadViewer(db, wsId, ids[who]!);
const as = async (who: string, target = who): Promise<EntryScope> =>
  scopeForUser(db, await viewer(who), ids[target]!);

async function entry(
  who: string,
  over: { start?: Date; hours?: number; billable?: boolean; projectId?: string } = {},
) {
  const start = over.start ?? MON_9;
  return createManualEntry(
    db,
    await as(who),
    {
      description: "Work",
      projectId: over.projectId ?? webId,
      taskId: null,
      tagIds: [],
      billable: over.billable ?? true,
      start,
      end: new Date(start.getTime() + (over.hours ?? 1) * H),
    },
    NOW,
  );
}

async function invoiceRow(number = "INV-0007", status: "DRAFT" | "SENT" = "DRAFT") {
  const id = randomUUID();
  await db.insert(invoice).values({
    id,
    workspaceId: wsId,
    clientId: acmeId,
    number,
    issueDate: "2026-10-27",
    dueDate: "2026-11-26",
    currency: "USD",
    status,
    createdBy: ids.olga,
  });
  return id;
}

const invoiceOf = async (entryId: string) =>
  (await db.select({ v: timeEntry.invoiceId }).from(timeEntry).where(eq(timeEntry.id, entryId)))[0]
    ?.v;
const amountOf = async (entryId: string) =>
  (
    await db.select({ v: timeEntry.amountMinor }).from(timeEntry).where(eq(timeEntry.id, entryId))
  )[0]?.v;

async function detailed(who: string, query: Partial<ReportQuery>) {
  return detailedReport(
    db,
    await viewer(who),
    { ...DEFAULT_REPORT_QUERY, preset: "this-week", ...query },
    PREFS,
    { sort: "start", dir: "desc" },
    NOW,
  );
}

beforeEach(async () => {
  await truncateAll(db);
  const olga = await createTestUser(db, "Olga Owner");
  const ann = await createTestUser(db, "Ann Admin");
  const bob = await createTestUser(db, "Bob Member");
  const ws = await createTestWorkspace(db, "Workspace", olga.id);
  wsId = ws.id;
  ids = { olga: olga.id, ann: ann.id, bob: bob.id };
  await addMember(db, wsId, ann.id, "admin");
  await addMember(db, wsId, bob.id, "member");
  await db
    .update(workspaceSettings)
    .set({ timezone: "Asia/Manila", weekStart: 1, currency: "USD" })
    .where(eq(workspaceSettings.workspaceId, wsId));
  const blank = { address: "", email: "", notes: "" };
  acmeId = (await createClient(db, wsId, { name: "Acme", currency: null, ...blank })).id;
  const globexId = (await createClient(db, wsId, { name: "Globex", currency: "EUR", ...blank })).id;
  const owner = await viewer("olga");
  webId = (await createProject(db, owner, { name: "Web", clientId: acmeId })).id;
  euroId = (await createProject(db, owner, { name: "Euro", clientId: globexId })).id;
  // $50/h for everyone, since before any entry.
  await db.insert(rate).values({
    id: randomUUID(),
    workspaceId: wsId,
    level: "workspace",
    amountMinor: 5000,
    currency: "USD",
    effectiveFrom: new Date(0),
  });
});

describe("markInvoiced and releaseInvoiced", () => {
  it("takes only billable, rated, stopped, free entries and reports the count", async () => {
    const billable = await entry("bob");
    const unbillable = await entry("bob", {
      start: new Date(MON_9.getTime() + 2 * H),
      billable: false,
    });
    // A project billed in EUR has no USD rate: unrated.
    const unrated = await entry("bob", {
      start: new Date(MON_9.getTime() + 4 * H),
      projectId: euroId,
    });
    expect(await amountOf(unrated.id)).toBeNull();
    const { started: running } = await startTimer(
      db,
      await as("bob"),
      { description: "Now", projectId: webId, taskId: null, tagIds: [], billable: true },
      NOW,
    );
    const taken = await entry("bob", { start: new Date(MON_9.getTime() + 6 * H) });
    const other = await invoiceRow("INV-0006");
    expect(await markInvoiced(db, wsId, [taken.id], other)).toBe(1);

    const inv = await invoiceRow();
    const all = [billable.id, unbillable.id, unrated.id, running.id, taken.id];
    expect(await markInvoiced(db, wsId, all, inv)).toBe(1);
    expect(await invoiceOf(billable.id)).toBe(inv);
    expect(await invoiceOf(unbillable.id)).toBeNull();
    expect(await invoiceOf(unrated.id)).toBeNull();
    expect(await invoiceOf(running.id)).toBeNull();
    expect(await invoiceOf(taken.id)).toBe(other);
  });

  it("releaseInvoiced frees the given entries, or all of the invoice's", async () => {
    const a = await entry("bob");
    const b = await entry("bob", { start: new Date(MON_9.getTime() + 2 * H) });
    const inv = await invoiceRow();
    expect(await markInvoiced(db, wsId, [a.id, b.id], inv)).toBe(2);
    expect(await releaseInvoiced(db, wsId, inv, [a.id])).toBe(1);
    expect(await invoiceOf(a.id)).toBeNull();
    expect(await invoiceOf(b.id)).toBe(inv);
    expect(await releaseInvoiced(db, wsId, inv)).toBe(1);
    expect(await invoiceOf(b.id)).toBeNull();
    await expect(
      updateEntry(db, await as("bob"), b.id, { description: "Free" }, NOW),
    ).resolves.toMatchObject({ description: "Free" });
  });
});

describe("an invoiced entry", () => {
  it("is read-only for everyone, note or not", async () => {
    const e = await entry("bob");
    const inv = await invoiceRow();
    await markInvoiced(db, wsId, [e.id], inv);

    await expect(updateEntry(db, await as("bob"), e.id, { description: "x" }, NOW)).rejects.toThrow(
      INVOICED,
    );
    await expect(
      updateEntry(db, await as("ann", "bob"), e.id, { description: "x", note: "Fixing" }, NOW),
    ).rejects.toThrow(INVOICED);
    await expect(deleteEntries(db, await as("bob"), [e.id])).rejects.toThrow(INVOICED);
    await expect(
      bulkUpdateEntries(db, [{ scope: await as("bob"), ids: [e.id] }], { billable: false }, NOW),
    ).rejects.toThrow(INVOICED);
    await expect(
      splitEntry(db, await as("bob"), e.id, new Date(MON_9.getTime() + H / 2), NOW),
    ).rejects.toThrow(INVOICED);

    // New time is allowed: a copy and a continuation leave the source on its invoice.
    const copy = await duplicateEntry(db, await as("bob"), e.id);
    expect(copy.id).not.toBe(e.id);
    expect(await invoiceOf(copy.id)).toBeNull();
    expect(await invoiceOf(e.id)).toBe(inv);
    const { started } = await continueEntry(db, await as("bob"), e.id, NOW);
    expect(started.description).toBe("Work");

    for (const scope of [await as("bob"), await as("olga", "bob")]) {
      const page = await listEntriesPage(db, scope, { tz: PREFS.timezone, weekStart: 1, now: NOW });
      const row = page.entries.find((r) => r.id === e.id);
      expect(row).toMatchObject({ lockedReason: "On invoice INV-0007", invoiceNumber: "INV-0007" });
      expect(page.entries.find((r) => r.id === copy.id)).toMatchObject({
        lockedReason: null,
        invoiceNumber: null,
      });
    }
  });

  it("keeps its amount when the rate job re-rates the rest", async () => {
    const kept = await entry("bob");
    const rerated = await entry("bob", { start: new Date(MON_9.getTime() + 2 * H) });
    expect(await amountOf(kept.id)).toBe(5000);
    await markInvoiced(db, wsId, [kept.id], await invoiceRow());
    await db.insert(rate).values({
      id: randomUUID(),
      workspaceId: wsId,
      level: "workspace",
      amountMinor: 10000,
      currency: "USD",
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });
    const { jobId } = await requestRateRecalc(db, wsId, ids.olga!, new Date(0));
    await runRateRecalcJob(db, jobId);
    expect(await amountOf(kept.id)).toBe(5000);
    expect(await amountOf(rerated.id)).toBe(10000);
  });

  it("is badged and filtered in the Detailed report", async () => {
    const on = await entry("bob");
    const off = await entry("bob", { start: new Date(MON_9.getTime() + 2 * H) });
    await markInvoiced(db, wsId, [on.id], await invoiceRow());
    const yes = await detailed("olga", { invoiced: "yes" });
    expect(yes.entries.map((e) => e.id)).toEqual([on.id]);
    expect(yes.entries[0]).toMatchObject({
      invoiceNumber: "INV-0007",
      editable: false,
      timesEditable: false,
    });
    const no = await detailed("olga", { invoiced: "no" });
    expect(no.entries.map((e) => e.id)).toEqual([off.id]);
    expect(no.entries[0]).toMatchObject({ invoiceNumber: null, editable: true });
    expect((await detailed("olga", {})).entries).toHaveLength(2);
  });

  it("stops the project from being deleted", async () => {
    const e = await entry("bob");
    await markInvoiced(db, wsId, [e.id], await invoiceRow());
    await expect(
      deleteProject(db, await viewer("olga"), webId, { mode: "delete" }),
    ).rejects.toThrow("This project has invoiced time. Void the invoices first.");
  });
});

describe("an invoiced expense", () => {
  it("is read-only and filtered, until released", async () => {
    const owner = await viewer("olga");
    const travel = await createExpenseCategory(db, owner, {
      name: "Travel",
      kind: "FIXED",
      unitName: null,
      unitPriceMinor: null,
      billableDefault: true,
    });
    const input = {
      projectId: webId,
      categoryId: travel.id,
      date: "2026-10-27",
      amountMinor: 1000,
      billable: true,
      description: "",
    };
    const taxi = await createExpense(db, await as("bob"), input, { now: NOW });
    const unbillable = await createExpense(
      db,
      await as("bob"),
      { ...input, billable: false },
      { now: NOW },
    );
    const inv = await invoiceRow();
    expect(await markExpensesInvoiced(db, wsId, [taxi.id, unbillable.id], inv)).toBe(1);

    const message = "This expense is on invoice INV-0007.";
    await expect(
      updateExpense(db, await as("bob"), taxi.id, { description: "x" }, { now: NOW }),
    ).rejects.toThrow(message);
    await expect(
      updateExpense(
        db,
        await as("ann", "bob"),
        taxi.id,
        { description: "x", note: "Fixing" },
        { now: NOW },
      ),
    ).rejects.toThrow(message);

    const list = async (invoiced: ReportQuery["invoiced"]) =>
      (
        await listExpenses(
          db,
          owner,
          { ...DEFAULT_REPORT_QUERY, preset: "this-month", invoiced },
          PREFS,
          {},
          NOW,
        )
      ).expenses;
    expect(await list("yes")).toMatchObject([
      {
        id: taxi.id,
        invoiceNumber: "INV-0007",
        editable: false,
        lockedReason: "On invoice INV-0007",
      },
    ]);
    expect((await list("no")).map((e) => e.id)).toEqual([unbillable.id]);
    expect(await list("all")).toHaveLength(2);

    expect(await releaseExpensesInvoiced(db, wsId, inv)).toBe(1);
    await expect(
      updateExpense(db, await as("bob"), taxi.id, { description: "Free" }, { now: NOW }),
    ).resolves.toMatchObject({ description: "Free", invoiceNumber: null });
    expect(
      (await db.select({ v: expense.invoiceId }).from(expense).where(eq(expense.id, taxi.id)))[0]
        ?.v,
    ).toBeNull();
  });
});

describe("a client with invoices", () => {
  it("cannot change its currency", async () => {
    await invoiceRow();
    await expect(updateClient(db, wsId, acmeId, { currency: "EUR" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This client has invoices in USD; its currency cannot change.",
    });
    await expect(updateClient(db, wsId, acmeId, { name: "Acme Inc" })).resolves.toMatchObject({
      name: "Acme Inc",
    });
    // A currency it already has is no change.
    await expect(updateClient(db, wsId, acmeId, { currency: null })).resolves.toBeTruthy();
  });

  it("may change its currency once its only invoice is void", async () => {
    const inv = await invoiceRow("INV-0007", "SENT");
    await db.update(invoice).set({ status: "VOID" }).where(eq(invoice.id, inv));
    await expect(updateClient(db, wsId, acmeId, { currency: "EUR" })).resolves.toMatchObject({
      currency: "EUR",
    });
  });

  it("cannot be deleted while it has invoices, with a message", async () => {
    const lone = await createClient(db, wsId, {
      name: "Lone",
      address: "",
      email: "",
      notes: "",
      currency: null,
    });
    await db.insert(invoice).values({
      id: randomUUID(),
      workspaceId: wsId,
      clientId: lone.id,
      number: "INV-0099",
      issueDate: "2026-10-27",
      dueDate: "2026-11-26",
      currency: "USD",
    });
    await expect(deleteClient(db, wsId, lone.id)).rejects.toMatchObject({
      code: "IN_USE",
      message: "This client has invoices or recurring invoices. Void or delete them first.",
    });
  });
});

describe("a project with invoiced time", () => {
  it("cannot move to another client", async () => {
    const e = await entry("bob");
    await markInvoiced(db, wsId, [e.id], await invoiceRow());
    const other = await createClient(db, wsId, {
      name: "Other",
      address: "",
      email: "",
      notes: "",
      currency: null,
    });
    await expect(
      updateProject(db, await viewer("olga"), webId, { clientId: other.id }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message:
        "This project has invoiced time. Void its invoices before moving it to another client.",
    });
    await expect(
      updateProject(db, await viewer("olga"), webId, { name: "Web 2" }),
    ).resolves.toMatchObject({ name: "Web 2" });
  });
});

describe("an invoice and a concurrent write", () => {
  it("a write the guard let through finishes before an import takes the entry, which bills the new amount", async () => {
    const { importIntoInvoice } = await import("./invoices/import");
    const owner = await viewer("olga");
    const e = await entry("bob");
    const inv = await invoiceRow();
    // A writer mid-flight: it holds the row and has changed the hours, not yet committed.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const writer = handle2.db.transaction(async (tx) => {
      await tx.execute(sql`select id from time_entry where id = ${e.id} for update`);
      await tx
        .update(timeEntry)
        .set({
          end: new Date(MON_9.getTime() + 2 * H),
          durationSeconds: 7200,
          amountMinor: 10000,
        })
        .where(eq(timeEntry.id, e.id));
      await held;
    });
    await new Promise((r) => setTimeout(r, 200));
    const importing = importIntoInvoice(
      db,
      owner,
      inv,
      { from: "2026-10-26", to: "2026-11-01", projectIds: [], groupBy: "project", expenses: false },
      NOW,
    );
    await new Promise((r) => setTimeout(r, 300));
    release();
    await writer;
    const dto = await importing;
    expect(dto.lines.map((l) => l.amountMinor)).toEqual([10000]);
  });

  it("a delete waiting on an import's mark is refused once the entry is invoiced", async () => {
    const e = await entry("bob");
    const inv = await invoiceRow();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    // An import mid-flight: the entry is marked, not yet committed.
    const importer = handle2.db.transaction(async (tx) => {
      await tx.update(timeEntry).set({ invoiceId: inv }).where(eq(timeEntry.id, e.id));
      await held;
    });
    await new Promise((r) => setTimeout(r, 200));
    const deleting = deleteEntries(db, await as("bob"), [e.id]).then(
      () => "deleted",
      (error: Error) => error.message,
    );
    await new Promise((r) => setTimeout(r, 300));
    release();
    await importer;
    expect(await deleting).toBe(INVOICED);
    const [row] = await db
      .select({ deletedAt: timeEntry.deletedAt, invoiceId: timeEntry.invoiceId })
      .from(timeEntry)
      .where(eq(timeEntry.id, e.id));
    expect(row).toEqual({ deletedAt: null, invoiceId: inv });
  });
});
