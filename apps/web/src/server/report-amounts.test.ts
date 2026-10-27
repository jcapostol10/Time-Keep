import { randomUUID } from "node:crypto";

import { DEFAULT_REPORT_QUERY, type ReportQuery, type ViewerPrefs } from "@timekeep/core";
import { and, eq, managedUser, membership, rate } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
import { dashboardMe, dashboardTeam } from "./dashboard";
import { detailedReport, summaryReport, weeklyReport } from "./reports";
import { createShareLink, resolveShareLink } from "./share-links";
import { createManualEntry } from "./time-entries";

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

async function entry(who: string, hours: number, billable: boolean) {
  const start = new Date("2026-03-10T09:00:00Z");
  await createManualEntry(db, await viewer(who), {
    description: `${who} ${billable ? "billable" : "internal"}`,
    projectId: ids.web!,
    taskId: null,
    tagIds: [],
    billable,
    start,
    end: new Date(start.getTime() + hours * H),
  });
}

/**
 * At 50.00 an hour: Olga 2 h billable ($100) and 1 h not billable, Bob 1 h
 * billable ($50, managed by Max), Carol 1 h billable saved before any rate
 * existed (unrated).
 */
describe("amounts in reports", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

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
    ids.web = (await createProject(db, await viewer("olga"), { name: "Web" })).id;
    await entry("carol", 1, true);
    await db.insert(rate).values({
      id: randomUUID(),
      workspaceId: ws.id,
      level: "workspace",
      amountMinor: 5000,
      currency: "USD",
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });
    await entry("olga", 2, true);
    await entry("olga", 1, false);
    await entry("bob", 1, true);
  });

  it("sums billable entries' amounts and counts the unrated ones", async () => {
    const report = await summaryReport(
      db,
      await viewer("olga"),
      q({ groupBy: ["user"] }),
      PREFS,
      NOW,
    );
    expect(report.money).toEqual({ currency: "USD" });
    expect(report.totals).toMatchObject({ amountMinor: 15000, unratedCount: 1 });
    const byUser = Object.fromEntries(report.groups.map((g) => [g.label, g.totals.amountMinor]));
    expect(byUser).toEqual({ "Olga Owner": 10000, "Bob Member": 5000, "Carol Member": 0 });
  });

  it("shows a manager the amounts in their scope", async () => {
    const report = await summaryReport(db, await viewer("max"), q(), PREFS, NOW);
    expect(report.money).toEqual({ currency: "USD" });
    expect(report.totals.amountMinor).toBe(5000);
  });

  it("never shows a member an amount, anywhere", async () => {
    const bob = await viewer("bob");
    const summary = await summaryReport(db, bob, q(), PREFS, NOW);
    expect(summary.money).toBeNull();
    expect(summary.totals.amountMinor).toBe(0);
    expect(summary.groups.every((g) => g.totals.amountMinor === 0)).toBe(true);
    const detailed = await detailedReport(db, bob, q(), PREFS, { sort: "start", dir: "desc" }, NOW);
    expect(detailed.money).toBeNull();
    expect(detailed.entries.every((e) => e.amountMinor === null && e.rateMinor === null)).toBe(
      true,
    );
    const weekly = await weeklyReport(db, bob, q({ preset: "this-week" }), PREFS, NOW);
    expect(weekly.money).toBeNull();
    expect(weekly.amountMinor).toBe(0);
    const me = await dashboardMe(db, bob, q(), PREFS, NOW);
    expect(me.money).toBeNull();
    expect(me.totals.amountMinor).toBe(0);
  });

  it("carries each entry's rate and amount in the Detailed report", async () => {
    const page = await detailedReport(
      db,
      await viewer("olga"),
      q(),
      PREFS,
      { sort: "start", dir: "desc" },
      NOW,
    );
    const byDescription = Object.fromEntries(
      page.entries.map((e) => [e.description, [e.rateMinor, e.amountMinor]]),
    );
    expect(byDescription).toEqual({
      "olga billable": [5000, 10000],
      "olga internal": [5000, null],
      "bob billable": [5000, 5000],
      "carol billable": [null, null],
    });
    expect(page.totals).toMatchObject({ amountMinor: 15000, unratedCount: 1 });
  });

  it("gives each Weekly row and the week its amount", async () => {
    const weekly = await weeklyReport(
      db,
      await viewer("olga"),
      q({ preset: "this-week", weeklyBy: "user" }),
      PREFS,
      NOW,
    );
    expect(weekly.money).toEqual({ currency: "USD" });
    expect(weekly.amountMinor).toBe(15000);
    expect(weekly.rows.find((r) => r.label === "Olga Owner")?.amountMinor).toBe(10000);
  });

  it("shows amounts on the dashboard to those who may see them", async () => {
    const owner = await viewer("olga");
    const me = await dashboardMe(db, owner, q(), PREFS, NOW);
    expect(me.money).toEqual({ currency: "USD" });
    expect(me.totals.amountMinor).toBe(10000);
    const team = await dashboardTeam(db, owner, q(), PREFS, NOW);
    expect(team.find((m) => m.name === "Bob Member")?.amountMinor).toBe(5000);
  });

  it("puts amounts on a share link only when asked, and only while the creator may see them", async () => {
    const owner = await viewer("olga");
    const make = (includeAmounts: boolean) =>
      createShareLink(
        db,
        owner,
        { kind: "summary", query: q(), title: "Week", includeAmounts },
        PREFS,
        NOW,
      );
    const read = async (token: string) => {
      const link = await resolveShareLink(db, token, NOW);
      if (!link) throw new Error("no link");
      return summaryReport(db, link.viewer, link.query, PREFS, NOW);
    };
    const without = await make(false);
    expect((await read(without.token)).money).toBeNull();
    const withAmounts = await make(true);
    expect((await read(withAmounts.token)).money).toEqual({ currency: "USD" });

    await db
      .update(membership)
      .set({ role: "admin" })
      .where(and(eq(membership.workspaceId, wsId), eq(membership.userId, ids.max!)));
    await db
      .update(membership)
      .set({ role: "member" })
      .where(and(eq(membership.workspaceId, wsId), eq(membership.userId, ids.olga!)));
    expect((await read(withAmounts.token)).money).toBeNull();
  });
});
