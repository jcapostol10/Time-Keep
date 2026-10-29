import { randomUUID } from "node:crypto";

import { can } from "@timekeep/core";
import {
  and,
  eq,
  projectGroup,
  projectMember,
  rate,
  task,
  taskGroup,
  userGroup,
  workspaceSettings,
} from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../../test/db";
import { loadViewer } from "../authz";
import { createManualEntry } from "../time-entries";
import { copyProject, createProject, listPickerProjects, listProjects, listTemplates } from "./projects";
import { createTask } from "./tasks";
import type { Viewer } from "./viewer";

const handle = connectTestDb();
const db = handle.db;

let wsId: string;
let ids: Record<string, string>;
let olga: Viewer;
let templateId: string;
let setupTaskId: string;
let groupId: string;

const viewer = (who: string): Promise<Viewer> => loadViewer(db, wsId, ids[who]!);

async function addRate(over: {
  level: "project" | "project_member" | "task";
  projectId: string;
  userId?: string;
  taskId?: string;
  amountMinor: number | null;
  effectiveFrom?: Date;
}) {
  await db.insert(rate).values({
    id: randomUUID(),
    workspaceId: wsId,
    level: over.level,
    projectId: over.projectId,
    userId: over.userId ?? null,
    taskId: over.taskId ?? null,
    amountMinor: over.amountMinor,
    currency: "USD",
    effectiveFrom: over.effectiveFrom ?? new Date(0),
  });
}

/** Project templates: "Start from template" copies tasks, people, groups, rates and settings. */
describe("project templates", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const o = await createTestUser(db, "Olga Owner");
    const max = await createTestUser(db, "Max Manager");
    const bob = await createTestUser(db, "Bob Member");
    const ws = await createTestWorkspace(db, "Workspace", o.id);
    wsId = ws.id;
    ids = { olga: o.id, max: max.id, bob: bob.id };
    await addMember(db, wsId, max.id, "manager");
    await addMember(db, wsId, bob.id, "member");
    olga = await viewer("olga");
    const base = await createProject(db, olga, {
      name: "Base",
      billable: false,
      visibility: "PRIVATE",
      note: "Onboarding steps",
    });
    templateId = base.id;
    groupId = randomUUID();
    await db.insert(userGroup).values({ id: groupId, workspaceId: wsId, name: "Design" });
    setupTaskId = (
      await createTask(db, olga, base.id, { name: "Setup", assigneeIds: [], groupIds: [groupId] })
    ).id;
    await createTask(db, olga, base.id, { name: "Review", assigneeIds: [] });
    const done = await createTask(db, olga, base.id, { name: "Old step", assigneeIds: [] });
    await db.update(task).set({ status: "DONE" }).where(eq(task.id, done.id));
    await db.insert(projectMember).values([
      { projectId: base.id, userId: max.id, isManager: true },
      { projectId: base.id, userId: bob.id, isManager: false },
    ]);
    // Rule 9 already gave Design access to the private template through its task.
    await db.insert(projectGroup).values({ projectId: base.id, groupId }).onConflictDoNothing();
    await addRate({ level: "project", projectId: base.id, amountMinor: 8000 });
    await addRate({ level: "project", projectId: base.id, amountMinor: 7000, effectiveFrom: new Date("2020-01-01") });
    await addRate({ level: "project_member", projectId: base.id, userId: bob.id, amountMinor: 9000 });
    await addRate({ level: "task", projectId: base.id, taskId: setupTaskId, amountMinor: 12000 });
    await db
      .update(task)
      .set({ status: "ACTIVE" })
      .where(and(eq(task.projectId, base.id), eq(task.name, "Setup")));
    // Mark it as a template the way the settings tab does.
    await db.execute(
      /* sql */ `update "project" set "is_template" = true where "id" = '${base.id}'`,
    );
  });

  it("copies active tasks with their groups, members with their manager flag, groups, settings and the rates in force", async () => {
    const before = new Date();
    const copy = await copyProject(db, olga, templateId, {
      name: "Client X",
      clientId: null,
      isTemplate: false,
    });
    const [row] = await db.select().from(rate).where(eq(rate.projectId, copy.id)).limit(0);
    expect(row).toBeUndefined();
    const detail = (await listProjects(db, olga, { ...LIST, q: "Client X" }))[0]!;
    expect(detail).toMatchObject({
      name: "Client X",
      billable: false,
      visibility: "PRIVATE",
      note: "Onboarding steps",
      isTemplate: false,
      memberCount: 2,
    });
    const tasks = await db.select().from(task).where(eq(task.projectId, copy.id));
    expect(tasks.map((t) => [t.name, t.status]).sort()).toEqual([
      ["Review", "ACTIVE"],
      ["Setup", "ACTIVE"],
    ]);
    const newSetup = tasks.find((t) => t.name === "Setup")!;
    expect(
      (await db.select().from(taskGroup).where(eq(taskGroup.taskId, newSetup.id))).map(
        (g) => g.groupId,
      ),
    ).toEqual([groupId]);
    const members = await db.select().from(projectMember).where(eq(projectMember.projectId, copy.id));
    expect(members.map((m) => [m.userId, m.isManager]).sort()).toEqual(
      [
        [ids.bob, false],
        [ids.max, true],
      ].sort(),
    );
    expect(
      (await db.select().from(projectGroup).where(eq(projectGroup.projectId, copy.id))).map(
        (g) => g.groupId,
      ),
    ).toEqual([groupId]);
    const rates = await db.select().from(rate).where(eq(rate.projectId, copy.id));
    expect(
      rates.map((r) => [r.level, r.amountMinor, r.userId, r.taskId === newSetup.id]).sort(),
    ).toEqual(
      [
        ["project", 7000, null, false],
        ["project_member", 9000, ids.bob, false],
        ["task", 12000, null, true],
      ].sort(),
    );
    for (const r of rates) {
      expect(r.effectiveFrom.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(r.createdBy).toBe(ids.olga);
    }
    // The template's own rows are untouched.
    expect(await db.select().from(rate).where(eq(rate.projectId, templateId))).toHaveLength(4);
  });

  it("keeps templates out of the pickers and reports but lists them under Templates", async () => {
    await createProject(db, olga, { name: "Real" });
    expect((await listPickerProjects(db, olga)).map((p) => p.name)).toEqual(["Real"]);
    expect((await listProjects(db, olga, LIST)).map((p) => p.name)).toEqual(["Real"]);
    expect((await listProjects(db, olga, { ...LIST, kind: "templates" })).map((p) => p.name)).toEqual(
      ["Base"],
    );
    expect((await listTemplates(db, olga)).map((t) => t.name)).toEqual(["Base"]);
    await expect(
      createManualEntry(db, olga, {
        description: "x",
        projectId: templateId,
        taskId: null,
        tagIds: [],
        billable: false,
        start: new Date("2026-03-10T01:00:00.000Z"),
        end: new Date("2026-03-10T02:00:00.000Z"),
      }),
    ).rejects.toThrow("This project is a template.");
  });

  it("a manager allowed by the creators setting copies a template they can see", async () => {
    await db
      .update(workspaceSettings)
      .set({ projectCreators: "managers" })
      .where(eq(workspaceSettings.workspaceId, wsId));
    const max = await viewer("max");
    expect(can(max.actor, "project.create", { kind: "project", projectId: null })).toBe(true);
    const copy = await copyProject(db, max, templateId, { name: "Mine", clientId: null, isTemplate: false });
    expect(copy.name).toBe("Mine");
    // A template outside their view is not found.
    const bob = await viewer("bob");
    const hidden = await createProject(db, olga, { name: "Hidden", visibility: "PRIVATE" });
    await db.execute(/* sql */ `update "project" set "is_template" = true where "id" = '${hidden.id}'`);
    await expect(
      copyProject(db, bob, hidden.id, { name: "Nope", clientId: null, isTemplate: false }),
    ).rejects.toThrow("Project not found.");
  });
});

const LIST = {
  q: "",
  status: "active" as const,
  billing: "all" as const,
  access: "all" as const,
  sort: "name" as const,
  dir: "asc" as const,
  kind: "projects" as const,
};
