import { and, assignment, assignmentPublish, emailOutbox, eq, like } from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb } from "../../../test/db";
import { NOW, type ScheduleCast, setUpScheduleCast } from "../../../test/schedule-fixtures";
import { createAssignment, deleteAssignment, updateAssignment } from "./assignments";
import { discardDrafts, publishSchedule } from "./publish";
import { readSchedule } from "./read";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

let cast: ScheduleCast;
beforeEach(async () => {
  cast = await setUpScheduleCast(db);
});

const rows = () => db.select().from(assignment).where(eq(assignment.workspaceId, cast.wsId));
const outbox = () =>
  db
    .select()
    .from(emailOutbox)
    .where(
      and(eq(emailOutbox.workspaceId, cast.wsId), like(emailOutbox.kind, "schedule.published:%")),
    );

describe("publishSchedule", () => {
  it("publish applies replace, tombstone and new drafts in scope and logs the publish", async () => {
    const olga = await cast.viewer("olga");
    const { website, mobile } = cast.projects;
    const a = await createAssignment(db, olga, cast.input("bob", website));
    const b = await createAssignment(db, olga, cast.input("ann", mobile));
    expect((await publishSchedule(db, olga, NOW)).changed).toBe(2);
    await updateAssignment(db, olga, a, { minutesPerDay: 120 });
    await deleteAssignment(db, olga, b);
    const c = await createAssignment(db, olga, cast.input("max", mobile));
    expect((await publishSchedule(db, olga, NOW)).changed).toBe(3);
    const all = await rows();
    expect(all.every((r) => r.published && !r.deleted && r.replacesId === null)).toBe(true);
    expect(all.map((r) => r.userId).sort()).toEqual([cast.ids.bob, cast.ids.max].sort());
    expect(all.find((r) => r.userId === cast.ids.bob)!.minutesPerDay).toBe(120);
    expect(all.some((r) => r.id === c)).toBe(true);
    const log = await db
      .select()
      .from(assignmentPublish)
      .where(eq(assignmentPublish.workspaceId, cast.wsId));
    expect(log.map((l) => l.changedCount).sort()).toEqual([2, 3]);
  });

  it("a manager's publish leaves drafts outside their scope as drafts", async () => {
    const olga = await cast.viewer("olga");
    const max = await cast.viewer("max");
    await createAssignment(db, olga, cast.input("ann", cast.projects.mobile));
    await createAssignment(db, max, cast.input("bob", cast.projects.mobile));
    expect((await publishSchedule(db, max, NOW)).changed).toBe(1);
    const all = await rows();
    expect(all.find((r) => r.userId === cast.ids.ann)!.published).toBe(false);
    expect(all.find((r) => r.userId === cast.ids.bob)!.published).toBe(true);
  });

  it("two concurrent publishes apply each draft once", async () => {
    const olga = await cast.viewer("olga");
    const ann = await cast.viewer("ann");
    const id = await createAssignment(db, olga, cast.input("bob", cast.projects.website));
    await publishSchedule(db, olga, NOW);
    await updateAssignment(db, olga, id, { minutesPerDay: 60 });
    await createAssignment(db, olga, cast.input("ann", cast.projects.mobile));
    const other = connectTestDb();
    try {
      const results = await Promise.all([
        publishSchedule(db, olga, NOW),
        publishSchedule(other.db, ann, NOW),
      ]);
      expect(results.map((r) => r.changed).sort()).toEqual([0, 2]);
    } finally {
      await other.close();
    }
    const all = await rows();
    expect(all).toHaveLength(2);
    expect(all.every((r) => r.published)).toBe(true);
  });

  it("each changed person gets one email listing the next 28 days", async () => {
    const olga = await cast.viewer("olga");
    const { website, mobile } = cast.projects;
    await createAssignment(db, olga, cast.input("bob", website));
    await createAssignment(
      db,
      olga,
      cast.input("bob", mobile, { startDate: "2026-12-11", endDate: "2026-12-11" }),
    );
    await createAssignment(db, olga, cast.input("ann", mobile));
    await publishSchedule(db, olga, NOW);
    const mail = await outbox();
    expect(mail).toHaveLength(2);
    const bob = mail.find((m) => m.toAddress.startsWith("bob.member"))!;
    expect(bob.text).toContain("Website");
    expect(bob.text).toContain("4:00 a day");
    // 11 Dec is 30 days after 11 Nov: outside the four weeks.
    expect(bob.text).not.toContain("Mobile");
    expect(bob.subject).toBe("Your schedule in Workspace was updated");
  });

  it("a manager's edits then delete stay drafts until publish, which emails what remains", async () => {
    const olga = await cast.viewer("olga");
    const max = await cast.viewer("max");
    const id = await createAssignment(db, olga, cast.input("bob", cast.projects.website));
    await publishSchedule(db, olga, NOW);
    const draft = await updateAssignment(db, max, id, { minutesPerDay: 120 });
    expect(await updateAssignment(db, max, draft, { minutesPerDay: 60 })).toBe(draft);
    await deleteAssignment(db, max, draft);
    const bob = await cast.viewer("bob");
    const before = await readSchedule(db, bob, {
      from: "2026-11-16",
      to: "2026-11-22",
      plan: "published",
    });
    expect(before.assignments.map((a) => [a.id, a.days["2026-11-16"]])).toEqual([[id, 240]]);
    expect((await publishSchedule(db, max, NOW)).changed).toBe(1);
    expect(await rows()).toHaveLength(0);
    const mail = await outbox();
    const last = mail.find((m) => !m.text.includes("Website"));
    expect(last?.text).toContain("You have nothing scheduled in Workspace in the next four weeks.");
  });

  it("discard drops only the drafts the actor made", async () => {
    const olga = await cast.viewer("olga");
    const max = await cast.viewer("max");
    const theirs = await createAssignment(db, olga, cast.input("bob", cast.projects.website));
    await createAssignment(db, max, cast.input("bob", cast.projects.mobile));
    expect(await discardDrafts(db, max)).toBe(1);
    expect((await rows()).map((r) => r.id)).toEqual([theirs]);
  });

  it("discard restores the published plan", async () => {
    const olga = await cast.viewer("olga");
    const id = await createAssignment(db, olga, cast.input("bob", cast.projects.website));
    await publishSchedule(db, olga, NOW);
    await updateAssignment(db, olga, id, { minutesPerDay: 60 });
    await createAssignment(db, olga, cast.input("ann", cast.projects.mobile));
    expect(await discardDrafts(db, olga)).toBe(2);
    const all = await rows();
    expect(all.map((r) => [r.id, r.published, r.minutesPerDay])).toEqual([[id, true, 240]]);
  });
});
