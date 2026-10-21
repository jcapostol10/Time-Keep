import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import { createProject, updateProject } from "./catalog/projects";
import { createManualEntry, type EntryScope, listEntriesInRange } from "./time-entries";
import { copyWeek, deleteTemplate, listTemplates, saveTemplate } from "./timesheet";

const handle = connectTestDb();
const db = handle.db;

const TZ = "Asia/Manila";
/** Monday 2026-03-02 00:00 Manila and the Monday after. */
const LAST_WEEK = new Date("2026-03-01T16:00:00.000Z");
const THIS_WEEK = new Date("2026-03-08T16:00:00.000Z");

let scope: EntryScope;
let other: EntryScope;

async function entry(
  s: EntryScope,
  startIso: string,
  minutes: number,
  over: Partial<Parameters<typeof createManualEntry>[2]> = {},
) {
  const start = new Date(startIso);
  return createManualEntry(db, s, {
    description: "work",
    projectId: null,
    taskId: null,
    tagIds: [],
    billable: false,
    start,
    end: new Date(start.getTime() + minutes * 60_000),
    ...over,
  });
}

describe("timesheet templates and copy week", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const alice = await createTestUser(db, "Alice A");
    const carol = await createTestUser(db, "Carol C");
    const ws = await createTestWorkspace(db, "Workspace A", alice.id);
    await addMember(db, ws.id, carol.id, "member");
    scope = { workspaceId: ws.id, userId: alice.id, role: "owner" };
    other = { workspaceId: ws.id, userId: carol.id, role: "member" };
  });

  it("saves, lists, replaces and deletes a user's templates", async () => {
    const rows = [
      { projectId: null, taskId: null, description: "Email" },
      { projectId: null, taskId: null, description: "Standup" },
    ];
    const saved = await saveTemplate(db, scope, { name: "Usual week", rows });
    expect(saved).toMatchObject({ name: "Usual week", rows });
    await saveTemplate(db, scope, { name: "Usual week", rows: rows.slice(0, 1) });
    expect((await listTemplates(db, scope)).map((t) => [t.name, t.rows.length])).toEqual([
      ["Usual week", 1],
    ]);
    expect(await listTemplates(db, other)).toEqual([]);

    await deleteTemplate(db, scope, saved.id);
    expect(await listTemplates(db, scope)).toEqual([]);
    await expect(deleteTemplate(db, other, saved.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("copies last week's entries seven days later with the same details", async () => {
    const web = await createProject(db, scope, { name: "Web" });
    await entry(scope, "2026-03-02T01:00:00.000Z", 60, { projectId: web.id, description: "a" }); // Mon 09:00
    await entry(scope, "2026-03-04T06:30:00.000Z", 45, { description: "b", billable: true }); // Wed 14:30
    await entry(scope, "2026-03-09T01:00:00.000Z", 30, { description: "already" }); // this week
    await entry(other, "2026-03-02T01:00:00.000Z", 60, { description: "theirs" });

    const copied = await copyWeek(db, scope, {
      fromWeekStart: LAST_WEEK,
      toWeekStart: THIS_WEEK,
      tz: TZ,
    });
    expect(
      copied.map((e) => [e.description, e.start, e.durationSeconds, e.projectId, e.billable]),
    ).toEqual([
      ["a", "2026-03-09T01:00:00.000Z", 3600, web.id, false],
      ["b", "2026-03-11T06:30:00.000Z", 2700, null, true],
    ]);
    const thisWeek = await listEntriesInRange(db, scope, {
      from: THIS_WEEK,
      to: new Date("2026-03-15T16:00:00.000Z"),
    });
    // "a" and "already" start at the same instant, so compare without order.
    expect(thisWeek.map((e) => e.description).sort()).toEqual(["a", "already", "b"]);
  });

  it("copies nothing when a copied detail is no longer usable", async () => {
    const old = await createProject(db, scope, { name: "Old" });
    await entry(scope, "2026-03-02T01:00:00.000Z", 60, { description: "fine" });
    await entry(scope, "2026-03-03T01:00:00.000Z", 60, { projectId: old.id, description: "stale" });
    await updateProject(db, scope, old.id, { archived: true });

    await expect(
      copyWeek(db, scope, { fromWeekStart: LAST_WEEK, toWeekStart: THIS_WEEK, tz: TZ }),
    ).rejects.toMatchObject({ code: "INVALID", message: "This project is archived." });
    const thisWeek = await listEntriesInRange(db, scope, {
      from: THIS_WEEK,
      to: new Date("2026-03-15T16:00:00.000Z"),
    });
    expect(thisWeek).toEqual([]);
  });
});
