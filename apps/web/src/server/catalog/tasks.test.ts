import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
  asViewer,
} from "../../../test/db";
import { randomUUID } from "node:crypto";

import { eq, membership, projectGroup, taskGroup, userGroup, userGroupMember } from "@timekeep/db";

import { loadViewer } from "../authz";
import { deleteGroup } from "../groups";
import { createManualEntry, type EntryScope, listEntriesInRange } from "../time-entries";
import { createProject, listPickerProjects } from "./projects";
import {
  countTasksWithoutGroup,
  createTask,
  deleteTask,
  listTasks,
  listTasksAvailableTo,
  setTaskGroups,
  updateTask,
} from "./tasks";
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

  describe("groups (decision 11)", () => {
    const byGroup = (v: Viewer): Viewer => ({
      ...v,
      actor: { ...v.actor, settings: { ...v.actor.settings, taskVisibility: "BY_GROUP" } },
    });
    async function group(name: string, members: string[]): Promise<string> {
      const id = randomUUID();
      await db.insert(userGroup).values({ id, workspaceId: owner.workspaceId, name });
      if (members.length > 0) {
        await db.insert(userGroupMember).values(members.map((userId) => ({ groupId: id, userId })));
      }
      return id;
    }
    const groupsOf = async (taskId: string) =>
      (await db.select().from(taskGroup).where(eq(taskGroup.taskId, taskId)))
        .map((r) => r.groupId)
        .sort();
    const accessOf = async (projectId: string) =>
      (await db.select().from(projectGroup).where(eq(projectGroup.projectId, projectId)))
        .map((r) => r.groupId)
        .sort();

    it("stores groups and grants a private project's access to them", async () => {
      const finance = await group("Finance", [member.userId]);
      const secret = await createProject(db, owner, { name: "Secret", visibility: "PRIVATE" });
      const audit = await createTask(db, owner, secret.id, {
        name: "Audit",
        assigneeIds: [],
        groupIds: [finance],
      });
      expect(audit.groupIds).toEqual([finance]);
      expect(await groupsOf(audit.id)).toEqual([finance]);
      expect(await accessOf(secret.id)).toEqual([finance]);
      const picker = await listPickerProjects(db, member);
      expect(picker.find((p) => p.name === "Secret")?.tasks.map((t) => t.name)).toEqual(["Audit"]);
    });

    it("in BY_GROUP mode a task needs a group", async () => {
      const web = await createProject(db, owner, { name: "Web" });
      await expect(
        createTask(db, byGroup(owner), web.id, { name: "Loose", assigneeIds: [], groupIds: [] }),
      ).rejects.toThrow("Pick at least one group.");
      await createTask(db, owner, web.id, { name: "Loose", assigneeIds: [], groupIds: [] });
    });

    it("setTaskGroups adds, removes and sets; removing the last task keeps the project access", async () => {
      const finance = await group("Finance", []);
      const design = await group("Design", []);
      const secret = await createProject(db, owner, { name: "Secret", visibility: "PRIVATE" });
      const a = await createTask(db, owner, secret.id, { name: "A", assigneeIds: [] });
      const b = await createTask(db, owner, secret.id, { name: "B", assigneeIds: [] });

      await setTaskGroups(db, owner, [a.id, b.id], [finance], "add");
      expect(await groupsOf(a.id)).toEqual([finance]);
      expect(await accessOf(secret.id)).toEqual([finance]);
      await setTaskGroups(db, owner, [a.id], [design], "add");
      expect(await groupsOf(a.id)).toEqual([design, finance].sort());
      await setTaskGroups(db, owner, [a.id, b.id], [finance], "remove");
      expect(await groupsOf(a.id)).toEqual([design]);
      expect(await groupsOf(b.id)).toEqual([]);
      expect(await accessOf(secret.id)).toEqual([design, finance].sort());
      await setTaskGroups(db, owner, [a.id], [finance], "set");
      expect(await groupsOf(a.id)).toEqual([finance]);
      const patched = await updateTask(db, owner, b.id, { name: "B2", groupIds: [design] });
      expect(patched.groupIds).toEqual([design]);
    });

    it("deleting a group takes its task rows with it", async () => {
      const finance = await group("Finance", []);
      const web = await createProject(db, owner, { name: "Web" });
      const t = await createTask(db, owner, web.id, {
        name: "Books",
        assigneeIds: [],
        groupIds: [finance],
      });
      expect(await countTasksWithoutGroup(db, owner.workspaceId)).toBe(0);
      await deleteGroup(db, owner, finance);
      expect(await groupsOf(t.id)).toEqual([]);
      expect(await countTasksWithoutGroup(db, owner.workspaceId)).toBe(1);
    });

    it("a manager assigns groups only on projects they manage", async () => {
      const finance = await group("Finance", []);
      const web = await createProject(db, owner, { name: "Web" });
      const ops = await createProject(db, owner, { name: "Ops" });
      const onWeb = await createTask(db, owner, web.id, { name: "W", assigneeIds: [] });
      const onOps = await createTask(db, owner, ops.id, { name: "O", assigneeIds: [] });
      const manager = asViewer(
        { workspaceId: owner.workspaceId, userId: member.userId, role: "manager" },
        { projectIds: [ops.id] },
      );
      await setTaskGroups(db, manager, [onOps.id], [finance], "add");
      await expect(setTaskGroups(db, manager, [onWeb.id], [finance], "add")).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        createTask(db, manager, web.id, { name: "Nope", assigneeIds: [] }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("a rename that keeps the groups leaves their rows as they were", async () => {
      const finance = await group("Finance", []);
      const web = await createProject(db, owner, { name: "Web" });
      const t = await createTask(db, owner, web.id, {
        name: "Books",
        assigneeIds: [],
        groupIds: [finance],
      });
      const before = (await db.select().from(taskGroup).where(eq(taskGroup.taskId, t.id)))[0]!;
      const admin = asViewer({
        workspaceId: owner.workspaceId,
        userId: member.userId,
        role: "admin",
      });
      await updateTask(db, admin, t.id, { name: "Ledger", groupIds: [finance] });
      const after = (await db.select().from(taskGroup).where(eq(taskGroup.taskId, t.id)))[0]!;
      expect(after).toEqual(before);
    });

    it("lists no tasks, rather than not found, for a deactivated member", async () => {
      const finance = await group("Finance", [member.userId]);
      const web = await createProject(db, owner, { name: "Web" });
      await createTask(db, owner, web.id, { name: "Books", assigneeIds: [], groupIds: [finance] });
      await db
        .update(membership)
        .set({ status: "DEACTIVATED" })
        .where(eq(membership.userId, member.userId));
      const real = await loadViewer(db, owner.workspaceId, owner.userId);
      expect(await listTasksAvailableTo(db, real, member.userId)).toEqual({ byProject: [] });
      await expect(listTasksAvailableTo(db, real, randomUUID())).rejects.toMatchObject({
        status: 404,
      });
    });

    it("refuses an unknown group", async () => {
      const web = await createProject(db, owner, { name: "Web" });
      await expect(
        createTask(db, owner, web.id, { name: "T", assigneeIds: [], groupIds: [randomUUID()] }),
      ).rejects.toThrow("Unknown group.");
    });
  });
});
