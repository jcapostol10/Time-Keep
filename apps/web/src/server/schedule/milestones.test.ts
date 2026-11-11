import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb } from "../../../test/db";
import { type ScheduleCast, setUpScheduleCast } from "../../../test/schedule-fixtures";
import { WorkspaceAccessError } from "../access-error";
import { createMilestone, deleteMilestone, listMilestones, updateMilestone } from "./milestones";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

let cast: ScheduleCast;
beforeEach(async () => {
  cast = await setUpScheduleCast(db);
});

const RANGE = { from: "2026-11-01", to: "2026-11-30" };

describe("milestones", () => {
  it("project managers manage milestones on their projects only", async () => {
    const max = await cast.viewer("max");
    const id = await createMilestone(db, max, {
      projectId: cast.projects.website,
      date: "2026-11-20",
      name: "Launch",
    });
    await updateMilestone(db, max, id, { name: "Go live" });
    await expect(
      createMilestone(db, max, { projectId: cast.projects.mobile, date: "2026-11-20", name: "X" }),
    ).rejects.toMatchObject({ status: 404 });
    const bob = await cast.viewer("bob");
    await expect(deleteMilestone(db, bob, id)).rejects.toBeInstanceOf(WorkspaceAccessError);
    const list = await listMilestones(db, max, RANGE);
    expect(list.map((m) => [m.name, m.editable])).toEqual([["Go live", true]]);
    await deleteMilestone(db, max, id);
    expect(await listMilestones(db, max, RANGE)).toEqual([]);
  });

  it("listMilestones filters by visible projects", async () => {
    const olga = await cast.viewer("olga");
    await createMilestone(db, olga, {
      projectId: cast.projects.secret,
      date: "2026-11-20",
      name: "S",
    });
    await createMilestone(db, olga, {
      projectId: cast.projects.mobile,
      date: "2026-11-21",
      name: "M",
    });
    const max = await cast.viewer("max");
    expect((await listMilestones(db, max, RANGE)).map((m) => [m.name, m.editable])).toEqual([
      ["M", false],
    ]);
    expect((await listMilestones(db, olga, RANGE)).map((m) => m.name)).toEqual(["S", "M"]);
  });
});
