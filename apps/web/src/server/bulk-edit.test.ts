import { randomUUID } from "node:crypto";

import { eq, managedUser, project, rate, timeEntry, workspaceSettings } from "@timekeep/db";
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
import { createTag } from "./catalog/tags";
import type { Viewer } from "./catalog/viewer";
import {
  type BulkEntryPatch,
  bulkUpdateEntries,
  createManualEntry,
  scopesForEntries,
} from "./time-entries";

const handle = connectTestDb();
const db = handle.db;

const START = new Date("2026-03-10T01:00:00.000Z");
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

let wsId: string;
let ids: Record<string, string>;
let webId: string;
let archivedId: string;
let t1: string;
let t2: string;
const viewer = (who: string): Promise<Viewer> => loadViewer(db, wsId, ids[who]!);

async function setRules(patch: Partial<typeof workspaceSettings.$inferInsert>) {
  await db.update(workspaceSettings).set(patch).where(eq(workspaceSettings.workspaceId, wsId));
}

async function entry(who: string, over: Partial<Parameters<typeof createManualEntry>[2]> = {}) {
  return createManualEntry(db, await viewer(who), {
    description: `${who} work`,
    projectId: webId,
    taskId: null,
    tagIds: [],
    billable: true,
    start: START,
    end: at(30),
    ...over,
  });
}

async function bulk(who: string, entryIds: string[], patch: BulkEntryPatch) {
  const v = await viewer(who);
  return bulkUpdateEntries(db, await scopesForEntries(db, v, entryIds), patch);
}

async function stored(id: string) {
  const [row] = await db.select().from(timeEntry).where(eq(timeEntry.id, id));
  return row!;
}

/** Bulk edit validates every entry first, then applies all of them or none. */
describe("bulk edit", () => {
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
    ids = { olga: olga.id, max: max.id, bob: bob.id, carol: carol.id };
    await addMember(db, wsId, max.id, "manager");
    await addMember(db, wsId, bob.id, "member");
    await addMember(db, wsId, carol.id, "member");
    await db.insert(managedUser).values({ workspaceId: wsId, managerId: max.id, userId: bob.id });
    const owner = await viewer("olga");
    webId = (await createProject(db, owner, { name: "Web" })).id;
    archivedId = (await createProject(db, owner, { name: "Old" })).id;
    await db.update(project).set({ archived: true }).where(eq(project.id, archivedId));
    t1 = (await createTag(db, wsId, { name: "t1" })).id;
    t2 = (await createTag(db, wsId, { name: "t2" })).id;
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
        level: "project",
        projectId: webId,
        amountMinor: 8000,
        currency: "USD",
        effectiveFrom: new Date(0),
      },
    ]);
  });

  it("applies to every entry or none", async () => {
    const a = await entry("bob");
    const b = await entry("bob", { start: at(30), end: at(60) });
    const c = await entry("bob", { start: at(60), end: at(90), description: "fine" });
    await expect(
      bulk("bob", [a.id, b.id, c.id], { projectId: archivedId, taskId: null, description: "x" }),
    ).rejects.toThrow("3 of 3 entries could not be updated: This project is archived.");
    for (const id of [a.id, b.id, c.id]) {
      expect(await stored(id)).toMatchObject({ projectId: webId });
    }
    expect((await stored(c.id)).description).toBe("fine");
  });

  it("tag modes add, replace and remove", async () => {
    const a = await entry("bob", { tagIds: [t1] });
    const tagsOf = async () =>
      (await bulk("bob", [a.id], { description: "same" })).updated[0]!.tagIds.sort();
    await bulk("bob", [a.id], { tags: { mode: "add", tagIds: [t2] } });
    expect(await tagsOf()).toEqual([t1, t2].sort());
    await bulk("bob", [a.id], { tags: { mode: "replace", tagIds: [t2] } });
    expect(await tagsOf()).toEqual([t2]);
    await bulk("bob", [a.id], { tags: { mode: "remove", tagIds: [t2] } });
    expect(await tagsOf()).toEqual([]);
  });

  it("a required tag fails the batch when Remove empties one entry's tags", async () => {
    await setRules({ requiredFields: ["tag"] });
    const a = await entry("bob", { tagIds: [t1, t2] });
    const b = await entry("bob", { tagIds: [t1], start: at(30), end: at(60) });
    await expect(
      bulk("bob", [a.id, b.id], { tags: { mode: "remove", tagIds: [t1] } }),
    ).rejects.toThrow("1 of 2 entries could not be updated: Tag is required.");
    const kept = await bulk("bob", [a.id, b.id], { description: "untouched" });
    expect(kept.updated.map((e) => e.tagIds.length).sort()).toEqual([1, 2]);
  });

  it("a manager edits managed people's entries and not others'", async () => {
    const bobs = await entry("bob");
    const carols = await entry("carol");
    await expect(
      bulk("max", [bobs.id, carols.id], { description: "by max" }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await stored(bobs.id)).description).toBe("bob work");
    const done = await bulk("max", [bobs.id], { description: "by max" });
    expect(done.updated.map((e) => e.description)).toEqual(["by max"]);
  });

  it("a changed project re-rates and a description change does not", async () => {
    const a = await entry("bob", { projectId: null });
    expect((await stored(a.id)).billableRateMinor).toBe(5000);
    await bulk("bob", [a.id], { projectId: webId, taskId: null });
    expect((await stored(a.id)).billableRateMinor).toBe(8000);
    await db.update(rate).set({ amountMinor: 9000 }).where(eq(rate.projectId, webId));
    await bulk("bob", [a.id], { description: "renamed" });
    expect((await stored(a.id))).toMatchObject({ billableRateMinor: 8000, description: "renamed" });
  });
});
