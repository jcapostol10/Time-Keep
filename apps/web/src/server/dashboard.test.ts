import { DEFAULT_REPORT_QUERY, type ReportQuery, type ViewerPrefs } from "@timekeep/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
  asViewer,
} from "../../test/db";
import { createClient } from "./catalog/clients";
import { createProject } from "./catalog/projects";
import type { Viewer } from "./catalog/viewer";
import { dashboardMe, dashboardTeam } from "./dashboard";
import { summaryReport } from "./reports";
import { createManualEntry, type EntryScope, startTimer } from "./time-entries";

const handle = connectTestDb();
const db = handle.db;

const PREFS: ViewerPrefs = {
  timezone: "Asia/Manila",
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
/** Wed 2026-03-11 12:00 Manila: "this week" is Mar 9–15. */
const NOW = new Date("2026-03-11T04:00:00.000Z");
const QUERY: ReportQuery = { ...DEFAULT_REPORT_QUERY, preset: "this-week" };

let alice: Viewer; // owner
let bob: Viewer; // member
let carol: Viewer; // member, no time

async function entry(
  scope: EntryScope,
  description: string,
  projectId: string | null,
  startIso: string,
  minutes: number,
) {
  const start = new Date(startIso);
  return createManualEntry(db, scope, {
    description,
    projectId,
    taskId: null,
    tagIds: [],
    billable: projectId !== null,
    start,
    end: new Date(start.getTime() + minutes * 60_000),
  });
}

describe("dashboard", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const a = await createTestUser(db, "Alice A");
    const b = await createTestUser(db, "Bob B");
    const c = await createTestUser(db, "Carol C");
    const ws = await createTestWorkspace(db, "Workspace A", a.id);
    await addMember(db, ws.id, b.id, "member");
    await addMember(db, ws.id, c.id, "member");
    alice = asViewer({ workspaceId: ws.id, userId: a.id, role: "owner" });
    bob = asViewer({ workspaceId: ws.id, userId: b.id, role: "member" });
    carol = asViewer({ workspaceId: ws.id, userId: c.id, role: "member" });
    const blank = { address: "", email: "", notes: "", currency: null };
    const acme = await createClient(db, ws.id, { name: "Acme", ...blank });
    const web = await createProject(db, alice, { name: "Web", clientId: acme.id });
    const app = await createProject(db, alice, { name: "App" });
    await entry(alice, "Site work", web.id, "2026-03-09T01:00:00.000Z", 90);
    await entry(alice, "Site work", web.id, "2026-03-10T01:00:00.000Z", 60);
    await entry(alice, "Review", app.id, "2026-03-10T03:00:00.000Z", 45);
    await entry(alice, "Email", null, "2026-03-11T01:00:00.000Z", 15);
    await entry(alice, "Old", web.id, "2026-03-02T01:00:00.000Z", 600); // last week
    await entry(bob, "Fixes", web.id, "2026-03-10T05:00:00.000Z", 30);
    await startTimer(
      db,
      bob,
      { description: "Live", projectId: app.id, taskId: null, tagIds: [], billable: false },
      NOW,
    );
  });

  it("gives a person their totals, top project and client, series and most tracked, matching the Summary", async () => {
    const me = await dashboardMe(db, alice, QUERY, PREFS, NOW);
    const summary = await summaryReport(
      db,
      alice,
      { ...QUERY, userIds: [alice.userId] },
      PREFS,
      NOW,
    );
    expect(me.totals).toEqual(summary.totals);
    expect(me.totals.durationSeconds).toBe((90 + 60 + 45 + 15) * 60);
    expect(me.topProject).toEqual({ label: "Web", seconds: 150 * 60 });
    expect(me.topClient).toEqual({ label: "Acme", seconds: 150 * 60 });
    expect(me.series).toHaveLength(7);
    expect(me.mostTracked.map((m) => [m.description, m.projectName, m.seconds])).toEqual([
      ["Site work", "Web", 150 * 60],
      ["Review", "App", 45 * 60],
      ["Email", null, 15 * 60],
    ]);
  });

  it("is about the viewer only, even for an owner", async () => {
    const me = await dashboardMe(db, bob, QUERY, PREFS, NOW);
    expect(me.totals.durationSeconds).toBe(30 * 60);
    expect(me.topClient).toEqual({ label: "Acme", seconds: 30 * 60 });
  });

  it("shows every active member to team readers, with the latest entry and who is tracking now", async () => {
    const team = await dashboardTeam(db, alice, QUERY, PREFS, NOW);
    expect(team.map((m) => [m.name, m.totalSeconds, m.running])).toEqual([
      ["Alice A", 210 * 60, false],
      ["Bob B", 30 * 60, true],
      ["Carol C", 0, false],
    ]);
    expect(team[1]!.latest).toMatchObject({ description: "Live", projectName: "App", end: null });
    expect(team[0]!.latest).toMatchObject({ description: "Email", projectName: null });
    expect(team[2]!.latest).toBeNull();
  });

  it("is refused to members", async () => {
    await expect(dashboardTeam(db, carol, QUERY, PREFS, NOW)).rejects.toMatchObject({
      status: 403,
    });
  });
});
