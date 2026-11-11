import { randomUUID } from "node:crypto";

import {
  holiday,
  holidayAssignee,
  timeOffPolicy,
  timeOffRequest,
  type NewAssignment,
  assignment,
} from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { addMember, connectTestDb, createTestUser } from "../../../test/db";
import { NOW, type ScheduleCast, setUpScheduleCast } from "../../../test/schedule-fixtures";
import { WorkspaceAccessError } from "../access-error";
import { createAssignment, updateAssignment } from "./assignments";
import { publishSchedule } from "./publish";
import { readSchedule } from "./read";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

let cast: ScheduleCast;
beforeEach(async () => {
  cast = await setUpScheduleCast(db);
});

const WEEK = { from: "2026-11-16", to: "2026-11-22" };

describe("readSchedule", () => {
  it("the working plan shows drafts over the rows they replace; the published plan never shows drafts", async () => {
    const olga = await cast.viewer("olga");
    const id = await createAssignment(db, olga, cast.input("bob", cast.projects.website));
    await publishSchedule(db, olga, NOW);
    const draft = await updateAssignment(db, olga, id, { minutesPerDay: 120 });
    await createAssignment(db, olga, cast.input("ann", cast.projects.mobile));
    const working = await readSchedule(db, olga, { ...WEEK, plan: "working" });
    // The published original is replaced by its draft: two rows, both drafts, never the original.
    expect(working.assignments).toHaveLength(2);
    expect(working.assignments.every((a) => a.draft)).toBe(true);
    expect(working.assignments.map((a) => a.id)).toContain(draft);
    expect(working.assignments.map((a) => a.id)).not.toContain(id);
    expect(working.assignments.find((a) => a.id === draft)!.days["2026-11-16"]).toBe(120);
    expect(working.draftCount).toBe(2);
    const bob = await cast.viewer("bob");
    const published = await readSchedule(db, bob, { ...WEEK, plan: "published" });
    expect(published.assignments.map((a) => [a.id, a.draft, a.days["2026-11-16"]])).toEqual([
      [id, false, 240],
    ]);
  });

  it("a member reads only their own published plan, and the working plan is 403", async () => {
    const olga = await cast.viewer("olga");
    await createAssignment(db, olga, cast.input("bob", cast.projects.website));
    await createAssignment(db, olga, cast.input("ann", cast.projects.mobile));
    await publishSchedule(db, olga, NOW);
    const bob = await cast.viewer("bob");
    const mine = await readSchedule(db, bob, { ...WEEK, plan: "published" });
    expect(mine.people.map((p) => p.userId)).toEqual([cast.ids.bob]);
    expect(mine.assignments.every((a) => a.userId === cast.ids.bob)).toBe(true);
    await expect(readSchedule(db, bob, { ...WEEK, plan: "working" })).rejects.toBeInstanceOf(
      WorkspaceAccessError,
    );
  });

  it("capacity subtracts the person's holidays and approved time off", async () => {
    const olga = await cast.viewer("olga");
    const holidayId = randomUUID();
    await db.insert(holiday).values({
      id: holidayId,
      workspaceId: cast.wsId,
      date: "2026-11-17",
      name: "Cebu Day",
      repeatsYearly: false,
    });
    await db.insert(holidayAssignee).values({ id: randomUUID(), holidayId, groupId: cast.cebuId });
    const policyId = randomUUID();
    await db.insert(timeOffPolicy).values({
      id: policyId,
      workspaceId: cast.wsId,
      name: "Vacation",
      unit: "DAYS",
      accrual: "NONE",
    });
    await db.insert(timeOffRequest).values({
      id: randomUUID(),
      workspaceId: cast.wsId,
      userId: cast.ids.bob,
      policyId,
      startDate: "2026-11-18",
      endDate: "2026-11-18",
      halfDay: true,
      amountCenti: 50,
      status: "APPROVED",
    });
    const s = await readSchedule(db, olga, { ...WEEK, plan: "working" });
    const bob = s.people.find((p) => p.userId === cast.ids.bob)!;
    const ann = s.people.find((p) => p.userId === cast.ids.ann)!;
    expect([
      bob.capacity["2026-11-16"],
      bob.capacity["2026-11-17"],
      bob.capacity["2026-11-18"],
    ]).toEqual([480, 0, 240]);
    expect(bob.holidays["2026-11-17"]).toBe("Cebu Day");
    expect(ann.capacity["2026-11-17"]).toBe(480);
    expect(bob.capacityMinutes).toBe(480 * 4 - 240);
  });

  it("a series partly in range counts only the overlapping occurrences", async () => {
    const olga = await cast.viewer("olga");
    await createAssignment(
      db,
      olga,
      cast.input("bob", cast.projects.website, {
        startDate: "2026-11-02",
        endDate: "2026-11-03",
        repeatWeeks: 2,
        repeatUntil: "2026-11-20",
      }),
    );
    const s = await readSchedule(db, olga, {
      from: "2026-11-10",
      to: "2026-11-30",
      plan: "working",
    });
    const days = s.assignments[0]!.days;
    expect(Object.keys(days).sort()).toEqual(["2026-11-16", "2026-11-17"]);
    expect(s.people.find((p) => p.userId === cast.ids.bob)!.scheduledMinutes).toBe(480);
  });

  it("a project the viewer cannot see shows as Another project", async () => {
    const olga = await cast.viewer("olga");
    await createAssignment(
      db,
      olga,
      cast.input("bob", cast.projects.secret, { note: "top secret" }),
    );
    const max = await cast.viewer("max");
    const s = await readSchedule(db, max, { ...WEEK, plan: "working" });
    const bar = s.assignments.find((a) => a.userId === cast.ids.bob)!;
    expect(bar.project).toBeNull();
    expect([bar.note, bar.editable, bar.task]).toEqual(["", false, null]);
    expect(bar.days["2026-11-16"]).toBe(240);
    expect(JSON.stringify(s)).not.toContain("Secret");
    expect(JSON.stringify(s)).not.toContain(cast.projects.secret);
  });

  it("a manager's rows are themselves, their people and their projects' members", async () => {
    const max = await cast.viewer("max");
    const s = await readSchedule(db, max, { ...WEEK, plan: "working" });
    expect(s.people.map((p) => p.name).sort()).toEqual(["Bob Member", "Max Manager"]);
  });

  it("100 people over 13 weeks read in under 2 seconds", async () => {
    const olga = await cast.viewer("olga");
    const values: NewAssignment[] = [];
    for (let i = 0; i < 100; i += 1) {
      const u = await createTestUser(db, `Person ${i}`);
      await addMember(db, cast.wsId, u.id, "member");
      for (let w = 0; w < 6; w += 1) {
        const start = new Date(Date.UTC(2026, 10, 2 + w * 14)).toISOString().slice(0, 10);
        const end = new Date(Date.UTC(2026, 10, 6 + w * 14)).toISOString().slice(0, 10);
        values.push({
          id: randomUUID(),
          workspaceId: cast.wsId,
          userId: u.id,
          projectId: cast.projects.website,
          startDate: start,
          endDate: end,
          mode: "PER_DAY",
          minutesPerDay: 240,
          published: true,
          ...(w === 0 ? { repeatWeeks: 1, repeatUntil: "2027-01-25" } : {}),
        });
      }
    }
    await db.insert(assignment).values(values);
    const t0 = performance.now();
    const s = await readSchedule(db, olga, {
      from: "2026-11-02",
      to: "2027-01-31",
      plan: "working",
    });
    const ms = performance.now() - t0;
    console.info(
      `readSchedule: ${s.people.length} people, ${s.assignments.length} assignments, ${ms.toFixed(0)} ms`,
    );
    expect(s.people.length).toBeGreaterThanOrEqual(100);
    expect(ms).toBeLessThan(2000);
  });
});
