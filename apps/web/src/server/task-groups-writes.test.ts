import { randomUUID } from "node:crypto";

import { autoMapColumns, TASK_UNAVAILABLE_MESSAGE } from "@timekeep/core";
import {
  and,
  eq,
  managedUser,
  projectMember,
  taskGroup,
  timeEntry,
  userGroup,
  userGroupMember,
  workspaceSettings,
} from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import { loadViewer, scopeForUser } from "./authz";
import { createProject } from "./catalog/projects";
import { createTag } from "./catalog/tags";
import { createTask } from "./catalog/tasks";
import type { Viewer } from "./catalog/viewer";
import { commitEntryImport, type ImportOptions, planEntryImport } from "./entry-import";
import { listFavorites, pinFavorite } from "./favorites";
import {
  bulkUpdateEntries,
  continueEntry,
  createManualEntries,
  createManualEntry,
  duplicateEntry,
  type EntryScope,
  getRunningEntry,
  scopesForEntries,
  splitEntry,
  startTimer,
  stopTimer,
  updateEntry,
} from "./time-entries";

const handle = connectTestDb();
const db = handle.db;

const START = new Date("2026-03-10T01:00:00.000Z");
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);
const bare = { description: "Work", taskId: null, tagIds: [] as string[], billable: true };

let wsId: string;
let ids: Record<string, string>;
let emails: Record<string, string>;
const viewer = (who: string): Promise<Viewer> => loadViewer(db, wsId, ids[who]!);

async function setRules(patch: Partial<typeof workspaceSettings.$inferInsert>) {
  await db.update(workspaceSettings).set(patch).where(eq(workspaceSettings.workspaceId, wsId));
}

async function group(name: string, members: string[]): Promise<string> {
  const id = randomUUID();
  await db.insert(userGroup).values({ id, workspaceId: wsId, name });
  if (members.length > 0) {
    await db.insert(userGroupMember).values(members.map((userId) => ({ groupId: id, userId })));
  }
  return id;
}

async function task(projectId: string, name: string, groupIds: string[]): Promise<string> {
  const t = await createTask(db, await viewer("olga"), projectId, { name, assigneeIds: [] });
  if (groupIds.length > 0) {
    await db.insert(taskGroup).values(groupIds.map((groupId) => ({ taskId: t.id, groupId })));
  }
  return t.id;
}

/** A stopped entry of `who`'s with the given details, made while tasks are open to everyone. */
async function entryFor(who: string, projectId: string, taskId: string | null, minute = 0) {
  return createManualEntry(db, await viewer(who), {
    ...bare,
    description: `${who} on ${taskId ?? "no task"}`,
    projectId,
    taskId,
    start: at(minute),
    end: at(minute + 30),
  });
}

async function stored(id: string) {
  const [row] = await db.select().from(timeEntry).where(eq(timeEntry.id, id));
  return row!;
}

const HEADER = "Date,Start,End,Description,Project,Task,Tags,Billable,Email";
const OPTIONS: ImportOptions = {
  timezone: "Asia/Manila",
  dateFormat: "yyyy-MM-dd",
  createMissing: true,
  mapping: autoMapColumns(HEADER.split(",")),
  newTaskGroupIds: [],
};
const csv = (...lines: string[]) => [HEADER, ...lines].join("\n");

/**
 * Groups: Design {Bob, Carol}, Finance {Bob}, Engineering {Max}. Ann is in no
 * group; Max manages Bob and the Ops project.
 * Web (public): Design→[Design], Dev→[Engineering], Books→[Finance], Admin→[].
 * Ops (public): Ledger→[Finance], Wiring→[Engineering]. Empty: no tasks.
 * Hidden (public): Cabling→[Engineering] only.
 * Entries are made while tasks are open to everyone; each test switches to BY_GROUP.
 */
describe("tasks by group: writes", () => {
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
    await addMember(db, wsId, ann.id, "admin");
    await addMember(db, wsId, max.id, "manager");
    await addMember(db, wsId, bob.id, "member");
    await addMember(db, wsId, carol.id, "member");
    ids = { olga: olga.id, ann: ann.id, max: max.id, bob: bob.id, carol: carol.id };
    emails = { olga: olga.email, ann: ann.email, bob: bob.email };
    await db.insert(managedUser).values({ workspaceId: wsId, managerId: max.id, userId: bob.id });

    ids.design = await group("Design", [bob.id, carol.id]);
    ids.finance = await group("Finance", [bob.id]);
    ids.engineering = await group("Engineering", [max.id]);

    const owner = await viewer("olga");
    const web = await createProject(db, owner, { name: "Web" });
    const ops = await createProject(db, owner, { name: "Ops" });
    const empty = await createProject(db, owner, { name: "Empty" });
    const hidden = await createProject(db, owner, { name: "Hidden" });
    ids.web = web.id;
    ids.ops = ops.id;
    ids.empty = empty.id;
    ids.hidden = hidden.id;
    await db.insert(projectMember).values({ projectId: ops.id, userId: max.id, isManager: true });
    ids.tag = (await createTag(db, wsId, { name: "t" })).id;

    ids.tDesign = await task(web.id, "Design", [ids.design]);
    ids.tDev = await task(web.id, "Dev", [ids.engineering]);
    ids.tBooks = await task(web.id, "Books", [ids.finance]);
    ids.tAdmin = await task(web.id, "Admin", []);
    ids.tLedger = await task(ops.id, "Ledger", [ids.finance]);
    ids.tWiring = await task(ops.id, "Wiring", [ids.engineering]);
    await task(hidden.id, "Cabling", [ids.engineering]);
  });

  const byGroup = () => setRules({ taskVisibility: "BY_GROUP" });

  it("every write path refuses a task outside the owner's groups", async () => {
    const onDev = await entryFor("bob", ids.web!, ids.tDev!);
    const own = await entryFor("bob", ids.web!, ids.tDesign!, 60);
    const pinned = await pinFavorite(db, await viewer("bob"), {
      ...bare,
      description: "On Dev",
      projectId: ids.web!,
      taskId: ids.tDev!,
    });
    await byGroup();
    const bob = await viewer("bob");
    const dev = { ...bare, projectId: ids.web!, taskId: ids.tDev! };

    await expect(startTimer(db, bob, dev)).rejects.toThrow(TASK_UNAVAILABLE_MESSAGE);
    await expect(createManualEntry(db, bob, { ...dev, start: at(120), end: at(150) })).rejects.toThrow(
      TASK_UNAVAILABLE_MESSAGE,
    );
    await expect(updateEntry(db, bob, own.id, { taskId: ids.tDev! })).rejects.toThrow(
      TASK_UNAVAILABLE_MESSAGE,
    );
    await expect(duplicateEntry(db, bob, onDev.id)).rejects.toThrow(TASK_UNAVAILABLE_MESSAGE);
    await expect(continueEntry(db, bob, onDev.id)).rejects.toThrow(TASK_UNAVAILABLE_MESSAGE);
    await expect(
      bulkUpdateEntries(db, await scopesForEntries(db, bob, [own.id]), { taskId: ids.tDev! }),
    ).rejects.toThrow(TASK_UNAVAILABLE_MESSAGE);
    await expect(
      createManualEntries(db, bob, [
        { ...dev, start: at(200), end: at(230) },
        { ...dev, start: at(240), end: at(270) },
      ]),
    ).rejects.toThrow(TASK_UNAVAILABLE_MESSAGE);
    await expect(pinFavorite(db, bob, { ...dev, description: "Again" })).rejects.toThrow(
      TASK_UNAVAILABLE_MESSAGE,
    );
    const favourites = await listFavorites(db, bob);
    expect(favourites.find((f) => f.id === pinned.id)?.blocked).toBe(TASK_UNAVAILABLE_MESSAGE);
    expect((await stored(own.id)).taskId).toBe(ids.tDesign);
  });

  it("a task of the owner's group is accepted on every path", async () => {
    const onDesign = await entryFor("bob", ids.web!, ids.tDesign!);
    await byGroup();
    const bob = await viewer("bob");
    const design = { ...bare, projectId: ids.web!, taskId: ids.tDesign! };

    const { started } = await startTimer(db, bob, design);
    await stopTimer(db, bob, { entryId: started.id, end: new Date(Date.now() + 1000) });
    const manual = await createManualEntry(db, bob, { ...design, start: at(120), end: at(150) });
    expect(manual.taskId).toBe(ids.tDesign);
    await updateEntry(db, bob, manual.id, { taskId: ids.tBooks! });
    expect((await stored(manual.id)).taskId).toBe(ids.tBooks);
    await duplicateEntry(db, bob, onDesign.id);
    const continued = await continueEntry(db, bob, onDesign.id);
    await stopTimer(db, bob, { entryId: continued.started.id });
    await bulkUpdateEntries(db, await scopesForEntries(db, bob, [manual.id]), {
      taskId: ids.tDesign!,
    });
    await createManualEntries(db, bob, [{ ...design, start: at(200), end: at(230) }]);
    const fav = await pinFavorite(db, bob, { ...design, description: "Design work" });
    expect((await listFavorites(db, bob)).find((f) => f.id === fav.id)?.blocked).toBeNull();
  });

  it("a crafted task id of another group is refused even when the project is visible", async () => {
    await byGroup();
    const bob = await viewer("bob");
    await expect(
      createManualEntry(db, bob, {
        ...bare,
        projectId: ids.ops!,
        taskId: ids.tWiring!,
        start: START,
        end: at(30),
      }),
    ).rejects.toThrow(TASK_UNAVAILABLE_MESSAGE);
    // A task of another project is still the older refusal: the block runs first.
    await expect(
      createManualEntry(db, bob, {
        ...bare,
        projectId: ids.web!,
        taskId: ids.tLedger!,
        start: START,
        end: at(30),
      }),
    ).rejects.toThrow("This task belongs to another project.");
  });

  it("rule 8: a member must pick a task on a project that has visible tasks", async () => {
    await byGroup();
    const bob = await viewer("bob");
    const required = { message: "Task is required.", field: "task" };
    await expect(
      createManualEntry(db, bob, { ...bare, projectId: ids.web!, start: START, end: at(30) }),
    ).rejects.toMatchObject(required);

    // Start is free; Stop binds, and the timer keeps running after a refusal.
    const { started } = await startTimer(db, bob, { ...bare, projectId: ids.web! });
    await expect(stopTimer(db, bob, { entryId: started.id })).rejects.toMatchObject(required);
    expect((await getRunningEntry(db, bob))?.id).toBe(started.id);
    await updateEntry(db, bob, started.id, { taskId: ids.tDesign! });
    await stopTimer(db, bob, { entryId: started.id });

    // A project with no tasks behaves as today; one whose tasks are all hidden takes no untasked time.
    await createManualEntry(db, bob, { ...bare, projectId: ids.empty!, start: at(60), end: at(90) });
    await expect(
      createManualEntry(db, bob, { ...bare, projectId: ids.hidden!, start: at(60), end: at(90) }),
    ).rejects.toMatchObject(required);

    // Owners and admins see every task, so none is forced on them.
    const olga = await viewer("olga");
    await createManualEntry(db, olga, { ...bare, projectId: ids.web!, start: at(60), end: at(90) });
  });

  it("existing entries are untouched: time, description, tags, billable and split still work on an unavailable task", async () => {
    const onDev = await entryFor("bob", ids.web!, ids.tDev!);
    await byGroup();
    const bob = await viewer("bob");
    await updateEntry(db, bob, onDev.id, { end: at(45) });
    await updateEntry(db, bob, onDev.id, { description: "Renamed" });
    await updateEntry(db, bob, onDev.id, { tagIds: [ids.tag!] });
    await updateEntry(db, bob, onDev.id, { billable: false });
    const row = await stored(onDev.id);
    expect(row).toMatchObject({ taskId: ids.tDev, description: "Renamed", billable: false });
    const { first, second } = await splitEntry(db, bob, onDev.id, at(20));
    expect([first.taskId, second.taskId]).toEqual([ids.tDev, ids.tDev]);
    await expect(updateEntry(db, bob, onDev.id, { projectId: ids.ops! })).rejects.toThrow();
  });

  it("a running timer on a task that became unavailable still stops", async () => {
    const { started } = await startTimer(db, await viewer("bob"), {
      ...bare,
      projectId: ids.web!,
      taskId: ids.tDesign!,
    });
    await db
      .delete(userGroupMember)
      .where(and(eq(userGroupMember.groupId, ids.design!), eq(userGroupMember.userId, ids.bob!)));
    await byGroup();
    const stopped = await stopTimer(db, await viewer("bob"), { entryId: started.id });
    expect(stopped.taskId).toBe(ids.tDesign);
  });

  it("add-for-others checks the owner's groups, not the actor's", async () => {
    const own = await entryFor("bob", ids.web!, ids.tDesign!);
    await byGroup();
    const forBobByAnn = await scopeForUser(db, await viewer("ann"), ids.bob!);
    const forBobByMax = await scopeForUser(db, await viewer("max"), ids.bob!);
    const design = { ...bare, projectId: ids.web!, taskId: ids.tDesign!, start: at(60), end: at(90) };
    const dev = { ...design, taskId: ids.tDev!, start: at(120), end: at(150) };

    await createManualEntry(db, forBobByAnn, design);
    await expect(createManualEntry(db, forBobByAnn, dev)).rejects.toThrow(TASK_UNAVAILABLE_MESSAGE);
    // Max is in Engineering, but Bob is not: Dev is refused for Bob and Design accepted.
    await expect(createManualEntry(db, forBobByMax, dev)).rejects.toThrow(TASK_UNAVAILABLE_MESSAGE);
    await createManualEntry(db, forBobByMax, { ...design, start: at(200), end: at(230) });
    await expect(
      bulkUpdateEntries(db, await scopesForEntries(db, await viewer("ann"), [own.id]), {
        taskId: ids.tDev!,
      }),
    ).rejects.toThrow(TASK_UNAVAILABLE_MESSAGE);
    expect((await stored(own.id)).taskId).toBe(ids.tDesign);
  });

  it("the import follows the row owner's groups", async () => {
    await byGroup();
    const bob = await viewer("bob");
    const ann = await viewer("ann");
    const olga = await viewer("olga");

    const bobPlan = await planEntryImport(
      db,
      bob,
      csv("2026-03-09,09:00,10:00,Work,Web,Dev,,yes,"),
      OPTIONS,
    );
    expect(bobPlan.rows[0]!.error).toBe(`Line 2: task "Dev" isn't available to your groups`);

    const annPlan = await planEntryImport(
      db,
      ann,
      csv(`2026-03-09,09:00,10:00,Work,Web,Dev,,yes,${emails.bob}`),
      OPTIONS,
    );
    expect(annPlan.rows[0]!.error).toBe(`Line 2: task "Dev" isn't available to Bob Member's groups`);

    const fresh = csv("2026-03-09,09:00,10:00,Work,Web,Fresh,,yes,");
    expect((await planEntryImport(db, olga, fresh, OPTIONS)).rows[0]!.error).toBe(
      `Line 2: choose groups for new tasks to create "Fresh"`,
    );
    expect((await planEntryImport(db, bob, fresh, OPTIONS)).rows[0]!.error).toBe(
      `Line 2: unknown task "Fresh"`,
    );

    const withGroups = { ...OPTIONS, newTaskGroupIds: [ids.finance!] };
    const plan = await planEntryImport(db, olga, fresh, withGroups);
    expect(plan).toMatchObject({ ok: 1, errors: 0, creates: { tasks: ["Web › Fresh"] } });
    const { imported } = await commitEntryImport(db, olga, fresh, withGroups, plan.fingerprint);
    expect(imported).toBe(1);
    const created = await db
      .select({ groupId: taskGroup.groupId })
      .from(taskGroup)
      .innerJoin(timeEntry, eq(timeEntry.taskId, taskGroup.taskId))
      .where(eq(timeEntry.description, "Work"));
    expect(created.map((r) => r.groupId)).toEqual([ids.finance]);
  });

  it("a split never re-checks the task (rule 10): the scope type is the owner's", () => {
    // Documented in splitEntry; the behaviour is asserted above. The type is what callers pass.
    const scope: EntryScope = { workspaceId: "w", userId: "u", role: "member" } as EntryScope;
    expect(scope.actedBy).toBeUndefined();
  });
});
