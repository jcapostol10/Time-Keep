import { randomUUID } from "node:crypto";

import { DEFAULT_REPORT_QUERY, type ReportQuery, type ViewerPrefs } from "@timekeep/core";
import {
  and,
  approvalEvent,
  approvalRequest,
  eq,
  managedUser,
  projectMember,
  workspaceSettings,
} from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import { loadViewer, scopeForUser } from "./authz";
import { createProject, deleteProject, setProjectsArchived } from "./catalog/projects";
import type { Viewer } from "./catalog/viewer";
import { APPROVED_MESSAGE, PENDING_MESSAGE } from "./entry-guard";
import { createExpenseCategory, updateExpenseCategory } from "./expense-categories";
import { expenseLockedReasons } from "./expense-guard";
import {
  createExpense,
  deleteExpense,
  getExpense,
  listExpenses,
  restoreExpense,
  updateExpense,
} from "./expenses";
import type { EntryScope } from "./time-entries";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

// Asia/Manila, Monday weeks; "now" is Wednesday 28 Oct 12:00 local.
const NOW = new Date("2026-10-28T04:00:00.000Z");
const MANILA: ViewerPrefs = {
  timezone: "Asia/Manila",
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
const LAST_WEEK = { start: "2026-10-19", end: "2026-10-25" };
const NOTE = "Receipt arrived late";

let wsId: string;
let ids: Record<string, string>;
let webId: string;
let mobileId: string;
let travelId: string;
let mileageId: string;
const viewer = (who: string): Promise<Viewer> => loadViewer(db, wsId, ids[who]!);

async function setRules(patch: Partial<typeof workspaceSettings.$inferInsert>) {
  await db.update(workspaceSettings).set(patch).where(eq(workspaceSettings.workspaceId, wsId));
}

/** `who` writing `target`'s expenses (themselves by default). */
async function as(who: string, target = who): Promise<EntryScope> {
  return scopeForUser(db, await viewer(who), ids[target]!);
}

const fixed = (projectId: string, amountMinor: number, date: string, extra = {}) => ({
  projectId,
  categoryId: travelId,
  date,
  amountMinor,
  billable: true,
  description: "",
  ...extra,
});

async function submitted(userId: string, status: "PENDING" | "APPROVED" = "PENDING") {
  const id = randomUUID();
  await db.insert(approvalRequest).values({
    id,
    workspaceId: wsId,
    userId,
    periodStart: LAST_WEEK.start,
    periodEnd: LAST_WEEK.end,
    status,
  });
  return id;
}

async function list(who: string, query: Partial<ReportQuery> = {}, paging = {}) {
  return listExpenses(
    db,
    await viewer(who),
    { ...DEFAULT_REPORT_QUERY, preset: "this-month", ...query },
    MANILA,
    paging,
    NOW,
  );
}

beforeEach(async () => {
  await truncateAll(db);
  const olga = await createTestUser(db, "Olga Owner");
  const ann = await createTestUser(db, "Ann Admin");
  const max = await createTestUser(db, "Max Manager");
  const pat = await createTestUser(db, "Pat Projects");
  const bob = await createTestUser(db, "Bob Member");
  const carol = await createTestUser(db, "Carol Member");
  const ws = await createTestWorkspace(db, "Workspace", olga.id);
  wsId = ws.id;
  ids = { olga: olga.id, ann: ann.id, max: max.id, pat: pat.id, bob: bob.id, carol: carol.id };
  await addMember(db, wsId, ann.id, "admin");
  await addMember(db, wsId, max.id, "manager");
  await addMember(db, wsId, pat.id, "manager");
  await addMember(db, wsId, bob.id, "member");
  await addMember(db, wsId, carol.id, "member");
  await db.insert(managedUser).values({ workspaceId: wsId, managerId: max.id, userId: bob.id });
  await setRules({ timezone: "Asia/Manila", weekStart: 1, approvalEnabled: true });
  const owner = await viewer("olga");
  webId = (await createProject(db, owner, { name: "Web" })).id;
  mobileId = (await createProject(db, owner, { name: "Mobile" })).id;
  await db.insert(projectMember).values({ projectId: mobileId, userId: pat.id, isManager: true });
  const fields = { unitName: null, unitPriceMinor: null, billableDefault: true };
  travelId = (await createExpenseCategory(db, owner, { name: "Travel", kind: "FIXED", ...fields }))
    .id;
  mileageId = (
    await createExpenseCategory(db, owner, {
      name: "Mileage",
      kind: "UNIT",
      unitName: "km",
      unitPriceMinor: 1500,
      billableDefault: true,
    })
  ).id;
});

describe("createExpense and updateExpense", () => {
  it("a fixed expense stores the typed amount; a unit one snapshots the price", async () => {
    const bob = await as("bob");
    const taxi = await createExpense(db, bob, fixed(webId, 12550, "2026-10-27"), { now: NOW });
    expect(taxi).toMatchObject({
      amountMinor: 12550,
      quantityCenti: null,
      unitPriceMinor: null,
      categoryName: "Travel",
      projectName: "Web",
      userName: "Bob Member",
      date: "2026-10-27",
      billable: true,
      editable: true,
      lockedReason: null,
      receipt: null,
    });
    const trip = await createExpense(
      db,
      bob,
      {
        projectId: webId,
        categoryId: mileageId,
        date: "2026-10-27",
        quantityCenti: 1250,
        billable: true,
        description: "Client visit",
      },
      { now: NOW },
    );
    expect(trip).toMatchObject({ amountMinor: 18750, quantityCenti: 1250, unitPriceMinor: 1500 });
    // A price change leaves saved expenses alone.
    await updateExpenseCategory(db, await viewer("olga"), mileageId, { unitPriceMinor: 2000 });
    expect((await getExpense(db, bob, trip.id)).amountMinor).toBe(18750);
    // A quantity edit recomputes with the stored price.
    const edited = await updateExpense(db, bob, trip.id, { quantityCenti: 1000 }, { now: NOW });
    expect(edited).toMatchObject({ amountMinor: 15000, unitPriceMinor: 1500 });
    // A category change re-snapshots.
    const moved = await updateExpense(
      db,
      bob,
      taxi.id,
      { categoryId: mileageId, quantityCenti: 100 },
      {
        now: NOW,
      },
    );
    expect(moved).toMatchObject({
      amountMinor: 2000,
      unitPriceMinor: 2000,
      categoryName: "Mileage",
    });
  });

  it("a fixed category needs an amount and a unit one a quantity", async () => {
    const bob = await as("bob");
    await expect(
      createExpense(
        db,
        bob,
        { ...fixed(webId, 1, "2026-10-27"), amountMinor: undefined },
        { now: NOW },
      ),
    ).rejects.toMatchObject({ code: "INVALID", message: "Enter an amount." });
    await expect(
      createExpense(
        db,
        bob,
        {
          projectId: webId,
          categoryId: mileageId,
          date: "2026-10-27",
          billable: true,
          description: "",
        },
        { now: NOW },
      ),
    ).rejects.toMatchObject({ code: "INVALID", message: "Enter a quantity." });
  });

  it("an amount is never zero: a free unit price or a tiny quantity is refused", async () => {
    const owner = await viewer("olga");
    const free = await createExpenseCategory(db, owner, {
      name: "Free km",
      kind: "UNIT",
      unitName: "km",
      unitPriceMinor: 0,
      billableDefault: true,
    });
    const bob = await as("bob");
    const unit = (categoryId: string, quantityCenti: number) => ({
      projectId: webId,
      categoryId,
      date: "2026-10-27",
      quantityCenti,
      billable: true,
      description: "",
    });
    await expect(createExpense(db, bob, unit(free.id, 100), { now: NOW })).rejects.toMatchObject({
      code: "INVALID",
      message: "Enter an amount.",
    });
    // 1 centi × 1500 minor / 100 = 15: fine. 1 centi × 1 minor / 100 rounds to 0: refused.
    const penny = await createExpenseCategory(db, owner, {
      name: "Penny",
      kind: "UNIT",
      unitName: "u",
      unitPriceMinor: 1,
      billableDefault: true,
    });
    await expect(createExpense(db, bob, unit(penny.id, 1), { now: NOW })).rejects.toMatchObject({
      code: "INVALID",
    });
    await expect(createExpense(db, bob, unit(mileageId, 1), { now: NOW })).resolves.toMatchObject({
      amountMinor: 15,
    });
  });

  it("a category's kind cannot change once it has expenses", async () => {
    const owner = await viewer("olga");
    await createExpense(db, await as("bob"), fixed(webId, 100, "2026-10-27"), { now: NOW });
    await expect(
      updateExpenseCategory(db, owner, travelId, {
        kind: "UNIT",
        unitName: "km",
        unitPriceMinor: 100,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This category has expenses; its kind cannot change.",
    });
    // The name and the default still can; and a category without expenses changes freely.
    await expect(
      updateExpenseCategory(db, owner, travelId, { name: "Trips", billableDefault: false }),
    ).resolves.toMatchObject({ name: "Trips", kind: "FIXED" });
    await expect(
      updateExpenseCategory(db, owner, mileageId, { kind: "FIXED" }),
    ).resolves.toMatchObject({ kind: "FIXED", unitName: null, unitPriceMinor: null });
  });

  it("a member records only their own; a manager for their people", async () => {
    await expect(as("bob", "carol")).rejects.toMatchObject({ status: 404 });
    await expect(as("max", "carol")).rejects.toMatchObject({ status: 404 });
    const forBob = await as("max", "bob");
    const created = await createExpense(db, forBob, fixed(webId, 500, "2026-10-27"), { now: NOW });
    expect(created.userId).toBe(ids.bob);
    const [row] = await db.query.expense.findMany({
      where: (e, { eq: is }) => is(e.id, created.id),
    });
    expect(row?.createdBy).toBe(ids.max);
  });

  it("an archived project or category takes no new expense", async () => {
    const owner = await viewer("olga");
    await setProjectsArchived(db, owner, [mobileId], true);
    await expect(
      createExpense(db, await as("bob"), fixed(mobileId, 500, "2026-10-27"), { now: NOW }),
    ).rejects.toMatchObject({ code: "INVALID", message: "This project is not available." });
    await updateExpenseCategory(db, owner, travelId, { archived: true });
    await expect(
      createExpense(db, await as("bob"), fixed(webId, 500, "2026-10-27"), { now: NOW }),
    ).rejects.toMatchObject({ code: "INVALID", message: "This category is archived." });
    // A private project the person is not on is not available either.
    const secret = await createProject(db, owner, { name: "Secret", visibility: "PRIVATE" });
    await expect(
      createExpense(
        db,
        await as("bob"),
        { ...fixed(secret.id, 500, "2026-10-27"), categoryId: mileageId, quantityCenti: 100 },
        { now: NOW },
      ),
    ).rejects.toMatchObject({ code: "INVALID", message: "This project is not available." });
  });
});

describe("listExpenses", () => {
  it("filters by date keys in the viewer's zone, person, project, category and billable, and pages by keyset", async () => {
    const bob = await as("bob");
    const carol = await as("carol");
    await createExpense(db, bob, fixed(webId, 100, "2026-10-01"), { now: NOW });
    await createExpense(db, bob, fixed(webId, 200, "2026-10-15", { billable: false }), {
      now: NOW,
    });
    await createExpense(db, bob, fixed(mobileId, 300, "2026-10-31"), { now: NOW });
    await createExpense(db, carol, fixed(webId, 400, "2026-10-21"), { now: NOW });
    await createExpense(
      db,
      bob,
      {
        projectId: webId,
        categoryId: mileageId,
        date: "2026-10-20",
        quantityCenti: 100,
        billable: true,
        description: "",
      },
      { now: NOW },
    );
    // Outside this month, in both zones.
    await createExpense(db, bob, fixed(webId, 999, "2026-09-30"), { now: NOW });
    await createExpense(db, bob, fixed(webId, 999, "2026-11-01"), { now: NOW });

    const all = await list("olga");
    expect(all.expenses.map((e) => e.amountMinor)).toEqual([300, 400, 1500, 200, 100]);
    expect(all.totals).toEqual({ count: 5, amountMinor: 2500, billableMinor: 2300 });
    expect(all.currency).toBe("USD");
    expect(all.nextCursor).toBeNull();

    expect((await list("olga", { userIds: [ids.carol!] })).totals.count).toBe(1);
    expect((await list("olga", { projectIds: [mobileId] })).totals.amountMinor).toBe(300);
    expect((await list("olga", { categoryIds: [mileageId] })).totals.amountMinor).toBe(1500);
    expect((await list("olga", { billable: "no" })).totals.amountMinor).toBe(200);

    // UTC viewer: 31 Oct 00:00 Manila is still 30 Oct in UTC, but the keys are local dates,
    // so the month in UTC runs over the same date keys; "today" differs by zone though.
    const utc = await listExpenses(
      db,
      await viewer("olga"),
      { ...DEFAULT_REPORT_QUERY, preset: "today" },
      { ...MANILA, timezone: "UTC" },
      {},
      new Date("2026-10-30T20:00:00.000Z"), // 31 Oct 04:00 Manila, 30 Oct UTC
    );
    expect(utc.totals.count).toBe(0);
    const manila = await list("olga", { preset: "today" }, {});
    expect(manila.totals.count).toBe(0); // 28 Oct: nothing
    const manilaLast = await listExpenses(
      db,
      await viewer("olga"),
      { ...DEFAULT_REPORT_QUERY, preset: "today" },
      MANILA,
      {},
      new Date("2026-10-30T20:00:00.000Z"),
    );
    expect(manilaLast.totals.amountMinor).toBe(300);

    // Keyset paging: newest first, totals only on the first page.
    const first = await list("olga", {}, { limit: 2 });
    expect(first.expenses.map((e) => e.amountMinor)).toEqual([300, 400]);
    expect(first.totals.count).toBe(5);
    expect(first.nextCursor).not.toBeNull();
    const second = await list("olga", {}, { limit: 2, cursor: first.nextCursor! });
    expect(second.expenses.map((e) => e.amountMinor)).toEqual([1500, 200]);
    expect(second.totals).toEqual({ count: 0, amountMinor: 0, billableMinor: 0 });
    const third = await list("olga", {}, { limit: 2, cursor: second.nextCursor! });
    expect(third.expenses.map((e) => e.amountMinor)).toEqual([100]);
    expect(third.nextCursor).toBeNull();
  });

  it("a member sees own expenses only, even when the team's time is shown", async () => {
    await createExpense(db, await as("bob"), fixed(webId, 100, "2026-10-27"), { now: NOW });
    const carols = await createExpense(db, await as("carol"), fixed(webId, 200, "2026-10-27"), {
      now: NOW,
    });
    const mine = await list("bob", { userIds: [ids.carol!] });
    expect(mine.expenses.map((e) => e.amountMinor)).toEqual([100]);
    expect(mine.expenses[0]?.editable).toBe(true);
    // The spec's access table: a member reads no colleague's expense; the setting is about time.
    await setRules({ membersSeeTeamTime: true });
    const still = await list("bob");
    expect(still.expenses.map((e) => e.amountMinor)).toEqual([100]);
    await expect(getExpense(db, await viewer("bob"), carols.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("a manager's list is their people and their projects", async () => {
    await createExpense(db, await as("bob"), fixed(webId, 100, "2026-10-27"), { now: NOW });
    await createExpense(db, await as("carol"), fixed(mobileId, 200, "2026-10-27"), { now: NOW });
    await createExpense(db, await as("carol"), fixed(webId, 300, "2026-10-27"), { now: NOW });
    await createExpense(db, await as("max"), fixed(webId, 400, "2026-10-27"), { now: NOW });
    // Max manages Bob: Bob's and his own.
    expect((await list("max")).expenses.map((e) => e.amountMinor).sort()).toEqual([100, 400]);
    // Pat manages Mobile: Carol's expense on Mobile, read-only.
    const pat = await list("pat");
    expect(pat.expenses.map((e) => e.amountMinor)).toEqual([200]);
    expect(pat.expenses[0]?.editable).toBe(false);
    // A filter outside the scope narrows to nothing, never widens.
    expect((await list("max", { userIds: [ids.carol!] })).totals.count).toBe(0);
  });

  it("deleting a project refuses while it has live expenses, and purges deleted ones", async () => {
    const owner = await viewer("olga");
    const bob = await as("bob");
    const e = await createExpense(db, bob, fixed(mobileId, 100, "2026-10-27"), { now: NOW });
    await expect(
      deleteProject(db, owner, mobileId, { mode: "reassign", projectId: webId }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This project has 1 expense. Move or delete it first.",
    });
    await deleteExpense(db, bob, e.id, { now: NOW });
    await deleteProject(db, owner, mobileId, { mode: "reassign", projectId: webId });
    expect(await db.query.expense.findMany({ where: (x, { eq: is }) => is(x.id, e.id) })).toEqual(
      [],
    );
  });

  it("deleted expenses leave the list and come back on restore", async () => {
    const bob = await as("bob");
    const e = await createExpense(db, bob, fixed(webId, 100, "2026-10-27"), { now: NOW });
    await deleteExpense(db, bob, e.id, { now: NOW });
    expect((await list("bob")).totals.count).toBe(0);
    await expect(getExpense(db, await viewer("bob"), e.id)).rejects.toMatchObject({ status: 404 });
    await restoreExpense(db, bob, e.id, { now: NOW });
    expect((await list("bob")).totals.count).toBe(1);
  });
});

describe("the guard", () => {
  it("a pending period refuses the owner and their manager, asks an admin for a note and logs an ADMIN_EDIT with the expense id", async () => {
    const e = await createExpense(db, await as("bob"), fixed(webId, 100, "2026-10-20"), {
      now: NOW,
    });
    await submitted(ids.bob!);
    await expect(
      updateExpense(db, await as("bob"), e.id, { amountMinor: 200 }, { now: NOW }),
    ).rejects.toThrow(PENDING_MESSAGE);
    await expect(
      updateExpense(db, await as("max", "bob"), e.id, { amountMinor: 200 }, { now: NOW }),
    ).rejects.toThrow(PENDING_MESSAGE);
    await expect(
      createExpense(db, await as("bob"), fixed(webId, 100, "2026-10-21"), { now: NOW }),
    ).rejects.toThrow(PENDING_MESSAGE);
    await expect(deleteExpense(db, await as("bob"), e.id, { now: NOW })).rejects.toThrow(
      PENDING_MESSAGE,
    );
    const ann = await as("ann", "bob");
    await expect(
      updateExpense(db, ann, e.id, { amountMinor: 200 }, { now: NOW }),
    ).rejects.toMatchObject({ code: "NOTE_REQUIRED" });
    const edited = await updateExpense(
      db,
      ann,
      e.id,
      { amountMinor: 200 },
      { now: NOW, note: NOTE },
    );
    expect(edited.amountMinor).toBe(200);
    const logged = await db
      .select()
      .from(approvalEvent)
      .where(and(eq(approvalEvent.workspaceId, wsId), eq(approvalEvent.action, "ADMIN_EDIT")));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      expenseId: e.id,
      entryId: null,
      userId: ids.bob,
      actorId: ids.ann,
      note: NOTE,
      changes: { amountMinor: { from: 100, to: 200 } },
    });
    // Moving an open expense into the period is guarded by its date after the change.
    const open = await createExpense(db, await as("bob"), fixed(webId, 100, "2026-10-27"), {
      now: NOW,
    });
    await expect(
      updateExpense(db, await as("bob"), open.id, { date: "2026-10-22" }, { now: NOW }),
    ).rejects.toThrow(PENDING_MESSAGE);
  });

  it("an approved period stays read-only after approval is turned off", async () => {
    const e = await createExpense(db, await as("bob"), fixed(webId, 100, "2026-10-20"), {
      now: NOW,
    });
    await submitted(ids.bob!, "APPROVED");
    await setRules({ approvalEnabled: false });
    await expect(
      updateExpense(db, await as("bob"), e.id, { amountMinor: 200 }, { now: NOW }),
    ).rejects.toThrow(APPROVED_MESSAGE);
    await expect(
      createExpense(db, await as("bob"), fixed(webId, 100, "2026-10-22"), { now: NOW }),
    ).rejects.toThrow(APPROVED_MESSAGE);
  });

  it("a rolling lock refuses a member's expense before the lock date, not an admin's", async () => {
    const e = await createExpense(db, await as("bob"), fixed(webId, 100, "2026-10-20"), {
      now: NOW,
    });
    await setRules({ lockMode: "ROLLING", lockDays: 7 });
    for (const who of ["bob", "max"]) {
      await expect(
        updateExpense(db, await as(who, "bob"), e.id, { amountMinor: 200 }, { now: NOW }),
      ).rejects.toThrow("Expenses before 21 Oct 2026 are locked.");
    }
    await expect(
      createExpense(db, await as("bob"), fixed(webId, 100, "2026-10-20"), { now: NOW }),
    ).rejects.toThrow("Expenses before 21 Oct 2026 are locked.");
    await expect(
      updateExpense(db, await as("ann", "bob"), e.id, { amountMinor: 200 }, { now: NOW }),
    ).resolves.toMatchObject({ amountMinor: 200 });
    // The day of the lock date itself is open.
    await expect(
      createExpense(db, await as("bob"), fixed(webId, 100, "2026-10-21"), { now: NOW }),
    ).resolves.toBeDefined();
  });

  it("expenseLockedReasons names the pending period and the lock", async () => {
    const inPeriod = await createExpense(db, await as("bob"), fixed(webId, 100, "2026-10-20"), {
      now: NOW,
    });
    const open = await createExpense(db, await as("bob"), fixed(webId, 100, "2026-10-27"), {
      now: NOW,
    });
    await submitted(ids.bob!);
    const reasons = await expenseLockedReasons(
      db,
      await as("bob"),
      [
        { id: inPeriod.id, date: "2026-10-20" },
        { id: open.id, date: "2026-10-27" },
      ],
      NOW,
    );
    expect(reasons.get(inPeriod.id)).toBe(PENDING_MESSAGE);
    expect(reasons.has(open.id)).toBe(false);
    const listed = await list("bob");
    expect(listed.expenses.find((e) => e.id === inPeriod.id)).toMatchObject({
      editable: true,
      lockedReason: PENDING_MESSAGE,
    });
    // An admin reads none.
    expect(
      (
        await expenseLockedReasons(
          db,
          await as("ann", "bob"),
          [{ id: inPeriod.id, date: "2026-10-20" }],
          NOW,
        )
      ).size,
    ).toBe(0);
  });
});
