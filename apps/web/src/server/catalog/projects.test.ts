import type { ClientInput } from "@timekeep/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../../test/db";
import { createManualEntry, type EntryScope, listEntriesInRange } from "../time-entries";
import { createClient } from "./clients";
import {
  createProject,
  deleteProject,
  getProject,
  getProjectStatus,
  listPickerProjects,
  listProjects,
  setFavorite,
  setProjectMembers,
  setProjectsArchived,
  updateProject,
} from "./projects";
import { createTask } from "./tasks";
import type { Viewer } from "./viewer";

const handle = connectTestDb();
const db = handle.db;

const NOW = new Date("2026-03-11T04:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const clientInput = (name: string): ClientInput => ({
  name,
  address: "",
  email: "",
  notes: "",
  currency: null,
});

let owner: Viewer;
let member: Viewer;
let outsider: Viewer;

async function entry(
  scope: Viewer,
  projectId: string | null,
  minutes: number,
  over: { taskId?: string | null; billable?: boolean; startOffset?: number } = {},
) {
  const start = at(over.startOffset ?? 0);
  return createManualEntry(db, scope as EntryScope, {
    description: "work",
    projectId,
    taskId: over.taskId ?? null,
    tagIds: [],
    billable: over.billable ?? true,
    start,
    end: new Date(start.getTime() + minutes * 60_000),
  });
}

describe("projects service", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const alice = await createTestUser(db, "Alice A");
    const carol = await createTestUser(db, "Carol C");
    const bob = await createTestUser(db, "Bob B");
    const ws = await createTestWorkspace(db, "Workspace A", alice.id);
    const wsB = await createTestWorkspace(db, "Workspace B", bob.id);
    await addMember(db, ws.id, carol.id, "member");
    owner = { workspaceId: ws.id, userId: alice.id, role: "owner" };
    member = { workspaceId: ws.id, userId: carol.id, role: "member" };
    outsider = { workspaceId: wsB.id, userId: bob.id, role: "owner" };
  });

  it("lists what each role may see, with filters and sorting", async () => {
    const acme = await createClient(db, owner.workspaceId, clientInput("Acme"));
    await createProject(db, owner, { name: "Alpha", clientId: acme.id });
    await createProject(db, owner, { name: "Secret", visibility: "PRIVATE" });
    const shared = await createProject(db, owner, { name: "Shared", visibility: "PRIVATE" });
    await setProjectMembers(db, owner, shared.id, [member.userId]);
    const old = await createProject(db, owner, { name: "Old" });
    await updateProject(db, owner, old.id, { archived: true });
    await createProject(db, owner, { name: "Free", billable: false });

    const names = async (v: Viewer, q: Partial<Parameters<typeof listProjects>[2]> = {}) =>
      (
        await listProjects(db, v, {
          q: "",
          status: "active",
          billing: "all",
          access: "all",
          sort: "name",
          dir: "asc",
          ...q,
        })
      ).map((p) => p.name);

    expect(await names(owner)).toEqual(["Alpha", "Free", "Secret", "Shared"]);
    expect(await names(member)).toEqual(["Alpha", "Free", "Shared"]);
    expect(await names(outsider)).toEqual([]);
    expect(await names(owner, { access: "private" })).toEqual(["Secret", "Shared"]);
    expect(await names(owner, { access: "public" })).toEqual(["Alpha", "Free"]);
    expect(await names(owner, { status: "archived" })).toEqual(["Old"]);
    expect(await names(owner, { status: "all" })).toHaveLength(5);
    expect(await names(owner, { q: "acme" })).toEqual(["Alpha"]);
    expect(await names(owner, { q: "SHA" })).toEqual(["Shared"]);
    expect(await names(owner, { billing: "non-billable" })).toEqual(["Free"]);
    expect(await names(owner, { billing: "billable" })).toEqual(["Alpha", "Secret", "Shared"]);
    expect(await names(owner, { clientId: acme.id })).toEqual(["Alpha"]);
    expect(await names(owner, { dir: "desc" })).toEqual(["Shared", "Secret", "Free", "Alpha"]);
  });

  it("shows everyone's tracked time to admins and only their own to members", async () => {
    const alpha = await createProject(db, owner, { name: "Alpha" });
    const beta = await createProject(db, owner, { name: "Beta" });
    await entry(owner, alpha.id, 60);
    await entry(member, alpha.id, 30, { startOffset: 120 });
    await entry(member, beta.id, 90, { startOffset: 240 });

    const base = { q: "", status: "active", billing: "all", access: "all", dir: "desc" } as const;
    const forOwner = await listProjects(db, owner, { ...base, sort: "tracked" });
    expect(forOwner.map((p) => [p.name, p.trackedSeconds])).toEqual([
      ["Beta", 5400],
      ["Alpha", 5400],
    ]);
    const forMember = await listProjects(db, member, { ...base, sort: "tracked" });
    expect(forMember.map((p) => [p.name, p.trackedSeconds])).toEqual([
      ["Beta", 5400],
      ["Alpha", 1800],
    ]);
  });

  it("keeps names unique per client", async () => {
    const acme = await createClient(db, owner.workspaceId, clientInput("Acme"));
    const globex = await createClient(db, owner.workspaceId, clientInput("Globex"));
    await createProject(db, owner, { name: "Site", clientId: acme.id });
    await createProject(db, owner, { name: "Site", clientId: globex.id });
    const loose = await createProject(db, owner, { name: "Site" });
    await expect(
      createProject(db, owner, { name: "Site", clientId: acme.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(createProject(db, owner, { name: "Site" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(updateProject(db, owner, loose.id, { clientId: acme.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const foreignClient = await createClient(db, outsider.workspaceId, clientInput("Theirs"));
    await expect(
      updateProject(db, owner, loose.id, { clientId: foreignClient.id }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("hides private projects from non-members and lists members", async () => {
    const secret = await createProject(db, owner, { name: "Secret", visibility: "PRIVATE" });
    await expect(getProject(db, member, secret.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getProject(db, outsider, secret.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await setProjectMembers(db, owner, secret.id, [member.userId]);
    const seen = await getProject(db, member, secret.id);
    expect(seen).toMatchObject({ name: "Secret", memberIds: [member.userId], memberCount: 1 });
    await expect(setProjectMembers(db, owner, secret.id, [outsider.userId])).rejects.toMatchObject({
      code: "INVALID",
    });
    await setProjectMembers(db, owner, secret.id, []);
    await expect(getProject(db, member, secret.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("updates details and archives in bulk", async () => {
    const acme = await createClient(db, owner.workspaceId, clientInput("Acme"));
    const a = await createProject(db, owner, { name: "A" });
    const b = await createProject(db, owner, { name: "B" });
    const updated = await updateProject(db, owner, a.id, {
      name: "A2",
      clientId: acme.id,
      color: "#123456",
      billable: false,
      note: "Hello",
      isTemplate: true,
    });
    expect(updated).toMatchObject({
      name: "A2",
      clientId: acme.id,
      clientName: "Acme",
      color: "#123456",
      billable: false,
      note: "Hello",
      isTemplate: true,
    });
    expect(await setProjectsArchived(db, owner, [a.id, b.id, "nope"], true)).toBe(2);
    expect(await listPickerProjects(db, owner)).toEqual([]);
    expect(await setProjectsArchived(db, owner, [a.id], false)).toBe(1);
    expect((await listPickerProjects(db, owner)).map((p) => p.name)).toEqual(["A2"]);
  });

  it("deletes a project by moving or deleting its entries", async () => {
    const web = await createProject(db, owner, { name: "Web" });
    const app = await createProject(db, owner, { name: "App" });
    const design = await createTask(db, owner, web.id, { name: "Design", assigneeIds: [] });
    await entry(owner, web.id, 60, { taskId: design.id });
    await entry(member, web.id, 30);
    const range = { from: at(-60), to: at(600) };

    await deleteProject(db, owner, web.id, { mode: "reassign", projectId: app.id });
    await expect(getProject(db, owner, web.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const mine = await listEntriesInRange(db, owner as EntryScope, range);
    expect(mine.map((e) => [e.projectId, e.taskId])).toEqual([[app.id, null]]);
    expect(
      (await listEntriesInRange(db, member as EntryScope, range)).map((e) => e.projectId),
    ).toEqual([app.id]);

    await deleteProject(db, owner, app.id, { mode: "delete" });
    expect(await listEntriesInRange(db, owner as EntryScope, range)).toEqual([]);
    expect(await listEntriesInRange(db, member as EntryScope, range)).toEqual([]);

    const gone = await createProject(db, owner, { name: "Gone" });
    const old = await createProject(db, owner, { name: "Old" });
    await updateProject(db, owner, old.id, { archived: true });
    await expect(
      deleteProject(db, owner, gone.id, { mode: "reassign", projectId: old.id }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await deleteProject(db, owner, gone.id, { mode: "reassign", projectId: null });
  });

  it("favourites are per user and come first in the picker", async () => {
    await createProject(db, owner, { name: "Alpha" });
    const zeta = await createProject(db, owner, { name: "Zeta" });
    await setFavorite(db, member, zeta.id, true);

    expect((await listPickerProjects(db, member)).map((p) => [p.name, p.favorite])).toEqual([
      ["Zeta", true],
      ["Alpha", false],
    ]);
    expect((await listPickerProjects(db, owner)).map((p) => [p.name, p.favorite])).toEqual([
      ["Alpha", false],
      ["Zeta", false],
    ]);
    await setFavorite(db, member, zeta.id, false);
    expect((await listPickerProjects(db, member)).map((p) => p.favorite)).toEqual([false, false]);
  });

  it("sums status by task and member for a range", async () => {
    const web = await createProject(db, owner, { name: "Web" });
    const design = await createTask(db, owner, web.id, { name: "Design", assigneeIds: [] });
    await entry(owner, web.id, 60, { taskId: design.id, billable: true });
    await entry(owner, web.id, 30, { billable: false, startOffset: 90 });
    await entry(member, web.id, 45, { taskId: design.id, billable: true, startOffset: 180 });
    await entry(owner, web.id, 999, { startOffset: 100_000 }); // outside the range

    const status = await getProjectStatus(db, owner, web.id, { from: at(-10), to: at(600) });
    expect(status.byTask).toEqual([
      { taskId: design.id, name: "Design", seconds: 6300 },
      { taskId: null, name: "No task", seconds: 1800 },
    ]);
    expect(status.byMember).toEqual([
      { userId: owner.userId, name: "Alice A", seconds: 5400 },
      { userId: member.userId, name: "Carol C", seconds: 2700 },
    ]);
    expect(status).toMatchObject({
      billableSeconds: 6300,
      nonBillableSeconds: 1800,
      totalSeconds: 8100,
    });
  });
});
