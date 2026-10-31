import { randomUUID } from "node:crypto";

import { DEFAULT_REPORT_QUERY, type ReportQuery, type ViewerPrefs } from "@timekeep/core";
import { eq, managedUser, projectMember, rate, timeEntry, workspaceSettings } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import { canWriteTimesFor, loadViewer, scopeForUser, writableUsers } from "./authz";
import { createProject } from "./catalog/projects";
import type { Viewer } from "./catalog/viewer";
import { listPickerProjects } from "./catalog/projects";
import { detailedReport } from "./reports";
import { createManualEntry, scopesForEntries } from "./time-entries";

const handle = connectTestDb();
const db = handle.db;

const PREFS: ViewerPrefs = {
  timezone: "Asia/Manila",
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
const NOW = new Date("2026-03-11T04:00:00.000Z");
const q = (over: Partial<ReportQuery> = {}): ReportQuery => ({
  ...DEFAULT_REPORT_QUERY,
  preset: "custom",
  from: "2026-03-08T16:00:00.000Z",
  to: "2026-03-15T16:00:00.000Z",
  ...over,
});
const START = new Date("2026-03-10T01:00:00.000Z");
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);
const bare = { description: "Work", taskId: null, tagIds: [] as string[], billable: true };

let wsId: string;
let ids: Record<string, string>;
let webId: string;
let secretId: string;
const viewer = (who: string): Promise<Viewer> => loadViewer(db, wsId, ids[who]!);

async function setRules(patch: Partial<typeof workspaceSettings.$inferInsert>) {
  await db.update(workspaceSettings).set(patch).where(eq(workspaceSettings.workspaceId, wsId));
}

/**
 * Add time for others (Phase 4b, decision 8): Ann (admin) and Max (manager of
 * Bob and of the Web project) write time for the people they may; the timer
 * stays the signed-in person's. Carol is nobody's; Secret is a private project
 * nobody is on.
 */
describe("add time for others", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const ann = await createTestUser(db, "Ann Admin");
    const max = await createTestUser(db, "Max Manager");
    const bob = await createTestUser(db, "Bob Member");
    const carol = await createTestUser(db, "Carol Member");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    wsId = ws.id;
    ids = { olga: olga.id, ann: ann.id, max: max.id, bob: bob.id, carol: carol.id };
    await addMember(db, wsId, ann.id, "admin");
    await addMember(db, wsId, max.id, "manager");
    await addMember(db, wsId, bob.id, "member");
    await addMember(db, wsId, carol.id, "member");
    await db.insert(managedUser).values({ workspaceId: wsId, managerId: max.id, userId: bob.id });
    const owner = await viewer("olga");
    webId = (await createProject(db, owner, { name: "Web" })).id;
    secretId = (await createProject(db, owner, { name: "Secret", visibility: "PRIVATE" })).id;
    await db.insert(projectMember).values({ projectId: webId, userId: max.id, isManager: true });
    await db.insert(rate).values([
      {
        id: randomUUID(),
        workspaceId: wsId,
        level: "workspace",
        amountMinor: 5000,
        currency: "USD",
        effectiveFrom: new Date(0),
      },
      {
        id: randomUUID(),
        workspaceId: wsId,
        level: "member",
        userId: bob.id,
        amountMinor: 6000,
        currency: "USD",
        effectiveFrom: new Date(0),
      },
    ]);
  });

  it("an admin's entry for a member is owned and rated as the member's", async () => {
    const forBob = await scopeForUser(db, await viewer("ann"), ids.bob!);
    expect(forBob.userId).toBe(ids.bob);
    expect(forBob.actedBy?.userId).toBe(ids.ann);
    const entry = await createManualEntry(db, forBob, {
      ...bare,
      projectId: webId,
      start: START,
      end: at(60),
    });
    const [row] = await db.select().from(timeEntry).where(eq(timeEntry.id, entry.id));
    expect(row).toMatchObject({ userId: ids.bob, billableRateMinor: 6000, amountMinor: 6000 });
  });

  it("a manager may write for managed people only", async () => {
    const max = await viewer("max");
    const forBob = await scopeForUser(db, max, ids.bob!);
    expect(forBob).toMatchObject({ userId: ids.bob, role: "member" });
    await expect(scopeForUser(db, max, ids.carol!)).rejects.toMatchObject({ status: 404 });
    await expect(scopeForUser(db, max, ids.olga!)).rejects.toMatchObject({ status: 404 });
  });

  it("a member cannot write for anyone else", async () => {
    // The matrix's "own" rule is scoped: someone else's time is not found, never forbidden.
    const bob = await viewer("bob");
    await expect(scopeForUser(db, bob, ids.carol!)).rejects.toMatchObject({ status: 404 });
    const own = await scopeForUser(db, bob, ids.bob!);
    expect(own.userId).toBe(ids.bob);
    expect(own.actedBy).toBeUndefined();
  });

  it("the target's private projects decide what the admin may pick", async () => {
    const ann = await viewer("ann");
    const forBob = await scopeForUser(db, ann, ids.bob!);
    await expect(
      createManualEntry(db, forBob, { ...bare, projectId: secretId, start: START, end: at(60) }),
    ).rejects.toThrow("Project not found.");
    expect((await listPickerProjects(db, forBob)).map((p) => p.name)).toEqual(["Web"]);
    expect((await listPickerProjects(db, ann)).map((p) => p.name).sort()).toEqual([
      "Secret",
      "Web",
    ]);
  });

  it("force timer does not block an admin acting for a member", async () => {
    await setRules({ forceTimer: true });
    const forBob = await scopeForUser(db, await viewer("ann"), ids.bob!);
    await expect(
      createManualEntry(db, forBob, { ...bare, projectId: webId, start: START, end: at(60) }),
    ).resolves.toMatchObject({ description: "Work" });
  });

  it("a manager under force timer adds time for a managed person but not for themselves", async () => {
    await setRules({ forceTimer: true });
    const max = await viewer("max");
    const forBob = await scopeForUser(db, max, ids.bob!);
    await expect(
      createManualEntry(db, forBob, { ...bare, projectId: webId, start: START, end: at(60) }),
    ).resolves.toMatchObject({ description: "Work" });
    await expect(
      createManualEntry(db, max, { ...bare, projectId: webId, start: START, end: at(60) }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("the pages' write-times flag follows the shown person, not the viewer", async () => {
    const max = await viewer("max");
    const bob = await viewer("bob");
    await createManualEntry(db, bob, { ...bare, projectId: webId, start: START, end: at(30) });
    await createManualEntry(db, max, { ...bare, projectId: webId, start: at(60), end: at(90) });
    await setRules({ forceTimer: true });
    const forced = await viewer("max"); // an actor carries the settings it was loaded with
    expect(canWriteTimesFor(forced)).toBe(false);
    expect(canWriteTimesFor(await scopeForUser(db, forced, ids.bob!))).toBe(true);
    // The Detailed report says the same per row: Bob's times, not Max's own.
    const page = await detailedReport(db, forced, q(), PREFS, { sort: "start", dir: "asc" }, NOW);
    expect(page.entries.map((e) => [e.editable, e.timesEditable])).toEqual([
      [true, true],
      [true, false],
    ]);
  });

  it("scopesForEntries groups ids by owner and refuses ids outside the scope", async () => {
    const bob = await viewer("bob");
    const carol = await viewer("carol");
    const b1 = await createManualEntry(db, bob, {
      ...bare,
      projectId: webId,
      start: START,
      end: at(30),
    });
    const b2 = await createManualEntry(db, bob, {
      ...bare,
      projectId: webId,
      start: at(30),
      end: at(60),
    });
    const c1 = await createManualEntry(db, carol, {
      ...bare,
      projectId: webId,
      start: START,
      end: at(30),
    });
    const max = await viewer("max");
    const groups = await scopesForEntries(db, max, [b1.id, b2.id]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.scope.userId).toBe(ids.bob);
    expect(groups[0]!.ids.sort()).toEqual([b1.id, b2.id].sort());
    await expect(scopesForEntries(db, max, [b1.id, c1.id])).rejects.toMatchObject({ status: 404 });
    const dropped = await scopesForEntries(db, await viewer("ann"), [b1.id, "nope"]);
    expect(dropped.map((g) => g.ids)).toEqual([[b1.id]]);
  });

  it("the Detailed report marks the entries the viewer may write as editable", async () => {
    const bob = await viewer("bob");
    const carol = await viewer("carol");
    const max = await viewer("max");
    await createManualEntry(db, bob, { ...bare, projectId: webId, start: START, end: at(30) });
    await createManualEntry(db, carol, { ...bare, projectId: webId, start: at(30), end: at(60) });
    await createManualEntry(db, max, { ...bare, projectId: webId, start: at(60), end: at(90) });
    const page = await detailedReport(db, max, q(), PREFS, { sort: "start", dir: "asc" }, NOW);
    expect(page.entries.map((e) => [e.userName, e.editable])).toEqual([
      ["Bob Member", true],
      ["Carol Member", false],
      ["Max Manager", true],
    ]);
  });

  it("writableUsers lists the viewer first, then the people they may write for", async () => {
    const names = async (who: string) =>
      (await writableUsers(db, await viewer(who))).map((u) => u.name);
    expect(await names("max")).toEqual(["Max Manager", "Bob Member"]);
    expect(await names("bob")).toEqual(["Bob Member"]);
    expect(await names("ann")).toEqual([
      "Ann Admin",
      "Bob Member",
      "Carol Member",
      "Max Manager",
      "Olga Owner",
    ]);
  });
});
