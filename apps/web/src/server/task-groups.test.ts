import { randomUUID } from "node:crypto";

import {
  and,
  eq,
  project,
  projectMember,
  taskGroup,
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
import { loadViewer } from "./authz";
import { createProject, listPickerProjects } from "./catalog/projects";
import {
  countTasksWithoutGroup,
  createTask,
  listGroupTasks,
  listTasks,
  listTasksAvailableTo,
  visibleTasksFor,
} from "./catalog/tasks";
import type { Viewer } from "./catalog/viewer";
import { reportFilterOptions } from "./reports";

const handle = connectTestDb();
const db = handle.db;

let ids: Record<string, string>;
let wsId: string;
const viewer = (who: string): Promise<Viewer> => loadViewer(db, wsId, ids[who]!);

type Rules = Partial<typeof workspaceSettings.$inferInsert>;
async function setRules(patch: Rules) {
  await db.update(workspaceSettings).set(patch).where(eq(workspaceSettings.workspaceId, wsId));
}

const names = (ts: { name: string }[]) => ts.map((t) => t.name).sort();

async function group(name: string, members: string[]): Promise<string> {
  const id = randomUUID();
  await db.insert(userGroup).values({ id, workspaceId: wsId, name });
  if (members.length > 0) {
    await db.insert(userGroupMember).values(members.map((userId) => ({ groupId: id, userId })));
  }
  return id;
}

/** Seeds a task with its group rows directly: no rule 9, and no "pick a group" check in BY_GROUP mode. */
async function task(projectId: string, name: string, groupIds: string[]): Promise<string> {
  const olga = await viewer("olga");
  const seeding: Viewer = {
    ...olga,
    actor: { ...olga.actor, settings: { ...olga.actor.settings, taskVisibility: "EVERYONE" } },
  };
  const t = await createTask(db, seeding, projectId, { name, assigneeIds: [] });
  if (groupIds.length > 0) {
    await db.insert(taskGroup).values(groupIds.map((groupId) => ({ taskId: t.id, groupId })));
  }
  return t.id;
}

/**
 * Groups: Design {Bob, Carol}, Finance {Bob}, Engineering {Max}. Max manages Ops.
 * Web (public): Design→[Design], Dev→[Engineering], Books→[Finance], Admin→[].
 * Ops (public): Ledger→[Finance]. Secret (private, Olga only): Audit→[Finance].
 */
describe("tasks by group: reads", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const ann = await createTestUser(db, "Ann Admin");
    const max = await createTestUser(db, "Max Manager");
    const bob = await createTestUser(db, "Bob Member");
    const carol = await createTestUser(db, "Carol Member");
    const dana = await createTestUser(db, "Dana Member");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    wsId = ws.id;
    await addMember(db, wsId, ann.id, "admin");
    await addMember(db, wsId, max.id, "manager");
    await addMember(db, wsId, bob.id, "member");
    await addMember(db, wsId, carol.id, "member");
    await addMember(db, wsId, dana.id, "member", "DEACTIVATED");
    ids = {
      olga: olga.id,
      ann: ann.id,
      max: max.id,
      bob: bob.id,
      carol: carol.id,
      dana: dana.id,
    };

    ids.design = await group("Design", [bob.id, carol.id]);
    ids.finance = await group("Finance", [bob.id]);
    ids.engineering = await group("Engineering", [max.id]);

    const owner = await viewer("olga");
    const web = await createProject(db, owner, { name: "Web" });
    const ops = await createProject(db, owner, { name: "Ops" });
    const secret = await createProject(db, owner, { name: "Secret", visibility: "PRIVATE" });
    ids.web = web.id;
    ids.ops = ops.id;
    ids.secret = secret.id;
    await db.insert(projectMember).values({ projectId: ops.id, userId: max.id, isManager: true });

    ids.tDesign = await task(web.id, "Design", [ids.design]);
    ids.tDev = await task(web.id, "Dev", [ids.engineering]);
    ids.tBooks = await task(web.id, "Books", [ids.finance]);
    ids.tAdmin = await task(web.id, "Admin", []);
    ids.tLedger = await task(ops.id, "Ledger", [ids.finance]);
    ids.tAudit = await task(secret.id, "Audit", [ids.finance]);
  });

  it("EVERYONE lists every active task for everyone", async () => {
    const all = ["Admin", "Books", "Design", "Dev", "Ledger"];
    expect(names(await visibleTasksFor(db, await viewer("bob")))).toEqual(all);
    expect(names(await visibleTasksFor(db, await viewer("max")))).toEqual(all);
    expect(names(await visibleTasksFor(db, await viewer("olga")))).toEqual([...all, "Audit"].sort());
  });

  describe("BY_GROUP", () => {
    beforeEach(async () => setRules({ taskVisibility: "BY_GROUP" }));

    it("a member sees the union of their groups' tasks", async () => {
      expect(names(await visibleTasksFor(db, await viewer("bob")))).toEqual([
        "Books",
        "Design",
        "Ledger",
      ]);
      expect(names(await visibleTasksFor(db, await viewer("carol")))).toEqual(["Design"]);
    });

    it("leaving a group removes its tasks at once; joining adds them", async () => {
      await db
        .delete(userGroupMember)
        .where(
          and(eq(userGroupMember.groupId, ids.design!), eq(userGroupMember.userId, ids.carol!)),
        );
      expect(names(await visibleTasksFor(db, await viewer("carol")))).toEqual([]);
      await db.insert(userGroupMember).values({ groupId: ids.finance!, userId: ids.carol! });
      expect(names(await visibleTasksFor(db, await viewer("carol")))).toEqual(["Books", "Ledger"]);
    });

    it("a deactivated member has no viewer", async () => {
      await expect(loadViewer(db, wsId, ids.dana!)).rejects.toMatchObject({ status: 404 });
    });

    it("turning BY_GROUP off restores every task", async () => {
      expect(names(await visibleTasksFor(db, await viewer("carol")))).toEqual(["Design"]);
      await setRules({ taskVisibility: "EVERYONE" });
      expect(names(await visibleTasksFor(db, await viewer("carol")))).toEqual([
        "Admin",
        "Books",
        "Design",
        "Dev",
        "Ledger",
      ]);
    });

    it("a manager sees managed projects' tasks plus their groups' tasks", async () => {
      expect(names(await visibleTasksFor(db, await viewer("max")))).toEqual(["Dev", "Ledger"]);
    });

    it("owners and admins see every task, including those with no group", async () => {
      const all = ["Admin", "Audit", "Books", "Design", "Dev", "Ledger"];
      expect(names(await visibleTasksFor(db, await viewer("olga")))).toEqual(all);
      expect(names(await visibleTasksFor(db, await viewer("ann")))).toEqual(all);
    });

    it("includeHidden marks instead of filtering", async () => {
      const rows = await visibleTasksFor(db, await viewer("bob"), {
        projectIds: [ids.web!],
        includeHidden: true,
      });
      expect(rows.map((t) => [t.name, t.visible])).toEqual([
        ["Admin", false],
        ["Books", true],
        ["Design", true],
        ["Dev", false],
      ]);
      expect(rows.find((t) => t.name === "Design")!.groupIds).toEqual([ids.design]);
    });

    it("rule 8 hides a project whose tasks the member cannot see", async () => {
      const owner = await viewer("olga");
      const hidden = await createProject(db, owner, { name: "Hidden" });
      await createProject(db, owner, { name: "Empty" });
      await task(hidden.id, "Wiring", [ids.engineering!]);

      const bob = await listPickerProjects(db, await viewer("bob"));
      expect(bob.map((p) => p.name).sort()).toEqual(["Empty", "Ops", "Web"]);
      expect(names(bob.find((p) => p.name === "Web")!.tasks)).toEqual(["Books", "Design"]);
      expect(bob.every((p) => !p.canCreateTask)).toBe(true);

      const olga = await listPickerProjects(db, owner);
      expect(olga.map((p) => p.name).sort()).toEqual(["Empty", "Hidden", "Ops", "Secret", "Web"]);
      expect(olga.every((p) => p.canCreateTask)).toBe(true);

      // A manager adds tasks to the projects they manage only.
      const max = await listPickerProjects(db, await viewer("max"));
      expect(max.find((p) => p.name === "Ops")!.canCreateTask).toBe(true);
      expect(max.find((p) => p.name === "Web")!.canCreateTask).toBe(false);
    });

    it("the reports' filter options follow the member's tasks", async () => {
      const options = await reportFilterOptions(db, await viewer("bob"));
      expect(names(options.tasks)).toEqual(["Books", "Design", "Ledger"]);
    });

    it("listTasks shows an admin every task with its groups", async () => {
      const rows = await listTasks(db, await viewer("ann"), ids.web!);
      expect(rows.map((t) => [t.name, t.groupIds])).toEqual([
        ["Admin", []],
        ["Books", [ids.finance]],
        ["Design", [ids.design]],
        ["Dev", [ids.engineering]],
      ]);
    });

    it("countTasksWithoutGroup counts active, non-template, non-archived tasks", async () => {
      expect(await countTasksWithoutGroup(db, wsId)).toBe(1);
      await db.update(project).set({ archived: true }).where(eq(project.id, ids.web!));
      expect(await countTasksWithoutGroup(db, wsId)).toBe(0);
    });

    it("listGroupTasks and listTasksAvailableTo group by project", async () => {
      const olga = await viewer("olga");
      const finance = await listGroupTasks(db, olga, ids.finance!);
      expect(
        finance.byProject.map((p) => [p.projectName, p.tasks.map((t) => t.name)]),
      ).toEqual([
        ["Ops", ["Ledger"]],
        ["Secret", ["Audit"]],
        ["Web", ["Books"]],
      ]);
      const bob = await listTasksAvailableTo(db, olga, ids.bob!);
      expect(bob.byProject.map((p) => [p.projectName, p.tasks.map((t) => t.name)])).toEqual([
        ["Ops", ["Ledger"]],
        ["Web", ["Books", "Design"]],
      ]);
      expect(bob.byProject[1]!.tasks[0]!.groupNames).toEqual(["Finance"]);
      await expect(listGroupTasks(db, await viewer("bob"), ids.finance!)).rejects.toMatchObject({
        status: 403,
      });
    });
  });
});
