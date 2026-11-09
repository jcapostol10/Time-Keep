import { randomUUID } from "node:crypto";

import {
  DEFAULT_REPORT_QUERY,
  marginPercent,
  type ReportQuery,
  type ViewerPrefs,
} from "@timekeep/core";
import { client, eq, managedUser, project, rate, workspaceSettings } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import { loadViewer } from "./authz";
import { createProject, getProjectStatus } from "./catalog/projects";
import { createTag } from "./catalog/tags";
import type { Viewer } from "./catalog/viewer";
import { dashboardMe, dashboardTeam } from "./dashboard";
import { createExpenseCategory } from "./expense-categories";
import { createExpense } from "./expenses";
import { buildExport } from "./report-files";
import { detailedReport, profitReport, summaryReport, weeklyReport } from "./reports";
import { setProjectEstimate } from "./budgets";
import { createShareLink, resolveShareLink } from "./share-links";
import { createManualEntry } from "./time-entries";

// Phase 6a: cost, profit and amounts per currency in the report engine. Money
// in two currencies is never added; profit covers the workspace currency only.

const handle = connectTestDb();
const db = handle.db;

const PREFS: ViewerPrefs = {
  timezone: "UTC",
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
const NOW = new Date("2026-03-11T12:00:00Z");
const q = (over: Partial<ReportQuery> = {}): ReportQuery => ({
  ...DEFAULT_REPORT_QUERY,
  preset: "custom",
  from: "2026-03-09T00:00:00.000Z",
  to: "2026-03-16T00:00:00.000Z",
  ...over,
});
const H = 3_600_000;

let wsId: string;
let ids: Record<string, string>;
const viewer = (who: string): Promise<Viewer> => loadViewer(db, wsId, ids[who]!);

async function entry(who: string, projectName: "web" | "us", hours: number, billable = true) {
  const start = new Date("2026-03-10T09:00:00Z");
  await createManualEntry(db, await viewer(who), {
    description: `${who} ${projectName} ${billable ? "billable" : "internal"}`,
    projectId: ids[projectName]!,
    taskId: null,
    tagIds: [],
    billable,
    start,
    end: new Date(start.getTime() + hours * H),
  });
}

async function addRate(over: Partial<typeof rate.$inferInsert> & { amountMinor: number }) {
  await db.insert(rate).values({
    id: randomUUID(),
    workspaceId: wsId,
    level: "workspace",
    currency: "PHP",
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    ...over,
  });
}

const setSettings = (patch: Partial<typeof workspaceSettings.$inferInsert>) =>
  db.update(workspaceSettings).set(patch).where(eq(workspaceSettings.workspaceId, wsId));

const csvHeader = (body: Uint8Array) => new TextDecoder().decode(body).split("\r\n")[0];

/**
 * A workspace in PHP at ₱1,000 an hour. Web has no client (PHP); Us belongs
 * to Acme, billed in USD at $40 an hour. Olga costs ₱600 an hour, Bob ₱300,
 * Carol has no cost rate. Max manages Bob.
 *
 *            project  hours  amount       cost
 *   Olga     Web      2      ₱2,000       ₱1,200
 *   Olga     Web      1      not billable ₱600
 *   Olga     Us       1      $40          ₱600
 *   Bob      Web      1      ₱1,000       ₱300
 *   Bob      Us       0.5    $20          ₱150
 *   Carol    Web      1      ₱1,000       no cost rate
 */
const ALL = {
  durationSeconds: 23_400,
  billableSeconds: 19_800,
  entryCount: 6,
  amountMinor: 400_000,
  otherAmounts: [{ currency: "USD", amountMinor: 6000 }],
  unratedCount: 0,
  costMinor: 285_000,
  uncostedCount: 1,
  // ₱4,000 billed in PHP less the ₱2,100 those hours cost; the USD hours are left out.
  profitMinor: 190_000,
  profitExcludedCount: 2,
  // Expenses join only in the Profit tab (Phase 6c).
  expenseMinor: 0,
  billableExpenseMinor: 0,
};
const NO_COSTS = { costMinor: 0, uncostedCount: 0, profitMinor: 0, profitExcludedCount: 0 };

afterAll(async () => handle.close());

describe("cost, profit and currencies in reports", () => {
  beforeAll(async () => truncateAll(db));

  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const max = await createTestUser(db, "Max Manager");
    const bob = await createTestUser(db, "Bob Member");
    const carol = await createTestUser(db, "Carol Member");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    wsId = ws.id;
    await addMember(db, ws.id, max.id, "manager");
    await addMember(db, ws.id, bob.id, "member");
    await addMember(db, ws.id, carol.id, "member");
    ids = { olga: olga.id, max: max.id, bob: bob.id, carol: carol.id };
    await db.insert(managedUser).values({ workspaceId: ws.id, managerId: max.id, userId: bob.id });
    await setSettings({ currency: "PHP" });

    const owner = await viewer("olga");
    ids.web = (await createProject(db, owner, { name: "Web" })).id;
    ids.us = (await createProject(db, owner, { name: "Us" })).id;
    const acme = randomUUID();
    await db.insert(client).values({ id: acme, workspaceId: ws.id, name: "Acme", currency: "USD" });
    await db.update(project).set({ clientId: acme }).where(eq(project.id, ids.us));

    await addRate({ amountMinor: 100_000 });
    await addRate({ level: "project", projectId: ids.us, currency: "USD", amountMinor: 4000 });
    await addRate({ kind: "cost", level: "member", userId: olga.id, amountMinor: 60_000 });
    await addRate({ kind: "cost", level: "member", userId: bob.id, amountMinor: 30_000 });

    await entry("olga", "web", 2);
    await entry("olga", "web", 1, false);
    await entry("olga", "us", 1);
    await entry("bob", "web", 1);
    await entry("bob", "us", 0.5);
    await entry("carol", "web", 1);
  });

  it("summary totals carry cost, profit and the uncosted count for an admin", async () => {
    const report = await summaryReport(
      db,
      await viewer("olga"),
      q({ groupBy: ["user"] }),
      PREFS,
      NOW,
    );
    expect(report.money).toEqual({ currency: "PHP", costs: true });
    expect(report.totals).toEqual(ALL);
    const byUser = Object.fromEntries(report.groups.map((g) => [g.label, g.totals]));
    expect(byUser["Olga Owner"]).toMatchObject({
      amountMinor: 200_000,
      otherAmounts: [{ currency: "USD", amountMinor: 4000 }],
      costMinor: 240_000,
      uncostedCount: 0,
      profitMinor: 20_000,
      profitExcludedCount: 1,
    });
    expect(byUser["Bob Member"]).toMatchObject({
      amountMinor: 100_000,
      otherAmounts: [{ currency: "USD", amountMinor: 2000 }],
      costMinor: 45_000,
      profitMinor: 70_000,
      profitExcludedCount: 1,
    });
    // No cost rate: the hour counts as free and is counted as uncosted.
    expect(byUser["Carol Member"]).toMatchObject({
      amountMinor: 100_000,
      otherAmounts: [],
      costMinor: 0,
      uncostedCount: 1,
      profitMinor: 100_000,
      profitExcludedCount: 0,
    });
  });

  it("amounts in USD stay out of amountMinor and land in otherAmounts", async () => {
    const report = await summaryReport(
      db,
      await viewer("olga"),
      q({ groupBy: ["project", "user"] }),
      PREFS,
      NOW,
    );
    const us = report.groups.find((g) => g.label === "Us");
    expect(us?.totals).toMatchObject({
      amountMinor: 0,
      otherAmounts: [{ currency: "USD", amountMinor: 6000 }],
      costMinor: 75_000,
    });
    expect(us?.children.map((c) => [c.label, c.totals.otherAmounts])).toEqual([
      ["Olga Owner", [{ currency: "USD", amountMinor: 4000 }]],
      ["Bob Member", [{ currency: "USD", amountMinor: 2000 }]],
    ]);
    const web = report.groups.find((g) => g.label === "Web");
    expect(web?.totals).toMatchObject({ amountMinor: 400_000, otherAmounts: [] });

    // The Detailed range totals and the Weekly grid split the same way.
    const page = await detailedReport(
      db,
      await viewer("olga"),
      q(),
      PREFS,
      { sort: "start", dir: "desc" },
      NOW,
    );
    expect(page.totals).toEqual(ALL);
    const weekly = await weeklyReport(
      db,
      await viewer("olga"),
      q({ preset: "this-week", weeklyBy: "user" }),
      PREFS,
      NOW,
    );
    expect(weekly).toMatchObject({
      amountMinor: 400_000,
      otherAmounts: [{ currency: "USD", amountMinor: 6000 }],
    });
    expect(weekly.rows.find((r) => r.label === "Olga Owner")).toMatchObject({
      total: 4 * 3600,
      amountMinor: 200_000,
      otherAmounts: [{ currency: "USD", amountMinor: 4000 }],
    });
  });

  it("profit leaves out entries billed in USD and counts them", async () => {
    const report = await summaryReport(
      db,
      await viewer("olga"),
      q({ groupBy: ["project"] }),
      PREFS,
      NOW,
    );
    const byProject = Object.fromEntries(report.groups.map((g) => [g.label, g.totals]));
    expect(byProject.Web).toMatchObject({
      costMinor: 210_000,
      profitMinor: 190_000,
      profitExcludedCount: 0,
    });
    // Its cost shows; its profit would need a conversion, so there is none.
    expect(byProject.Us).toMatchObject({
      costMinor: 75_000,
      profitMinor: 0,
      profitExcludedCount: 2,
    });

    // An hour on the USD project without any rate in USD is still that project's:
    // left out of profit, never a loss in PHP.
    await db.delete(rate).where(eq(rate.projectId, ids.us!));
    await entry("bob", "us", 1);
    const after = await summaryReport(db, await viewer("olga"), q(), PREFS, NOW);
    expect(after.totals).toMatchObject({
      unratedCount: 1,
      profitMinor: 190_000,
      profitExcludedCount: 3,
    });
  });

  it("a manager sees cost only when the setting is on, within their scope", async () => {
    const mine = { amountMinor: 100_000, otherAmounts: [{ currency: "USD", amountMinor: 2000 }] };
    const off = await summaryReport(db, await viewer("max"), q(), PREFS, NOW);
    expect(off.money).toEqual({ currency: "PHP", costs: false });
    expect(off.totals).toMatchObject({ ...mine, ...NO_COSTS });
    expect(off.groups.every((g) => g.totals.costMinor === 0 && g.totals.profitMinor === 0)).toBe(
      true,
    );

    await setSettings({ managersSeeCosts: true });
    const on = await summaryReport(db, await viewer("max"), q(), PREFS, NOW);
    expect(on.money).toEqual({ currency: "PHP", costs: true });
    // Bob's hours only: the people Max manages.
    expect(on.totals).toMatchObject({
      ...mine,
      costMinor: 45_000,
      uncostedCount: 0,
      profitMinor: 70_000,
      profitExcludedCount: 1,
    });
  });

  it("a member's cost, profit and uncosted count are 0 and money.costs is false", async () => {
    // Even with the manager setting on, and for a manager while it is off.
    await setSettings({ managersSeeCosts: true });
    const carol = await viewer("carol");
    const summary = await summaryReport(db, carol, q({ groupBy: ["project"] }), PREFS, NOW);
    expect(summary.money).toBeNull();
    expect(summary.totals).toMatchObject({ amountMinor: 0, otherAmounts: [], ...NO_COSTS });
    for (const g of summary.groups) {
      expect(g.totals).toMatchObject({ amountMinor: 0, otherAmounts: [], ...NO_COSTS });
    }

    const detailed = await detailedReport(
      db,
      carol,
      q(),
      PREFS,
      { sort: "start", dir: "desc" },
      NOW,
    );
    expect(detailed.money).toBeNull();
    expect(detailed.totals).toMatchObject({ amountMinor: 0, otherAmounts: [], ...NO_COSTS });
    expect(detailed.entries.length).toBe(1);
    for (const e of detailed.entries) {
      expect(e).toMatchObject({ currency: null, costMinor: null, profitMinor: null });
    }

    const weekly = await weeklyReport(db, carol, q({ preset: "this-week" }), PREFS, NOW);
    expect(weekly).toMatchObject({ money: null, amountMinor: 0, otherAmounts: [] });
    expect(weekly.rows.every((r) => r.amountMinor === 0 && r.otherAmounts.length === 0)).toBe(true);

    const file = await buildExport(db, carol, {
      report: "summary",
      query: q({ groupBy: ["project"] }),
      prefs: PREFS,
      format: "csv",
      now: NOW,
    });
    expect(csvHeader(file.body)).toBe("Project,Duration,Billable,Entries");

    await expect(profitReport(db, carol, q(), PREFS, NOW)).rejects.toMatchObject({ status: 403 });
    await setSettings({ managersSeeCosts: false });
    await expect(profitReport(db, await viewer("max"), q(), PREFS, NOW)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("puts cost and profit columns in exports only for those who see them", async () => {
    const header = async (who: string, report: "summary" | "detailed" | "weekly" | "profit") =>
      csvHeader(
        (
          await buildExport(db, await viewer(who), {
            report,
            query: q({
              groupBy: ["project"],
              preset: report === "weekly" ? "this-week" : "custom",
            }),
            prefs: PREFS,
            format: "csv",
            now: NOW,
          })
        ).body,
      );
    const summary = "Project,Duration,Billable,Entries,Amount (PHP),Amount (USD)";
    expect(await header("olga", "summary")).toBe(`${summary},Cost (PHP),Profit (PHP)`);
    expect(await header("max", "summary")).toBe(summary);
    expect(await header("olga", "profit")).toBe(
      `${summary},Cost (PHP),Profit (PHP),Expenses (PHP),Billable expenses (PHP),Margin %`,
    );
    const detailed =
      "Description,Type,Project,Client,Task,Person,Tags,Billable,Date,Start,End,Duration,Rate,Amount,Currency";
    expect(await header("olga", "detailed")).toBe(`${detailed},Cost (PHP),Profit (PHP)`);
    expect(await header("max", "detailed")).toBe(detailed);
    expect(await header("olga", "weekly")).toMatch(/,Total,Amount \(PHP\),Amount \(USD\)$/);

    // The rows carry the numbers: Web, then Us (sorted by time).
    const file = await buildExport(db, await viewer("olga"), {
      report: "summary",
      query: q({ groupBy: ["project"] }),
      prefs: PREFS,
      format: "csv",
      now: NOW,
    });
    const lines = new TextDecoder().decode(file.body).trim().split("\r\n");
    expect(lines.slice(1)).toEqual([
      "Web,5:00:00,4:00:00,4,4000.00,0.00,2100.00,1900.00",
      "Us,1:30:00,1:30:00,2,0.00,60.00,750.00,",
    ]);
  });

  it("a share link never carries cost, even from an owner", async () => {
    const owner = await viewer("olga");
    const made = await createShareLink(
      db,
      owner,
      { kind: "summary", query: q({ groupBy: ["project"] }), title: "Week", includeAmounts: true },
      PREFS,
      NOW,
    );
    const link = await resolveShareLink(db, made.token, NOW);
    if (!link) throw new Error("no link");
    const report = await summaryReport(db, link.viewer, link.query, PREFS, NOW);
    expect(report.money).toEqual({ currency: "PHP", costs: false });
    expect(report.totals).toMatchObject({
      amountMinor: 400_000,
      otherAmounts: [{ currency: "USD", amountMinor: 6000 }],
      ...NO_COSTS,
    });
    expect(report.groups.every((g) => g.totals.costMinor === 0 && g.totals.profitMinor === 0)).toBe(
      true,
    );
    const page = await detailedReport(
      db,
      link.viewer,
      link.query,
      PREFS,
      { sort: "start", dir: "desc" },
      NOW,
    );
    expect(page.entries.every((e) => e.costMinor === null && e.profitMinor === null)).toBe(true);
    await expect(profitReport(db, link.viewer, link.query, PREFS, NOW)).rejects.toMatchObject({
      status: 403,
    });
    // The file a reader of the link downloads: amounts per currency, no cost.
    const file = await buildExport(db, link.viewer, {
      report: "summary",
      query: link.query,
      prefs: PREFS,
      format: "csv",
      now: NOW,
    });
    expect(csvHeader(file.body)).toBe(
      "Project,Duration,Billable,Entries,Amount (PHP),Amount (USD)",
    );
  });

  it("a summary grouped by project carries progress; a share link does not", async () => {
    const owner = await viewer("olga");
    await setProjectEstimate(db, owner, ids.web!, {
      kind: "TIME",
      seconds: 36_000,
      minor: null,
      reset: "NONE",
      alerts: true,
    });
    const report = await summaryReport(db, owner, q({ groupBy: ["project"] }), PREFS, NOW);
    // Web has 5 hours of work (billable or not): 50% of 10.
    expect(report.progress).toEqual({
      [ids.web!]: expect.objectContaining({ kind: "TIME", used: 18_000, percent: 50 }),
    });
    const byUser = await summaryReport(db, owner, q({ groupBy: ["user"] }), PREFS, NOW);
    expect(byUser.progress).toBeNull();
    // A member sees no bar: the setting that shows the team's time is off.
    const member = await summaryReport(
      db,
      await viewer("carol"),
      q({ groupBy: ["project"] }),
      PREFS,
      NOW,
    );
    expect(member.progress).toBeNull();

    const made = await createShareLink(
      db,
      owner,
      { kind: "summary", query: q({ groupBy: ["project"] }), title: "Week", includeAmounts: true },
      PREFS,
      NOW,
    );
    const link = await resolveShareLink(db, made.token, NOW);
    if (!link) throw new Error("no link");
    expect((await summaryReport(db, link.viewer, link.query, PREFS, NOW)).progress).toBeNull();
  });

  it("detailed rows carry currency, cost and profit", async () => {
    const page = await detailedReport(
      db,
      await viewer("olga"),
      q(),
      PREFS,
      { sort: "start", dir: "desc" },
      NOW,
    );
    const rows = Object.fromEntries(
      page.entries.map((e) => [
        e.description,
        [e.currency, e.rateMinor, e.amountMinor, e.costMinor, e.profitMinor],
      ]),
    );
    expect(rows).toEqual({
      "olga web billable": ["PHP", 100_000, 200_000, 120_000, 80_000],
      // Not billable: nothing earned, the hour still cost ₱600.
      "olga web internal": ["PHP", 100_000, null, 60_000, -60_000],
      // Billed in USD: no profit without a conversion.
      "olga us billable": ["USD", 4000, 4000, 60_000, null],
      "bob web billable": ["PHP", 100_000, 100_000, 30_000, 70_000],
      "bob us billable": ["USD", 4000, 2000, 15_000, null],
      "carol web billable": ["PHP", 100_000, 100_000, null, 100_000],
    });
  });

  it("reports a rated amount in the currency it was rated in, whatever the client says now", async () => {
    // The client's currency moved without a relabel (data from before currencies
    // mattered, or a write that raced a relabel): $40 must never read as €40.
    await db.update(client).set({ currency: "EUR" }).where(eq(client.workspaceId, wsId));
    const owner = await viewer("olga");
    const summary = await summaryReport(db, owner, q({ groupBy: ["project"] }), PREFS, NOW);
    expect(summary.totals).toEqual(ALL);
    expect(summary.groups.find((g) => g.label === "Us")?.totals.otherAmounts).toEqual([
      { currency: "USD", amountMinor: 6000 },
    ]);
    const page = await detailedReport(
      db,
      owner,
      q({ description: "olga us" }),
      PREFS,
      { sort: "start", dir: "desc" },
      NOW,
    );
    expect(page.entries[0]).toMatchObject({ currency: "USD", amountMinor: 4000 });
    const weekly = await weeklyReport(db, owner, q({ preset: "this-week" }), PREFS, NOW);
    expect(weekly.otherAmounts).toEqual([{ currency: "USD", amountMinor: 6000 }]);

    // An hour with no amount has no currency of its own: it follows its project.
    await db.delete(rate).where(eq(rate.projectId, ids.us!));
    await entry("bob", "us", 1);
    const after = await summaryReport(db, owner, q(), PREFS, NOW);
    expect(after.totals).toMatchObject({ unratedCount: 1, profitExcludedCount: 3 });
  });

  it("keeps two currencies apart under a tag, and counts a two-tag entry once in the total", async () => {
    const a = await createTag(db, wsId, { name: "alpha" });
    const b = await createTag(db, wsId, { name: "beta" });
    const start = new Date("2026-03-11T09:00:00Z");
    await createManualEntry(db, await viewer("olga"), {
      description: "tagged",
      projectId: ids.us!,
      taskId: null,
      tagIds: [a.id, b.id],
      billable: true,
      start,
      end: new Date(start.getTime() + H),
    });
    const report = await summaryReport(
      db,
      await viewer("olga"),
      q({ groupBy: ["tag", "project"] }),
      PREFS,
      NOW,
    );
    const byTag = Object.fromEntries(report.groups.map((g) => [g.label, g.totals]));
    for (const name of ["alpha", "beta"]) {
      expect(byTag[name]).toMatchObject({
        amountMinor: 0,
        otherAmounts: [{ currency: "USD", amountMinor: 4000 }],
        costMinor: 60_000,
        profitExcludedCount: 1,
      });
    }
    expect(byTag["No tag"]).toMatchObject({
      amountMinor: 400_000,
      otherAmounts: [{ currency: "USD", amountMinor: 6000 }],
    });
    expect(report.totals).toMatchObject({
      amountMinor: 400_000,
      otherAmounts: [{ currency: "USD", amountMinor: 10_000 }],
      costMinor: 345_000,
    });
  });

  it("rounding applies to cost as to amount", async () => {
    await setSettings({ roundingMode: "up", roundingMinutes: 60 });
    const owner = await viewer("olga");
    const rounded = await summaryReport(db, owner, q(), PREFS, NOW);
    // Bob's half hour on Us counts as one: $40 and ₱300 in place of $20 and ₱150.
    expect(rounded.totals).toMatchObject({
      durationSeconds: 7 * 3600,
      otherAmounts: [{ currency: "USD", amountMinor: 8000 }],
      costMinor: 300_000,
      profitMinor: 190_000,
    });
    const page = await detailedReport(
      db,
      owner,
      q({ description: "bob us" }),
      PREFS,
      { sort: "start", dir: "desc" },
      NOW,
    );
    expect(page.entries[0]).toMatchObject({ amountMinor: 4000, costMinor: 30_000 });
    // Raw time on request.
    const raw = await summaryReport(db, owner, q({ rounding: "off" }), PREFS, NOW);
    expect(raw.totals).toEqual(ALL);
  });

  it("the profit report sorts groups by profit", async () => {
    const owner = await viewer("olga");
    const byUser = await profitReport(db, owner, q({ groupBy: ["user", "project"] }), PREFS, NOW);
    expect(byUser.groupBy).toEqual(["user"]);
    expect(byUser.groups.map((g) => [g.label, g.totals.profitMinor])).toEqual([
      ["Carol Member", 100_000],
      ["Bob Member", 70_000],
      ["Olga Owner", 20_000],
    ]);
    expect(byUser.totals).toEqual(ALL);
    // A key the tab does not offer falls back to projects.
    const fallback = await profitReport(db, owner, q({ groupBy: ["date"] }), PREFS, NOW);
    expect(fallback.groupBy).toEqual(["project"]);
    expect(fallback.groups.map((g) => g.label)).toEqual(["Web", "Us"]);
    const byClient = await profitReport(db, owner, q({ groupBy: ["client"] }), PREFS, NOW);
    expect(byClient.groups.map((g) => [g.label, g.totals.profitMinor])).toEqual([
      ["No client", 190_000],
      ["Acme", 0],
    ]);
  });

  it("the dashboard and the project Status tab list amounts per currency, never cost", async () => {
    const owner = await viewer("olga");
    const me = await dashboardMe(db, owner, q(), PREFS, NOW);
    expect(me.totals).toMatchObject({
      amountMinor: 200_000,
      otherAmounts: [{ currency: "USD", amountMinor: 4000 }],
      ...NO_COSTS,
    });
    const team = await dashboardTeam(db, owner, q(), PREFS, NOW);
    expect(team.find((m) => m.name === "Bob Member")).toMatchObject({
      amountMinor: 100_000,
      otherAmounts: [{ currency: "USD", amountMinor: 2000 }],
    });

    const range = { from: new Date(q().from!), to: new Date(q().to!) };
    const status = await getProjectStatus(db, owner, ids.us!, range, PREFS);
    expect(status).toMatchObject({
      money: { currency: "PHP", costs: true },
      amountMinor: 0,
      otherAmounts: [{ currency: "USD", amountMinor: 6000 }],
      costMinor: 75_000,
      profitMinor: 0,
      profitExcludedCount: 2,
    });
    expect(status.byMember.find((m) => m.name === "Olga Owner")).toMatchObject({
      amountMinor: 0,
      otherAmounts: [{ currency: "USD", amountMinor: 4000 }],
    });
    const web = await getProjectStatus(db, owner, ids.web!, range, PREFS);
    expect(web).toMatchObject({ amountMinor: 400_000, costMinor: 210_000, profitMinor: 190_000 });
    // A manager without the setting gets the amounts and no cost.
    const forMax = await getProjectStatus(db, await viewer("max"), ids.web!, range, PREFS);
    expect(forMax).toMatchObject({ amountMinor: 100_000, costMinor: 0, profitMinor: 0 });
  });
});

describe("expenses in the Profit tab (Phase 6c)", () => {
  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const bob = await createTestUser(db, "Bob Member");
    const carol = await createTestUser(db, "Carol Member");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    wsId = ws.id;
    await addMember(db, ws.id, bob.id, "member");
    await addMember(db, ws.id, carol.id, "member");
    ids = { olga: olga.id, bob: bob.id, carol: carol.id };
    await setSettings({ currency: "PHP", timezone: "UTC" });
    const owner = await viewer("olga");
    ids.web = (await createProject(db, owner, { name: "Web" })).id;
    ids.us = (await createProject(db, owner, { name: "Us" })).id;
    ids.ops = (await createProject(db, owner, { name: "Ops" })).id;
    const acme = randomUUID();
    await db.insert(client).values({ id: acme, workspaceId: ws.id, name: "Acme", currency: "USD" });
    await db.update(project).set({ clientId: acme }).where(eq(project.id, ids.us));
    await addRate({ amountMinor: 100_000 });
    await addRate({ level: "project", projectId: ids.us, currency: "USD", amountMinor: 4000 });
    await addRate({ kind: "cost", level: "member", userId: olga.id, amountMinor: 40_000 });
    // Olga: 1 h on Web (₱1,000, cost ₱400); 1 h on Us ($40, cost ₱400, left out of profit).
    await entry("olga", "web", 1);
    await entry("olga", "us", 1);
    const travel = await createExpenseCategory(db, owner, {
      name: "Travel",
      kind: "FIXED",
      unitName: null,
      unitPriceMinor: null,
      billableDefault: true,
    });
    const spend = (projectId: string, amountMinor: number, billable: boolean) =>
      createExpense(
        db,
        owner,
        {
          projectId,
          categoryId: travel.id,
          date: "2026-03-10",
          amountMinor,
          billable,
          description: "",
        },
        { now: NOW },
      );
    // Web: ₱300 billable, ₱200 not. Us: ₱200 not billable. Ops (no time): ₱150 billable.
    await spend(ids.web, 30_000, true);
    await spend(ids.web, 20_000, false);
    await spend(ids.us, 20_000, false);
    await spend(ids.ops, 15_000, true);
  });

  it("counts expenses: all as cost, billable ones as revenue, and its margin is over revenue", async () => {
    const report = await profitReport(db, await viewer("olga"), q(), PREFS, NOW);
    const web = report.groups.find((g) => g.label === "Web")!;
    // 1,000 + 300 − 400 − 500 = 400; margin 400 / 1,300.
    expect(web.totals).toMatchObject({
      amountMinor: 100_000,
      costMinor: 40_000,
      expenseMinor: 50_000,
      billableExpenseMinor: 30_000,
      profitMinor: 40_000,
    });
    expect(marginPercent(web.totals)).toBe(30.8);
    expect(report.totals).toMatchObject({
      expenseMinor: 85_000,
      billableExpenseMinor: 45_000,
      // Web 400 + Us −200 + Ops 0.
      profitMinor: 20_000,
    });
  });

  it("expenses on a project billed in USD still adjust that group's profit", async () => {
    const report = await profitReport(db, await viewer("olga"), q(), PREFS, NOW);
    const us = report.groups.find((g) => g.label === "Us")!;
    expect(us.totals).toMatchObject({
      amountMinor: 0,
      otherAmounts: [{ currency: "USD", amountMinor: 4000 }],
      profitExcludedCount: 1,
      expenseMinor: 20_000,
      billableExpenseMinor: 0,
      profitMinor: -20_000,
    });
  });

  it("a project with expenses and no time appears in the Profit tab", async () => {
    const report = await profitReport(db, await viewer("olga"), q(), PREFS, NOW);
    const ops = report.groups.find((g) => g.label === "Ops")!;
    expect(ops.totals).toMatchObject({
      durationSeconds: 0,
      entryCount: 0,
      expenseMinor: 15_000,
      billableExpenseMinor: 15_000,
      profitMinor: 0,
    });
    expect(ops.id).toBe(ids.ops);
    // Sorted by profit: Web (400), Ops (0), Us (−200).
    expect(report.groups.map((g) => g.label)).toEqual(["Web", "Ops", "Us"]);
    // By person the expenses follow their owner.
    const byUser = await profitReport(
      db,
      await viewer("olga"),
      q({ groupBy: ["user"] }),
      PREFS,
      NOW,
    );
    expect(byUser.groups.map((g) => [g.label, g.totals.expenseMinor])).toEqual([
      ["Olga Owner", 85_000],
    ]);
  });

  it("a task, tag or description filter leaves expenses out", async () => {
    for (const over of [{ description: "web" }, { tagIds: ["none"] }, { taskIds: ["none"] }]) {
      const report = await profitReport(db, await viewer("olga"), q(over), PREFS, NOW);
      expect(report.totals).toMatchObject({ expenseMinor: 0, billableExpenseMinor: 0 });
      expect(report.groups.find((g) => g.label === "Ops")).toBeUndefined();
    }
    // The Profit export prints the two expense columns.
    const file = await buildExport(db, await viewer("olga"), {
      report: "profit",
      format: "csv",
      query: q(),
      prefs: PREFS,
      now: NOW,
    });
    const lines = new TextDecoder().decode(file.body).split("\r\n");
    expect(lines[0]).toBe(
      "Project,Duration,Billable,Entries,Amount (PHP),Amount (USD),Cost (PHP),Profit (PHP),Expenses (PHP),Billable expenses (PHP),Margin %",
    );
    expect(lines[1]).toBe("Web,1:00:00,1:00:00,1,1000.00,0.00,400.00,400.00,500.00,300.00,30.8");
  });

  it("Summary and Detailed never carry expense totals", async () => {
    const summary = await summaryReport(db, await viewer("olga"), q(), PREFS, NOW);
    expect(summary.totals).toMatchObject({ expenseMinor: 0, billableExpenseMinor: 0 });
    for (const g of summary.groups) expect(g.totals.expenseMinor).toBe(0);
    const detailed = await detailedReport(
      db,
      await viewer("olga"),
      q(),
      PREFS,
      { sort: "start", dir: "desc", limit: 50 },
      NOW,
    );
    expect(detailed.totals).toMatchObject({ expenseMinor: 0, billableExpenseMinor: 0 });
  });
});
