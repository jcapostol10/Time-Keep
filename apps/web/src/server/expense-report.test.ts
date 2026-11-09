import { DEFAULT_REPORT_QUERY, type ReportQuery, type ViewerPrefs } from "@timekeep/core";
import { eq, managedUser, projectMember, workspaceSettings } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import { loadViewer } from "./authz";
import { createProject } from "./catalog/projects";
import type { Viewer } from "./catalog/viewer";
import { createExpenseCategory } from "./expense-categories";
import { expenseReport, expenseTotalsBy } from "./expense-report";
import { createExpense } from "./expenses";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

// Asia/Manila; "now" is Wednesday 28 Oct 12:00 local.
const NOW = new Date("2026-10-28T04:00:00.000Z");
const MANILA: ViewerPrefs = {
  timezone: "Asia/Manila",
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
const month = (over: Partial<ReportQuery> = {}): ReportQuery => ({
  ...DEFAULT_REPORT_QUERY,
  preset: "this-month",
  ...over,
});

let wsId: string;
let ids: Record<string, string>;
const viewer = (who: string): Promise<Viewer> => loadViewer(db, wsId, ids[who]!);

beforeEach(async () => {
  await truncateAll(db);
  const olga = await createTestUser(db, "Olga Owner");
  const max = await createTestUser(db, "Max Manager");
  const pat = await createTestUser(db, "Pat Projects");
  const bob = await createTestUser(db, "Bob Member");
  const carol = await createTestUser(db, "Carol Member");
  const ws = await createTestWorkspace(db, "Workspace", olga.id);
  wsId = ws.id;
  ids = { olga: olga.id, max: max.id, pat: pat.id, bob: bob.id, carol: carol.id };
  await addMember(db, wsId, max.id, "manager");
  await addMember(db, wsId, pat.id, "manager");
  await addMember(db, wsId, bob.id, "member");
  await addMember(db, wsId, carol.id, "member");
  await db.insert(managedUser).values({ workspaceId: wsId, managerId: max.id, userId: bob.id });
  await db
    .update(workspaceSettings)
    .set({ timezone: "Asia/Manila", currency: "PHP" })
    .where(eq(workspaceSettings.workspaceId, wsId));
  const owner = await viewer("olga");
  ids.web = (await createProject(db, owner, { name: "Web" })).id;
  ids.mobile = (await createProject(db, owner, { name: "Mobile" })).id;
  await db.insert(projectMember).values({ projectId: ids.mobile, userId: pat.id, isManager: true });
  const fixed = { unitName: null, unitPriceMinor: null };
  ids.travel = (
    await createExpenseCategory(db, owner, {
      name: "Travel",
      kind: "FIXED",
      ...fixed,
      billableDefault: true,
    })
  ).id;
  ids.meals = (
    await createExpenseCategory(db, owner, {
      name: "Meals",
      kind: "FIXED",
      ...fixed,
      billableDefault: false,
    })
  ).id;
  const spend = async (
    who: string,
    project: string,
    category: string,
    amountMinor: number,
    billable: boolean,
    date = "2026-10-20",
  ) =>
    createExpense(
      db,
      await viewer(who),
      {
        projectId: ids[project]!,
        categoryId: ids[category]!,
        date,
        amountMinor,
        billable,
        description: "",
      },
      { now: NOW },
    );
  //            project  category  amount   billable
  //   Olga     Web      Travel    ₱1,000   yes
  //   Bob      Web      Meals     ₱200     no
  //   Bob      Mobile   Travel    ₱300     yes
  //   Carol    Mobile   Meals     ₱50      no
  //   Carol    Web      Travel    ₱400     yes   (last month)
  await spend("olga", "web", "travel", 100_000, true);
  await spend("bob", "web", "meals", 20_000, false);
  await spend("bob", "mobile", "travel", 30_000, true);
  await spend("carol", "mobile", "meals", 5_000, false);
  await spend("carol", "web", "travel", 40_000, true, "2026-09-30");
});

/** The aggregate is unordered: rows by amount, largest first, for stable assertions. */
const rows = (m: Map<string | null, { label: string; totals: { amountMinor: number } }>) =>
  [...m.entries()]
    .sort(([, a], [, b]) => b.totals.amountMinor - a.totals.amountMinor)
    .map(([id, g]) => [id === null ? null : g.label, g.totals]);

describe("expenseTotalsBy", () => {
  it("totals by category, project and person, scoped", async () => {
    const owner = await viewer("olga");
    expect(rows(await expenseTotalsBy(db, owner, "category", month(), MANILA, NOW))).toEqual([
      ["Travel", { count: 2, amountMinor: 130_000, billableMinor: 130_000 }],
      ["Meals", { count: 2, amountMinor: 25_000, billableMinor: 0 }],
    ]);
    expect(rows(await expenseTotalsBy(db, owner, "project", month(), MANILA, NOW))).toEqual([
      ["Web", { count: 2, amountMinor: 120_000, billableMinor: 100_000 }],
      ["Mobile", { count: 2, amountMinor: 35_000, billableMinor: 30_000 }],
    ]);
    expect(rows(await expenseTotalsBy(db, owner, "user", month(), MANILA, NOW))).toEqual([
      ["Olga Owner", { count: 1, amountMinor: 100_000, billableMinor: 100_000 }],
      ["Bob Member", { count: 2, amountMinor: 50_000, billableMinor: 30_000 }],
      ["Carol Member", { count: 1, amountMinor: 5_000, billableMinor: 0 }],
    ]);
    // Max manages Bob: Bob's two. Pat manages Mobile: the two on it. Carol: her own.
    expect(
      rows(await expenseTotalsBy(db, await viewer("max"), "user", month(), MANILA, NOW)),
    ).toEqual([["Bob Member", { count: 2, amountMinor: 50_000, billableMinor: 30_000 }]]);
    expect(
      rows(await expenseTotalsBy(db, await viewer("pat"), "project", month(), MANILA, NOW)),
    ).toEqual([["Mobile", { count: 2, amountMinor: 35_000, billableMinor: 30_000 }]]);
    expect(
      rows(await expenseTotalsBy(db, await viewer("carol"), "category", month(), MANILA, NOW)),
    ).toEqual([["Meals", { count: 1, amountMinor: 5_000, billableMinor: 0 }]]);
  });

  it("the range is in the viewer's zone", async () => {
    // 1 Oct 02:00 Manila is 30 Sep 18:00 UTC: "this month" for a UTC viewer at that
    // instant is September, which holds Carol's ₱400; for a Manila viewer it is October.
    const at = new Date("2026-09-30T18:00:00.000Z");
    const owner = await viewer("olga");
    const utc = await expenseTotalsBy(
      db,
      owner,
      "category",
      month(),
      { ...MANILA, timezone: "UTC" },
      at,
    );
    expect(rows(utc)).toEqual([
      ["Travel", { count: 1, amountMinor: 40_000, billableMinor: 40_000 }],
    ]);
    const manila = await expenseTotalsBy(db, owner, "category", month(), MANILA, at);
    expect(rows(manila)).toEqual([
      ["Travel", { count: 2, amountMinor: 130_000, billableMinor: 130_000 }],
      ["Meals", { count: 2, amountMinor: 25_000, billableMinor: 0 }],
    ]);
  });

  it("categoryIds and billable filter", async () => {
    const owner = await viewer("olga");
    expect(
      rows(
        await expenseTotalsBy(
          db,
          owner,
          "project",
          month({ categoryIds: [ids.meals!] }),
          MANILA,
          NOW,
        ),
      ),
    ).toEqual([
      ["Web", { count: 1, amountMinor: 20_000, billableMinor: 0 }],
      ["Mobile", { count: 1, amountMinor: 5_000, billableMinor: 0 }],
    ]);
    expect(
      rows(await expenseTotalsBy(db, owner, "user", month({ billable: "yes" }), MANILA, NOW)),
    ).toEqual([
      ["Olga Owner", { count: 1, amountMinor: 100_000, billableMinor: 100_000 }],
      ["Bob Member", { count: 1, amountMinor: 30_000, billableMinor: 30_000 }],
    ]);
  });
});

describe("expenseReport", () => {
  it("groups by the query's expenseBy, sorted by amount, with the currency and totals", async () => {
    const report = await expenseReport(
      db,
      await viewer("olga"),
      month({ expenseBy: "user" }),
      MANILA,
      NOW,
    );
    expect(report.currency).toBe("PHP");
    expect(report.by).toBe("user");
    expect(report.range.label).toBe("This month");
    expect(report.groups.map((g) => [g.id, g.label, g.totals.amountMinor])).toEqual([
      [ids.olga, "Olga Owner", 100_000],
      [ids.bob, "Bob Member", 50_000],
      [ids.carol, "Carol Member", 5_000],
    ]);
    expect(report.totals).toEqual({ count: 4, amountMinor: 155_000, billableMinor: 130_000 });
    const empty = await expenseReport(
      db,
      await viewer("olga"),
      month({ preset: "today" }),
      MANILA,
      NOW,
    );
    expect(empty.groups).toEqual([]);
    expect(empty.totals).toEqual({ count: 0, amountMinor: 0, billableMinor: 0 });
  });
});
