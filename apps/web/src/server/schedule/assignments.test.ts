import { and, assignment, eq, isNotNull } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb } from "../../../test/db";
import { NOW, type ScheduleCast, setUpScheduleCast } from "../../../test/schedule-fixtures";
import { WorkspaceAccessError } from "../access-error";
import { updateProject } from "../catalog/projects";
import {
  copyAssignment,
  createAssignment,
  deleteAssignment,
  ScheduleError,
  splitAssignmentAt,
  updateAssignment,
} from "./assignments";
import { publishSchedule } from "./publish";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

let cast: ScheduleCast;
beforeEach(async () => {
  cast = await setUpScheduleCast(db);
});

const rows = () => db.select().from(assignment).where(eq(assignment.workspaceId, cast.wsId));

async function status(p: Promise<unknown>): Promise<number | string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof WorkspaceAccessError) return e.status;
    if (e instanceof ScheduleError) return e.message;
    throw e;
  }
}

describe("createAssignment", () => {
  it("a member cannot write assignments", async () => {
    const bob = await cast.viewer("bob");
    expect(await status(createAssignment(db, bob, cast.input("bob", cast.projects.website)))).toBe(
      403,
    );
  });

  it("a manager writes for their people and on their projects, 404 elsewhere", async () => {
    const max = await cast.viewer("max");
    const { website, mobile } = cast.projects;
    expect(await status(createAssignment(db, max, cast.input("bob", mobile)))).toBe("ok");
    expect(await status(createAssignment(db, max, cast.input("ann", website)))).toBe("ok");
    expect(await status(createAssignment(db, max, cast.input("ann", mobile)))).toBe(404);
  });

  it("an archived project, a done task and a private project the person is not on are refused", async () => {
    const olga = await cast.viewer("olga");
    const { website, mobile, secret } = cast.projects;
    // Admins see every project; a manager not on a private one does not.
    expect(await status(createAssignment(db, olga, cast.input("ann", secret)))).toBe("ok");
    expect(await status(createAssignment(db, olga, cast.input("max", secret)))).toBe(
      "Add Max Manager to the project first.",
    );
    expect(await status(createAssignment(db, olga, cast.input("bob", secret)))).toBe("ok");
    const done = await cast.doneTask(website);
    expect(
      await status(createAssignment(db, olga, cast.input("bob", website, { taskId: done }))),
    ).toBe("This task is done.");
    await updateProject(db, olga, mobile, { archived: true });
    expect(await status(createAssignment(db, olga, cast.input("bob", mobile)))).toBe(
      "This project is archived.",
    );
  });

  it("a TOTAL over 24 hours a day is refused", async () => {
    const olga = await cast.viewer("olga");
    const input = cast.input("bob", cast.projects.website, {
      mode: "TOTAL",
      minutesPerDay: null,
      totalMinutes: 5 * 1440 + 1,
    });
    expect(await status(createAssignment(db, olga, input))).toBe(
      "That is more than 24 hours a day.",
    );
  });
});

describe("drafts", () => {
  it("editing a published assignment makes one draft that names it; a second edit edits the draft", async () => {
    const olga = await cast.viewer("olga");
    const id = await createAssignment(db, olga, cast.input("bob", cast.projects.website));
    await publishSchedule(db, olga, NOW);
    const draftId = await updateAssignment(db, olga, id, { minutesPerDay: 300 });
    expect(draftId).not.toBe(id);
    const again = await updateAssignment(db, olga, draftId, { minutesPerDay: 360 });
    expect(again).toBe(draftId);
    const all = await rows();
    expect(all).toHaveLength(2);
    const original = all.find((r) => r.id === id)!;
    const draft = all.find((r) => r.id === draftId)!;
    expect([original.published, original.minutesPerDay]).toEqual([true, 240]);
    expect([draft.published, draft.replacesId, draft.minutesPerDay]).toEqual([false, id, 360]);
    // Editing the published id again goes to the same draft.
    expect(await updateAssignment(db, olga, id, { note: "hi" })).toBe(draftId);
  });

  it("deleting a published assignment leaves a tombstone until publish", async () => {
    const olga = await cast.viewer("olga");
    const id = await createAssignment(db, olga, cast.input("bob", cast.projects.website));
    await publishSchedule(db, olga, NOW);
    await deleteAssignment(db, olga, id);
    const tomb = await db
      .select()
      .from(assignment)
      .where(and(eq(assignment.workspaceId, cast.wsId), isNotNull(assignment.replacesId)));
    expect(tomb.map((t) => [t.deleted, t.replacesId])).toEqual([[true, id]]);
    await publishSchedule(db, olga, NOW);
    expect(await rows()).toHaveLength(0);
  });

  it("deleting a new draft removes it", async () => {
    const olga = await cast.viewer("olga");
    const id = await createAssignment(db, olga, cast.input("bob", cast.projects.website));
    await deleteAssignment(db, olga, id);
    expect(await rows()).toHaveLength(0);
  });

  it("copy and split", async () => {
    const olga = await cast.viewer("olga");
    const id = await createAssignment(
      db,
      olga,
      cast.input("bob", cast.projects.website, {
        mode: "TOTAL",
        minutesPerDay: null,
        totalMinutes: 1000,
      }),
    );
    const copy = await copyAssignment(db, olga, id, {
      userId: cast.ids.ann,
      startDate: "2026-11-23",
    });
    const [first, second] = await splitAssignmentAt(db, olga, id, "2026-11-19");
    expect(first).toBe(id);
    const all = await rows();
    const byId = new Map(all.map((r) => [r.id, r]));
    expect([byId.get(first)!.endDate, byId.get(first)!.totalMinutes]).toEqual(["2026-11-18", 600]);
    expect([byId.get(second)!.startDate, byId.get(second)!.totalMinutes]).toEqual([
      "2026-11-19",
      400,
    ]);
    expect([byId.get(copy)!.userId, byId.get(copy)!.startDate, byId.get(copy)!.endDate]).toEqual([
      cast.ids.ann,
      "2026-11-23",
      "2026-11-27",
    ]);
    const series = await createAssignment(
      db,
      olga,
      cast.input("bob", cast.projects.website, { repeatWeeks: 1, repeatUntil: "2026-12-31" }),
    );
    expect(await status(splitAssignmentAt(db, olga, series, "2026-11-18"))).toBe(
      "Split works on a single assignment; edit the series instead.",
    );
  });

  it("an assignment outside the manager's scope is not found", async () => {
    const olga = await cast.viewer("olga");
    const max = await cast.viewer("max");
    const id = await createAssignment(db, olga, cast.input("ann", cast.projects.mobile));
    expect(await status(updateAssignment(db, max, id, { note: "x" }))).toBe(404);
    expect(await status(deleteAssignment(db, max, id))).toBe(404);
  });
});
