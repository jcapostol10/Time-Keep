import { randomUUID } from "node:crypto";

import {
  DEFAULT_REPORT_QUERY,
  type ReportQuery,
  type ViewerPrefs,
  zonedDateTimeToInstant,
} from "@timekeep/core";
import {
  and,
  eq,
  managedGroup,
  managedUser,
  projectMember,
  userGroup,
  userGroupMember,
} from "@timekeep/db";
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
import { dashboardTeam } from "./dashboard";
import { detailedReport, reportFilterOptions, summaryReport, weeklyReport } from "./reports";
import { createShareLink, resolveShareLink } from "./share-links";
import { createManualEntry } from "./time-entries";

const handle = connectTestDb();
const db = handle.db;

const TZ = "Asia/Manila";
const NOW = new Date("2026-03-11T04:00:00.000Z");
const PREFS: ViewerPrefs = {
  timezone: TZ,
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
/** The week of Mon 2026-03-09 in Manila. */
const q = (over: Partial<ReportQuery> = {}): ReportQuery => ({
  ...DEFAULT_REPORT_QUERY,
  preset: "custom",
  from: "2026-03-08T16:00:00.000Z",
  to: "2026-03-15T16:00:00.000Z",
  ...over,
});
const H = 3600;

let ids: Record<string, string>;
let wsId: string;
const viewer = (who: string): Promise<Viewer> => loadViewer(db, wsId, ids[who]!);

async function entry(who: string, projectId: string, hours: number, day = "2026-03-10") {
  const start = zonedDateTimeToInstant({ date: day, hours: 9, minutes: 0 }, TZ);
  await createManualEntry(db, await viewer(who), {
    description: `${who} work`,
    projectId,
    taskId: null,
    tagIds: [],
    billable: true,
    start,
    end: new Date(start.getTime() + hours * H * 1000),
  });
}

/**
 * Max manages Bob directly, the Design group (Carol) and the Internal
 * project. Dana is nobody's: only her Web time exists, so she is out of scope.
 */
describe("a manager's scope", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const max = await createTestUser(db, "Max Manager");
    const bob = await createTestUser(db, "Bob Member");
    const carol = await createTestUser(db, "Carol Member");
    const dana = await createTestUser(db, "Dana Member");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    wsId = ws.id;
    await addMember(db, ws.id, max.id, "manager");
    for (const u of [bob, carol, dana]) await addMember(db, ws.id, u.id, "member");
    ids = { olga: olga.id, max: max.id, bob: bob.id, carol: carol.id, dana: dana.id };

    const owner = await viewer("olga");
    const web = await createProject(db, owner, { name: "Web" });
    const internal = await createProject(db, owner, { name: "Internal" });
    ids.web = web.id;
    ids.internal = internal.id;
    const design = randomUUID();
    ids.design = design;
    await db.insert(userGroup).values({ id: design, workspaceId: ws.id, name: "Design" });
    await db.insert(userGroupMember).values({ groupId: design, userId: carol.id });
    await db.insert(managedUser).values({ workspaceId: ws.id, managerId: max.id, userId: bob.id });
    await db
      .insert(managedGroup)
      .values({ workspaceId: ws.id, managerId: max.id, groupId: design });
    await db
      .insert(projectMember)
      .values({ projectId: internal.id, userId: max.id, isManager: true });

    await entry("olga", web.id, 1);
    await entry("olga", internal.id, 2);
    await entry("bob", web.id, 1);
    await entry("carol", web.id, 1);
    await entry("dana", web.id, 4);
    await entry("max", web.id, 0.5);
  });

  it("sums own time, managed people on any project, and anyone on managed projects", async () => {
    const max = await viewer("max");
    const report = await summaryReport(db, max, q({ groupBy: ["user"] }), PREFS, NOW);
    expect(report.totals.durationSeconds).toBe(4.5 * H);
    const byUser = Object.fromEntries(
      report.groups.map((g) => [g.label, g.totals.durationSeconds]),
    );
    expect(byUser).toEqual({
      "Max Manager": 0.5 * H,
      "Bob Member": 1 * H,
      "Carol Member": 1 * H,
      "Olga Owner": 2 * H,
    });
  });

  it("narrows, never widens, with a Users filter", async () => {
    const max = await viewer("max");
    const olga = await summaryReport(db, max, q({ userIds: [ids.olga!] }), PREFS, NOW);
    expect(olga.totals.durationSeconds).toBe(2 * H);
    const dana = await summaryReport(db, max, q({ userIds: [ids.dana!] }), PREFS, NOW);
    expect(dana.totals.durationSeconds).toBe(0);
  });

  it("offers only in-scope people in the Users filter", async () => {
    const options = await reportFilterOptions(db, await viewer("max"));
    expect(options.users?.map((u) => u.name).sort()).toEqual([
      "Bob Member",
      "Carol Member",
      "Max Manager",
      "Olga Owner",
    ]);
  });

  it("never lists an entry outside the scope in the Detailed report", async () => {
    const page = await detailedReport(
      db,
      await viewer("max"),
      q(),
      PREFS,
      { sort: "start", dir: "desc" },
      NOW,
    );
    expect(page.entries.map((e) => e.userName).sort()).toEqual([
      "Bob Member",
      "Carol Member",
      "Max Manager",
      "Olga Owner",
    ]);
    expect(page.totals?.durationSeconds).toBe(4.5 * H);
  });

  it("agrees between Weekly and Summary", async () => {
    const max = await viewer("max");
    const weekly = await weeklyReport(db, max, q({ preset: "this-week" }), PREFS, NOW);
    expect(weekly.total).toBe(4.5 * H);
  });

  it("shows the manager and the people they manage on the dashboard's Team tab", async () => {
    const team = await dashboardTeam(db, await viewer("max"), q(), PREFS, NOW);
    expect(team.map((m) => m.name).sort()).toEqual(["Bob Member", "Carol Member", "Max Manager"]);
  });

  it("reads a manager's share link with their scope today", async () => {
    const max = await viewer("max");
    const link = await createShareLink(
      db,
      max,
      { kind: "summary", query: q(), title: "Team" },
      PREFS,
      NOW,
    );
    const before = await resolveShareLink(db, link.token, NOW);
    if (!before) throw new Error("link did not resolve");
    expect(
      (await summaryReport(db, before.viewer, before.query, PREFS, NOW)).totals.durationSeconds,
    ).toBe(4.5 * H);

    await db
      .delete(userGroupMember)
      .where(and(eq(userGroupMember.groupId, ids.design!), eq(userGroupMember.userId, ids.carol!)));
    const after = await resolveShareLink(db, link.token, NOW);
    if (!after) throw new Error("link did not resolve");
    expect(
      (await summaryReport(db, after.viewer, after.query, PREFS, NOW)).totals.durationSeconds,
    ).toBe(3.5 * H);
  });

  it("filters by group the same as by the group's members", async () => {
    const owner = await viewer("olga");
    const byGroup = await summaryReport(db, owner, q({ groupIds: [ids.design!] }), PREFS, NOW);
    const byUser = await summaryReport(db, owner, q({ userIds: [ids.carol!] }), PREFS, NOW);
    expect(byGroup.totals).toEqual(byUser.totals);
    expect(byGroup.totals.durationSeconds).toBe(1 * H);
  });

  it("leaves a member with their own time only", async () => {
    const bob = await summaryReport(db, await viewer("bob"), q(), PREFS, NOW);
    expect(bob.totals.durationSeconds).toBe(1 * H);
  });

  it("gives a manager with no assignments their own time only", async () => {
    await db.delete(managedUser);
    await db.delete(managedGroup);
    await db.update(projectMember).set({ isManager: false });
    const max = await summaryReport(db, await viewer("max"), q(), PREFS, NOW);
    expect(max.totals.durationSeconds).toBe(0.5 * H);
  });
});
