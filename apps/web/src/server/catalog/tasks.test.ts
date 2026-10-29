import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
  asViewer,
} from "../../../test/db";
import { createManualEntry, type EntryScope, listEntriesInRange } from "../time-entries";
import { createProject } from "./projects";
import { createTask, deleteTask, listTasks, updateTask } from "./tasks";
import type { Viewer } from "./viewer";

const handle = connectTestDb();
const db = handle.db;

const NOW = new Date("2026-03-11T04:00:00.000Z");

let owner: Viewer;
let member: Viewer;
let outsider: Viewer;

describe("tasks service", () => {
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
    owner = asViewer({ workspaceId: ws.id, userId: alice.id, role: "owner" });
    member = asViewer({ workspaceId: ws.id, userId: carol.id, role: "member" });
    outsider = asViewer({ workspaceId: wsB.id, userId: bob.id, role: "owner" });
  });

  it("creates, renames, marks done and lists with tracked time", async () => {
    const web = await createProject(db, owner, { name: "Web" });
    const design = await createTask(db, owner, web.id, {
      name: "Design",
      assigneeIds: [member.userId],
    });
    expect(design).toMatchObject({
      projectId: web.id,
      name: "Design",
      status: "ACTIVE",
      assigneeIds: [member.userId],
      // No groups until one is assigned (decision 11).
      groupIds: [],
      trackedSeconds: 0,
    });
    await expect(
      createTask(db, owner, web.id, { name: "Design", assigneeIds: [] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await createTask(db, owner, web.id, { name: "QA", assigneeIds: [] });

    await createManualEntry(db, owner as EntryScope, {
      description: "",
      projectId: web.id,
      taskId: design.id,
      tagIds: [],
      billable: true,
      start: NOW,
      end: new Date(NOW.getTime() + 45 * 60_000),
    });

    const renamed = await updateTask(db, owner, design.id, { name: "Visual design" });
    expect(renamed.name).toBe("Visual design");
    const done = await updateTask(db, owner, design.id, { status: "DONE", assigneeIds: [] });
    expect(done).toMatchObject({ status: "DONE", assigneeIds: [] });

    expect(
      (await listTasks(db, owner, web.id)).map((t) => [t.name, t.status, t.trackedSeconds]),
    ).toEqual([
      ["QA", "ACTIVE", 0],
      ["Visual design", "DONE", 2700],
    ]);
  });

  it("requires assignees to be workspace members", async () => {
    const web = await createProject(db, owner, { name: "Web" });
    await expect(
      createTask(db, owner, web.id, { name: "Design", assigneeIds: [outsider.userId] }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("deleting a task keeps its entries on the project", async () => {
    const web = await createProject(db, owner, { name: "Web" });
    const design = await createTask(db, owner, web.id, { name: "Design", assigneeIds: [] });
    await createManualEntry(db, owner as EntryScope, {
      description: "",
      projectId: web.id,
      taskId: design.id,
      tagIds: [],
      billable: true,
      start: NOW,
      end: new Date(NOW.getTime() + 30 * 60_000),
    });

    expect(await deleteTask(db, owner, design.id)).toEqual({ affectedEntries: 1 });
    const rows = await listEntriesInRange(db, owner as EntryScope, {
      from: NOW,
      to: new Date(NOW.getTime() + 3_600_000),
    });
    expect(rows.map((e) => [e.projectId, e.taskId, e.task])).toEqual([[web.id, null, null]]);
    expect(await listTasks(db, owner, web.id)).toEqual([]);
  });

  it("hides the tasks of projects the viewer cannot see", async () => {
    const secret = await createProject(db, owner, { name: "Secret", visibility: "PRIVATE" });
    const t = await createTask(db, owner, secret.id, { name: "Hidden", assigneeIds: [] });
    await expect(listTasks(db, member, secret.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateTask(db, member, t.id, { name: "X" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(listTasks(db, outsider, secret.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
