import { eq, task, workspaceSettings } from "@timekeep/db";
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
import { createTask } from "./catalog/tasks";
import type { Viewer } from "./catalog/viewer";
import {
  createManualEntry,
  duplicateEntry,
  getRunningEntry,
  startTimer,
  stopTimer,
  updateEntry,
} from "./time-entries";

const handle = connectTestDb();
const db = handle.db;

let wsId: string;
let olgaId: string;
let bobId: string;
const viewer = (userId: string): Promise<Viewer> => loadViewer(db, wsId, userId);

type Rules = Partial<typeof workspaceSettings.$inferInsert>;
async function setRules(patch: Rules) {
  await db.update(workspaceSettings).set(patch).where(eq(workspaceSettings.workspaceId, wsId));
}

const START = new Date("2026-03-10T01:00:00.000Z");
const END = new Date("2026-03-10T02:00:00.000Z");
const bare = {
  description: "Work",
  projectId: null as string | null,
  taskId: null as string | null,
  tagIds: [] as string[],
  billable: false,
};

/** Required fields (decision 5) and force timer (decision 7) in the entry service. */
describe("entry rules", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const bob = await createTestUser(db, "Bob Member");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    wsId = ws.id;
    olgaId = olga.id;
    bobId = bob.id;
    await addMember(db, wsId, bobId, "member");
  });

  it("a required project refuses Stop and keeps the timer running", async () => {
    await setRules({ requiredFields: ["project"] });
    const olga = await viewer(olgaId);
    const { started } = await startTimer(db, olga, bare);
    await expect(stopTimer(db, olga, { entryId: started.id })).rejects.toMatchObject({
      message: "Project is required.",
      field: "project",
    });
    const running = await getRunningEntry(db, olga);
    expect(running?.id).toBe(started.id);
    expect(running?.start).toBe(started.start);
    expect(running?.end).toBeNull();
  });

  it("starting another timer refuses while the running one lacks a required field", async () => {
    await setRules({ requiredFields: ["project"] });
    const olga = await viewer(olgaId);
    const web = await createProject(db, olga, { name: "Web" });
    const { started } = await startTimer(db, olga, bare);
    // The implicit stop is a stop too (decision 5): a favourite, Continue or S cannot skip it.
    await expect(startTimer(db, olga, { ...bare, projectId: web.id })).rejects.toMatchObject({
      message: "Project is required.",
      field: "project",
    });
    const running = await getRunningEntry(db, olga);
    expect(running?.id).toBe(started.id);
    expect(running?.end).toBeNull();
  });

  it("task required applies only to projects with active tasks", async () => {
    await setRules({ requiredFields: ["task"] });
    const olga = await viewer(olgaId);
    const project = await createProject(db, olga, { name: "P" });
    const details = { ...bare, projectId: project.id, start: START, end: END };
    await expect(createManualEntry(db, olga, details)).resolves.toMatchObject({ taskId: null });

    const t = await createTask(db, olga, project.id, { name: "T", assigneeIds: [] });
    await expect(createManualEntry(db, olga, details)).rejects.toMatchObject({ field: "task" });
    await expect(createManualEntry(db, olga, { ...details, taskId: t.id })).resolves.toMatchObject({
      taskId: t.id,
    });

    await db.update(task).set({ status: "DONE" }).where(eq(task.id, t.id));
    await expect(createManualEntry(db, olga, details)).resolves.toMatchObject({ taskId: null });
  });

  it("a break stops with nothing filled", async () => {
    await setRules({
      requiredFields: ["project", "task", "tag", "description"],
      allowBreaks: true,
    });
    const olga = await viewer(olgaId);
    const { started } = await startTimer(db, olga, { ...bare, description: "", type: "break" });
    await expect(stopTimer(db, olga, { entryId: started.id })).resolves.toMatchObject({
      id: started.id,
    });
  });

  it("editing a stopped entry re-checks required fields", async () => {
    await setRules({ requiredFields: ["description"] });
    const olga = await viewer(olgaId);
    const entry = await createManualEntry(db, olga, { ...bare, start: START, end: END });
    await expect(updateEntry(db, olga, entry.id, { description: "" })).rejects.toMatchObject({
      field: "description",
    });
    await expect(updateEntry(db, olga, entry.id, { billable: true })).resolves.toMatchObject({
      billable: true,
      description: "Work",
    });
  });

  it("force timer blocks a member's manual entry and time edits but not the owner's", async () => {
    let bob = await viewer(bobId);
    const mine = await createManualEntry(db, bob, { ...bare, start: START, end: END });

    await setRules({ forceTimer: true });
    bob = await viewer(bobId);
    const olga = await viewer(olgaId);
    const forbidden = { status: 403 };
    await expect(
      createManualEntry(db, bob, { ...bare, start: START, end: END }),
    ).rejects.toMatchObject(forbidden);
    await expect(updateEntry(db, bob, mine.id, { description: "Edited" })).resolves.toMatchObject({
      description: "Edited",
    });
    await expect(
      updateEntry(db, bob, mine.id, { end: new Date(END.getTime() + 60_000) }),
    ).rejects.toMatchObject(forbidden);
    await expect(duplicateEntry(db, bob, mine.id)).rejects.toMatchObject(forbidden);
    await expect(
      createManualEntry(db, olga, { ...bare, start: START, end: END }),
    ).resolves.toMatchObject({ description: "Work" });

    // The timer itself, including the idle dialog's explicit end, keeps working.
    const { started } = await startTimer(db, bob, bare);
    const end = new Date(Date.parse(started.start) + 5_000);
    await expect(stopTimer(db, bob, { entryId: started.id, end })).resolves.toMatchObject({
      durationSeconds: 5,
    });
  });
});
