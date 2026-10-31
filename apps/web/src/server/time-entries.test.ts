import { randomUUID } from "node:crypto";

import { type EntryDetails, MAX_ENTRY_SECONDS } from "@timekeep/core";
import { and, count, eq, isNull, project, projectMember, sql, tag, task, timeEntry } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
  asViewer,
} from "../../test/db";
import { createProject, listPickerProjects } from "./catalog/projects";
import { createTag, listTags } from "./catalog/tags";
import {
  continueEntry,
  createManualEntry,
  countProjectEntries,
  deleteEntries,
  duplicateEntry,
  type EntryScope,
  getRunningEntry,
  listEntriesInRange,
  listEntriesPage,
  listRecentDescriptions,
  reassignProjectEntries,
  restoreEntries,
  softDeleteProjectEntries,
  startTimer,
  stopTimer,
  TimeEntryError,
  updateEntry,
} from "./time-entries";

const handle = connectTestDb();
const db = handle.db;

const NOW = new Date("2026-03-11T04:00:00.000Z"); // Wed 2026-03-11 12:00 Asia/Manila
const minutes = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

async function expectEntryError(promise: Promise<unknown>, code: TimeEntryError["code"]) {
  await expect(promise).rejects.toBeInstanceOf(TimeEntryError);
  await promise.catch((error: TimeEntryError) => expect(error.code).toBe(code));
}

async function countRunning(scope: EntryScope) {
  const [row] = await db
    .select({ n: count() })
    .from(timeEntry)
    .where(
      and(
        eq(timeEntry.workspaceId, scope.workspaceId),
        eq(timeEntry.userId, scope.userId),
        isNull(timeEntry.end),
        isNull(timeEntry.deletedAt),
      ),
    );
  return row?.n ?? 0;
}

let scope: EntryScope;
let otherScope: EntryScope;
let memberScope: EntryScope;

describe("time entries service", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const alice = await createTestUser(db, "Alice A");
    const bob = await createTestUser(db, "Bob B");
    const ws = await createTestWorkspace(db, "Workspace A", alice.id);
    const wsB = await createTestWorkspace(db, "Workspace B", bob.id);
    const carol = await createTestUser(db, "Carol C");
    await addMember(db, ws.id, carol.id, "member");
    scope = asViewer({ workspaceId: ws.id, userId: alice.id, role: "owner" });
    otherScope = asViewer({ workspaceId: wsB.id, userId: bob.id, role: "owner" });
    memberScope = asViewer({ workspaceId: ws.id, userId: carol.id, role: "member" });
  });

  describe("startTimer", () => {
    it("creates a running entry with the given details", async () => {
      const project = await createProject(db, scope, { name: "Website" });
      const tag = await createTag(db, scope.workspaceId, { name: "design" });

      const { started, stopped } = await startTimer(
        db,
        scope,
        {
          description: "Design review",
          projectId: project.id,
          taskId: null,
          tagIds: [tag.id],
          billable: true,
        },
        NOW,
      );

      expect(stopped).toBeNull();
      expect(started).toMatchObject({
        description: "Design review",
        projectId: project.id,
        project: { id: project.id, name: "Website" },
        tagIds: [tag.id],
        tags: [{ id: tag.id, name: "design" }],
        billable: true,
        start: NOW.toISOString(),
        end: null,
        durationSeconds: null,
      });
      expect(await getRunningEntry(db, scope)).toMatchObject({ id: started.id });
      expect(await getRunningEntry(db, otherScope)).toBeNull();
    });

    it("stops the running entry atomically and leaves exactly one running", async () => {
      const first = await startTimer(
        db,
        scope,
        { description: "First", projectId: null, taskId: null, tagIds: [], billable: false },
        NOW,
      );
      const second = await startTimer(
        db,
        scope,
        { description: "Second", projectId: null, taskId: null, tagIds: [], billable: false },
        at(NOW, minutes(10)),
      );

      expect(second.stopped).toMatchObject({
        id: first.started.id,
        end: at(NOW, minutes(10)).toISOString(),
        durationSeconds: 600,
      });
      expect(await countRunning(scope)).toBe(1);
      expect((await getRunningEntry(db, scope))?.id).toBe(second.started.id);
    });

    it("two concurrent start requests leave exactly one running entry", async () => {
      const second = connectTestDb();
      try {
        const results = await Promise.allSettled([
          startTimer(db, scope, {
            description: "A",
            projectId: null,
            taskId: null,
            tagIds: [],
            billable: false,
          }),
          startTimer(second.db, scope, {
            description: "B",
            projectId: null,
            taskId: null,
            tagIds: [],
            billable: false,
          }),
        ]);
        const rejected = results.filter((r) => r.status === "rejected");
        expect(rejected.length).toBeLessThanOrEqual(1);
        for (const r of rejected) {
          expect(r.status === "rejected" && r.reason).toBeInstanceOf(TimeEntryError);
        }
        expect(await countRunning(scope)).toBe(1);
      } finally {
        await second.close();
      }
    });

    it("rejects a project or tag from another workspace", async () => {
      const foreignProject = await createProject(db, otherScope, { name: "Theirs" });
      const foreignTag = await createTag(db, otherScope.workspaceId, { name: "theirs" });
      await expectEntryError(
        startTimer(db, scope, {
          description: "",
          projectId: foreignProject.id,
          taskId: null,
          tagIds: [],
          billable: false,
        }),
        "INVALID",
      );
      await expectEntryError(
        startTimer(db, scope, {
          description: "",
          projectId: null,
          taskId: null,
          tagIds: [foreignTag.id],
          billable: false,
        }),
        "INVALID",
      );
      expect(await countRunning(scope)).toBe(0);
    });
  });

  describe("partial unique index", () => {
    it("rejects a second running row at the database level", async () => {
      const base = { workspaceId: scope.workspaceId, userId: scope.userId, start: NOW, end: null };
      await db.insert(timeEntry).values({ id: randomUUID(), ...base });
      const err = await db
        .insert(timeEntry)
        .values({ id: randomUUID(), ...base })
        .then(() => null)
        .catch((e: unknown) => e);
      const code = ((err as { cause?: { code?: string } })?.cause ?? (err as { code?: string }))
        ?.code;
      expect(code).toBe("23505");
    });

    it("ignores soft-deleted running rows", async () => {
      const base = { workspaceId: scope.workspaceId, userId: scope.userId, start: NOW, end: null };
      await db.insert(timeEntry).values({ id: randomUUID(), ...base, deletedAt: NOW });
      await expect(
        db.insert(timeEntry).values({ id: randomUUID(), ...base }),
      ).resolves.toBeDefined();
    });
  });

  describe("stopTimer", () => {
    it("sets end and duration", async () => {
      const { started } = await startTimer(
        db,
        scope,
        { description: "", projectId: null, taskId: null, tagIds: [], billable: false },
        NOW,
      );
      const stopped = await stopTimer(db, scope, { entryId: started.id }, at(NOW, 135_000));
      expect(stopped).toMatchObject({ end: at(NOW, 135_000).toISOString(), durationSeconds: 135 });
      expect(await getRunningEntry(db, scope)).toBeNull();
    });

    it("accepts an explicit earlier end (idle discard) and is idempotent", async () => {
      const { started } = await startTimer(
        db,
        scope,
        { description: "", projectId: null, taskId: null, tagIds: [], billable: false },
        NOW,
      );
      const stopped = await stopTimer(
        db,
        scope,
        { entryId: started.id, end: at(NOW, minutes(5)) },
        at(NOW, minutes(20)),
      );
      expect(stopped.durationSeconds).toBe(300);
      const again = await stopTimer(db, scope, { entryId: started.id }, at(NOW, minutes(30)));
      expect(again.durationSeconds).toBe(300);
    });

    it("rejects an end more than a minute in the future", async () => {
      const { started } = await startTimer(
        db,
        scope,
        { description: "", projectId: null, taskId: null, tagIds: [], billable: false },
        NOW,
      );
      await expectEntryError(
        stopTimer(db, scope, { entryId: started.id, end: at(NOW, minutes(2)) }, NOW),
        "INVALID",
      );
    });

    it("clamps a forgotten timer at 999 hours", async () => {
      const start = at(NOW, -hours(1000));
      const { started } = await startTimer(
        db,
        scope,
        { description: "", projectId: null, taskId: null, tagIds: [], billable: false },
        start,
      );
      const stopped = await stopTimer(db, scope, { entryId: started.id }, NOW);
      expect(stopped.durationSeconds).toBe(MAX_ENTRY_SECONDS);
      expect(stopped.end).toBe(at(start, MAX_ENTRY_SECONDS * 1000).toISOString());
    });

    it("never touches another user's entry", async () => {
      const { started } = await startTimer(
        db,
        otherScope,
        { description: "", projectId: null, taskId: null, tagIds: [], billable: false },
        NOW,
      );
      await expectEntryError(stopTimer(db, scope, { entryId: started.id }, NOW), "NOT_FOUND");
      expect(await countRunning(otherScope)).toBe(1);
    });
  });

  describe("createManualEntry", () => {
    const details = {
      description: "Manual",
      projectId: null,
      taskId: null,
      tagIds: [],
      billable: false,
    };

    it("creates a stopped entry with its duration", async () => {
      const entry = await createManualEntry(
        db,
        scope,
        { ...details, start: NOW, end: at(NOW, hours(1.5)) },
        NOW,
      );
      expect(entry).toMatchObject({
        description: "Manual",
        durationSeconds: 5400,
        end: at(NOW, hours(1.5)).toISOString(),
      });
    });

    it("validates the range", async () => {
      await expectEntryError(
        createManualEntry(db, scope, { ...details, start: NOW, end: NOW }, NOW),
        "INVALID",
      );
      await expectEntryError(
        createManualEntry(db, scope, { ...details, start: NOW, end: at(NOW, hours(1000)) }, NOW),
        "INVALID",
      );
    });

    it("allows entries in the future", async () => {
      const entry = await createManualEntry(
        db,
        scope,
        { ...details, start: at(NOW, hours(24)), end: at(NOW, hours(25)) },
        NOW,
      );
      expect(entry.durationSeconds).toBe(3600);
    });
  });

  describe("concurrent writes", () => {
    const details = {
      description: "Work",
      projectId: null,
      taskId: null,
      tagIds: [],
      billable: false,
    };

    /**
     * Another connection locks the running row, stops it, and commits only
     * after `write` has been issued. `write` must not undo the stop.
     */
    async function stopElsewhereWhile(entryId: string, write: () => Promise<unknown>) {
      const other = connectTestDb();
      const client = await other.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT id FROM time_entry WHERE id = $1 FOR UPDATE`, [entryId]);
        await client.query(
          `UPDATE time_entry SET "end" = start + interval '5 minutes', duration_seconds = 300 WHERE id = $1`,
          [entryId],
        );
        const pending = write().then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        await client.query("COMMIT");
        return await pending;
      } finally {
        client.release();
        await other.close();
      }
    }

    it("a details-only edit does not restart a timer stopped meanwhile", async () => {
      const { started } = await startTimer(db, scope, details, at(NOW, -minutes(10)));
      await stopElsewhereWhile(started.id, () =>
        updateEntry(db, scope, started.id, { description: "Renamed" }, NOW),
      );
      const row = await db.query.timeEntry.findFirst({ where: eq(timeEntry.id, started.id) });
      expect(row?.description).toBe("Renamed");
      expect(row?.end).not.toBeNull();
      expect(row?.durationSeconds).toBe(300);
      expect(await countRunning(scope)).toBe(0);
    });

    it("a stop racing another stop keeps the first end", async () => {
      const { started } = await startTimer(db, scope, details, at(NOW, -minutes(10)));
      await stopElsewhereWhile(started.id, () =>
        stopTimer(db, scope, { entryId: started.id }, NOW),
      );
      const row = await db.query.timeEntry.findFirst({ where: eq(timeEntry.id, started.id) });
      expect(row?.durationSeconds).toBe(300);
    });
  });

  describe("updateEntry", () => {
    const details = {
      description: "Manual",
      projectId: null,
      taskId: null,
      tagIds: [],
      billable: false,
    };

    it("recomputes the duration when times change", async () => {
      const entry = await createManualEntry(
        db,
        scope,
        { ...details, start: NOW, end: at(NOW, hours(1)) },
        NOW,
      );
      const updated = await updateEntry(db, scope, entry.id, { end: at(NOW, hours(2)) }, NOW);
      expect(updated.durationSeconds).toBe(7200);
      await expectEntryError(
        updateEntry(db, scope, entry.id, { start: at(NOW, hours(3)) }, NOW),
        "INVALID",
      );
    });

    it("replaces tags and details", async () => {
      const t1 = await createTag(db, scope.workspaceId, { name: "one" });
      const t2 = await createTag(db, scope.workspaceId, { name: "two" });
      const project = await createProject(db, scope, { name: "P" });
      const entry = await createManualEntry(
        db,
        scope,
        { ...details, tagIds: [t1.id], start: NOW, end: at(NOW, hours(1)) },
        NOW,
      );
      const updated = await updateEntry(
        db,
        scope,
        entry.id,
        { description: "Edited", tagIds: [t2.id], projectId: project.id, billable: true },
        NOW,
      );
      expect(updated).toMatchObject({
        description: "Edited",
        tagIds: [t2.id],
        tags: [{ id: t2.id, name: "two" }],
        projectId: project.id,
        billable: true,
      });
    });

    it("can edit a running entry's details but not move its start into the future", async () => {
      const { started } = await startTimer(db, scope, details, NOW);
      const updated = await updateEntry(
        db,
        scope,
        started.id,
        { description: "Renamed" },
        at(NOW, minutes(1)),
      );
      expect(updated).toMatchObject({ description: "Renamed", end: null });
      await expectEntryError(
        updateEntry(db, scope, started.id, { start: at(NOW, minutes(10)) }, at(NOW, minutes(1))),
        "INVALID",
      );
      const moved = await updateEntry(
        db,
        scope,
        started.id,
        { start: at(NOW, -minutes(10)) },
        at(NOW, minutes(1)),
      );
      expect(moved.start).toBe(at(NOW, -minutes(10)).toISOString());
    });

    it("is scoped to the user", async () => {
      const theirs = await createManualEntry(
        db,
        otherScope,
        { ...details, start: NOW, end: at(NOW, hours(1)) },
        NOW,
      );
      await expectEntryError(
        updateEntry(db, scope, theirs.id, { description: "x" }, NOW),
        "NOT_FOUND",
      );
    });
  });

  describe("delete, restore, duplicate, continue", () => {
    const details = {
      description: "Work",
      projectId: null,
      taskId: null,
      tagIds: [],
      billable: true,
    };

    it("soft-deletes stopped entries only, and restores them", async () => {
      const a = await createManualEntry(
        db,
        scope,
        { ...details, start: at(NOW, -hours(3)), end: at(NOW, -hours(2)) },
        NOW,
      );
      const b = await createManualEntry(
        db,
        scope,
        { ...details, start: at(NOW, -hours(2)), end: at(NOW, -hours(1)) },
        NOW,
      );
      const theirs = await createManualEntry(
        db,
        otherScope,
        { ...details, start: at(NOW, -hours(2)), end: at(NOW, -hours(1)) },
        NOW,
      );
      const { started: running } = await startTimer(db, scope, details, NOW);

      const result = await deleteEntries(db, scope, [a.id, b.id, theirs.id, running.id]);
      expect(result.deleted.sort()).toEqual([a.id, b.id].sort());

      const page = await listEntriesPage(db, scope, { tz: "Asia/Manila", weekStart: 1, now: NOW });
      expect(page.entries).toHaveLength(0);
      expect(await countRunning(scope)).toBe(1);
      await expectEntryError(updateEntry(db, scope, a.id, { description: "x" }, NOW), "NOT_FOUND");

      const restored = await restoreEntries(db, scope, [a.id, theirs.id]);
      expect(restored.restored).toEqual([a.id]);
      const after = await listEntriesPage(db, scope, { tz: "Asia/Manila", weekStart: 1, now: NOW });
      expect(after.entries.map((e) => e.id)).toEqual([a.id]);
    });

    it("duplicates an entry with the same times and details", async () => {
      const tag = await createTag(db, scope.workspaceId, { name: "dup" });
      const a = await createManualEntry(
        db,
        scope,
        { ...details, tagIds: [tag.id], start: at(NOW, -hours(3)), end: at(NOW, -hours(2)) },
        NOW,
      );
      const copy = await duplicateEntry(db, scope, a.id);
      expect(copy.id).not.toBe(a.id);
      expect(copy).toMatchObject({
        description: "Work",
        start: a.start,
        end: a.end,
        durationSeconds: 3600,
        tagIds: [tag.id],
        billable: true,
      });
    });

    it("continue starts a new timer with the entry's details", async () => {
      const project = await createProject(db, scope, { name: "P" });
      const a = await createManualEntry(
        db,
        scope,
        { ...details, projectId: project.id, start: at(NOW, -hours(3)), end: at(NOW, -hours(2)) },
        NOW,
      );
      const { started } = await continueEntry(db, scope, a.id, NOW);
      expect(started).toMatchObject({
        description: "Work",
        projectId: project.id,
        billable: true,
        end: null,
        start: NOW.toISOString(),
      });
      await expectEntryError(continueEntry(db, scope, "nope", NOW), "NOT_FOUND");
    });
  });

  describe("listEntriesPage (Asia/Manila, Monday weeks)", () => {
    const details = {
      description: "Work",
      projectId: null,
      taskId: null,
      tagIds: [],
      billable: false,
    };
    const opts = { tz: "Asia/Manila", weekStart: 1 as const, now: NOW };

    async function seedWeeks() {
      const e1 = await createManualEntry(
        db,
        scope,
        {
          ...details,
          description: "Tue",
          start: new Date("2026-03-10T01:00:00Z"),
          end: new Date("2026-03-10T02:00:00Z"),
        },
        NOW,
      );
      // 23:30 -> 00:30 Manila, March 9/10: stays one entry under March 9
      const e2 = await createManualEntry(
        db,
        scope,
        {
          ...details,
          description: "Midnight",
          start: new Date("2026-03-09T15:30:00Z"),
          end: new Date("2026-03-09T16:30:00Z"),
        },
        NOW,
      );
      const e3 = await createManualEntry(
        db,
        scope,
        {
          ...details,
          description: "Last week",
          start: new Date("2026-03-04T01:00:00Z"),
          end: new Date("2026-03-04T02:00:00Z"),
        },
        NOW,
      );
      const e4 = await createManualEntry(
        db,
        scope,
        {
          ...details,
          description: "Weeks ago",
          start: new Date("2026-02-18T01:00:00Z"),
          end: new Date("2026-02-18T02:00:00Z"),
        },
        NOW,
      );
      await startTimer(db, scope, { ...details, description: "Running" }, at(NOW, -minutes(10)));
      await createManualEntry(
        db,
        otherScope,
        {
          ...details,
          description: "Theirs",
          start: new Date("2026-03-10T01:00:00Z"),
          end: new Date("2026-03-10T02:00:00Z"),
        },
        NOW,
      );
      return { e1, e2, e3, e4 };
    }

    it("returns the current week newest first, without the running entry", async () => {
      const { e1, e2 } = await seedWeeks();
      const page = await listEntriesPage(db, scope, opts);
      expect(page.weekStart).toBe("2026-03-08T16:00:00.000Z");
      expect(page.weekEnd).toBe("2026-03-15T16:00:00.000Z");
      expect(page.entries.map((e) => e.id)).toEqual([e1.id, e2.id]);
      expect(page.nextCursor).toBe("2026-03-08T16:00:00.000Z");
    });

    it("walks back week by week, skipping empty weeks, and ends with a null cursor", async () => {
      const { e3, e4 } = await seedWeeks();
      const page2 = await listEntriesPage(db, scope, {
        ...opts,
        before: new Date("2026-03-08T16:00:00.000Z"),
      });
      expect(page2.weekStart).toBe("2026-03-01T16:00:00.000Z");
      expect(page2.entries.map((e) => e.id)).toEqual([e3.id]);
      expect(page2.nextCursor).toBe("2026-03-01T16:00:00.000Z");

      const page3 = await listEntriesPage(db, scope, {
        ...opts,
        before: new Date(page2.nextCursor!),
      });
      expect(page3.weekStart).toBe("2026-02-15T16:00:00.000Z");
      expect(page3.entries.map((e) => e.id)).toEqual([e4.id]);
      expect(page3.nextCursor).toBeNull();

      const page4 = await listEntriesPage(db, scope, {
        ...opts,
        before: new Date("2026-02-15T16:00:00.000Z"),
      });
      expect(page4.entries).toEqual([]);
      expect(page4.nextCursor).toBeNull();
    });

    it("the first page also carries entries after the current week (manual future entries)", async () => {
      const { e1 } = await seedWeeks();
      const nextWeek = await createManualEntry(
        db,
        scope,
        {
          ...details,
          description: "Next week",
          start: new Date("2026-03-17T01:00:00Z"),
          end: new Date("2026-03-17T02:00:00Z"),
        },
        NOW,
      );
      const page = await listEntriesPage(db, scope, opts);
      expect(page.weekStart).toBe("2026-03-08T16:00:00.000Z");
      expect(page.weekEnd).toBe("2026-03-15T16:00:00.000Z");
      expect(page.entries.map((e) => e.id).slice(0, 2)).toEqual([nextWeek.id, e1.id]);
    });

    it("returns an empty current week with no cursor when the user has no entries", async () => {
      const page = await listEntriesPage(db, scope, opts);
      expect(page.entries).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });
  });

  describe("listRecentDescriptions", () => {
    it("is distinct, newest first, and carries the details of the latest use", async () => {
      const p1 = await createProject(db, scope, { name: "P1" });
      const p2 = await createProject(db, scope, { name: "P2" });
      const tag = await createTag(db, scope.workspaceId, { name: "t" });
      const base = { taskId: null, billable: false };
      await createManualEntry(
        db,
        scope,
        {
          ...base,
          description: "Design review",
          projectId: p1.id,
          tagIds: [tag.id],
          billable: true,
          start: new Date("2026-03-09T01:00:00Z"),
          end: new Date("2026-03-09T02:00:00Z"),
        },
        NOW,
      );
      await createManualEntry(
        db,
        scope,
        {
          ...base,
          description: "Standup",
          projectId: null,
          tagIds: [],
          start: new Date("2026-03-10T01:00:00Z"),
          end: new Date("2026-03-10T01:15:00Z"),
        },
        NOW,
      );
      await createManualEntry(
        db,
        scope,
        {
          ...base,
          description: "Design review",
          projectId: p2.id,
          tagIds: [],
          start: new Date("2026-03-10T03:00:00Z"),
          end: new Date("2026-03-10T04:00:00Z"),
        },
        NOW,
      );
      await createManualEntry(
        db,
        scope,
        {
          ...base,
          description: "",
          projectId: null,
          tagIds: [],
          start: new Date("2026-03-10T05:00:00Z"),
          end: new Date("2026-03-10T06:00:00Z"),
        },
        NOW,
      );
      await createManualEntry(
        db,
        otherScope,
        {
          ...base,
          description: "Theirs",
          projectId: null,
          tagIds: [],
          start: new Date("2026-03-10T05:00:00Z"),
          end: new Date("2026-03-10T06:00:00Z"),
        },
        NOW,
      );

      const recent = await listRecentDescriptions(db, scope);
      expect(recent.map((r) => r.description)).toEqual(["Design review", "Standup"]);
      expect(recent[0]).toMatchObject({
        projectId: p2.id,
        tagIds: [],
        billable: false,
        lastUsedAt: "2026-03-10T03:00:00.000Z",
      });
    });
  });

  describe("projects and tags", () => {
    it("projects are unique per client; tags are find-or-create", async () => {
      const a = await createProject(db, scope, { name: "Zeta" });
      const b = await createProject(db, scope, { name: "Alpha", color: "#123456" });
      await expect(createProject(db, scope, { name: "Zeta" })).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(b.color).toBe("#123456");
      expect(a.color).toMatch(/^#[0-9a-f]{6}$/);
      expect((await listPickerProjects(db, scope)).map((p) => p.name)).toEqual(["Alpha", "Zeta"]);
      expect(await listPickerProjects(db, otherScope)).toEqual([]);

      const t = await createTag(db, scope.workspaceId, { name: "dev" });
      expect((await createTag(db, scope.workspaceId, { name: "dev" })).id).toBe(t.id);
      expect(
        (await listTags(db, scope.workspaceId, { includeArchived: false })).map((x) => x.name),
      ).toEqual(["dev"]);
    });
  });

  describe("Phase 2 details", () => {
    const details = (over: Partial<EntryDetails> = {}): EntryDetails => ({
      description: "Work",
      projectId: null,
      taskId: null,
      tagIds: [],
      type: "work",
      billable: false,
      ...over,
    });
    const manual = (over: Partial<EntryDetails> = {}, offsetMin = 0) => ({
      ...details(over),
      start: at(NOW, minutes(offsetMin)),
      end: at(NOW, minutes(offsetMin + 30)),
    });
    async function expectMessage(promise: Promise<unknown>, message: string) {
      await expect(promise).rejects.toMatchObject({ code: "INVALID", message });
    }
    async function addTask(projectId: string, name: string, status: "ACTIVE" | "DONE" = "ACTIVE") {
      const id = randomUUID();
      await db.insert(task).values({ id, workspaceId: scope.workspaceId, projectId, name, status });
      return id;
    }
    const range = (s: EntryScope) =>
      listEntriesInRange(db, s, { from: at(NOW, hours(-3)), to: at(NOW, hours(3)) });

    it("a private project is usable by its members and invisible to others", async () => {
      const secret = await createProject(db, scope, { name: "Secret", visibility: "PRIVATE" });
      await expectMessage(
        startTimer(db, memberScope, details({ projectId: secret.id }), NOW),
        "Project not found.",
      );
      expect(await countRunning(memberScope)).toBe(0);
      await db.insert(projectMember).values({ projectId: secret.id, userId: memberScope.userId });
      const { started } = await startTimer(db, memberScope, details({ projectId: secret.id }), NOW);
      expect(started.projectId).toBe(secret.id);
      // Admins never need membership.
      const asOwner = await createManualEntry(db, scope, manual({ projectId: secret.id }));
      expect(asOwner.project?.name).toBe("Secret");
    });

    it("an archived project takes no new time but keeps its entries", async () => {
      const old = await createProject(db, scope, { name: "Old" });
      const entry = await createManualEntry(db, scope, manual({ projectId: old.id }));
      await db.update(project).set({ archived: true }).where(eq(project.id, old.id));

      await expectMessage(
        startTimer(db, scope, details({ projectId: old.id }), NOW),
        "This project is archived.",
      );
      const renamed = await updateEntry(db, scope, entry.id, { description: "Still mine" });
      expect(renamed).toMatchObject({ description: "Still mine", projectId: old.id });
      const fresh = await createManualEntry(db, scope, manual({}, 60));
      await expectMessage(
        updateEntry(db, scope, fresh.id, { projectId: old.id }),
        "This project is archived.",
      );
    });

    it("a patch that repeats the entry's current details is not a reassignment", async () => {
      const old = await createProject(db, scope, { name: "Old" });
      const review = await createTag(db, scope.workspaceId, { name: "review" });
      const entry = await createManualEntry(
        db,
        scope,
        manual({ projectId: old.id, tagIds: [review.id] }),
      );
      await db.update(project).set({ archived: true }).where(eq(project.id, old.id));
      // The calendar dialog sends every field; an unchanged project is not touched.
      const edited = await updateEntry(db, scope, entry.id, {
        description: "Edited",
        projectId: old.id,
        taskId: null,
        tagIds: [review.id],
      });
      expect(edited).toMatchObject({ description: "Edited", projectId: old.id });
      expect(edited.tags.map((t) => t.id)).toEqual([review.id]);
    });

    it("own entries on a private project the user left can still be retagged", async () => {
      const secret = await createProject(db, scope, { name: "Secret", visibility: "PRIVATE" });
      await db.insert(projectMember).values({ projectId: secret.id, userId: memberScope.userId });
      const entry = await createManualEntry(db, memberScope, manual({ projectId: secret.id }));
      await db.delete(projectMember).where(eq(projectMember.userId, memberScope.userId));
      const urgent = await createTag(db, scope.workspaceId, { name: "urgent" });

      const retagged = await updateEntry(db, memberScope, entry.id, { tagIds: [urgent.id] });
      expect(retagged.tags.map((t) => t.name)).toEqual(["urgent"]);
      // Moving it to another private project they are not on is still refused.
      const other = await createProject(db, scope, { name: "Other", visibility: "PRIVATE" });
      await expectMessage(
        updateEntry(db, memberScope, entry.id, { projectId: other.id }),
        "Project not found.",
      );
    });

    it("a done task or a task of another project is rejected", async () => {
      const web = await createProject(db, scope, { name: "Web" });
      const app = await createProject(db, scope, { name: "App" });
      const design = await addTask(web.id, "Design");
      const qa = await addTask(web.id, "QA", "DONE");

      const ok = await createManualEntry(db, scope, manual({ projectId: web.id, taskId: design }));
      expect(ok.task).toEqual({ id: design, name: "Design" });
      await expectMessage(
        createManualEntry(db, scope, manual({ projectId: web.id, taskId: qa })),
        "This task is done.",
      );
      await expectMessage(
        createManualEntry(db, scope, manual({ projectId: app.id, taskId: design })),
        "This task belongs to another project.",
      );
      await expectMessage(
        createManualEntry(db, scope, manual({ projectId: null, taskId: design })),
        "This task belongs to another project.",
      );
      // A patch that changes only the task is checked against the entry's project.
      await expectMessage(updateEntry(db, scope, ok.id, { taskId: qa }), "This task is done.");
      const moved = await createManualEntry(db, scope, manual({ projectId: app.id }, 60));
      await expectMessage(
        updateEntry(db, scope, moved.id, { taskId: design }),
        "This task belongs to another project.",
      );
    });

    it("an archived tag cannot be added", async () => {
      const urgent = await createTag(db, scope.workspaceId, { name: "urgent" });
      const entry = await createManualEntry(db, scope, manual({ tagIds: [urgent.id] }));
      await db.update(tag).set({ archived: true }).where(eq(tag.id, urgent.id));

      await expectMessage(
        startTimer(db, scope, details({ tagIds: [urgent.id] }), NOW),
        'Tag "urgent" is archived.',
      );
      const kept = await updateEntry(db, scope, entry.id, { description: "Kept" });
      expect(kept.tagIds).toEqual([urgent.id]);
      // A tag already on the entry may stay while other tags change; only adding it is blocked.
      const live = await createTag(db, scope.workspaceId, { name: "live" });
      const retagged = await updateEntry(db, scope, entry.id, { tagIds: [urgent.id, live.id] });
      expect(retagged.tagIds.sort()).toEqual([urgent.id, live.id].sort());
      const fresh = await createManualEntry(db, scope, manual({}, 60));
      await expectMessage(
        updateEntry(db, scope, fresh.id, { tagIds: [urgent.id] }),
        'Tag "urgent" is archived.',
      );
      expect(
        (await listTags(db, scope.workspaceId, { includeArchived: false })).map((t) => t.name),
      ).toEqual(["live"]);
      expect(
        (await listTags(db, scope.workspaceId, { includeArchived: true })).map((t) => [
          t.name,
          t.archived,
        ]),
      ).toEqual([
        ["live", false],
        ["urgent", true],
      ]);
    });

    it("continue and duplicate refuse an archived project", async () => {
      const old = await createProject(db, scope, { name: "Old" });
      const entry = await createManualEntry(db, scope, manual({ projectId: old.id }));
      await db.update(project).set({ archived: true }).where(eq(project.id, old.id));
      await expectMessage(continueEntry(db, scope, entry.id, NOW), "This project is archived.");
      await expectMessage(duplicateEntry(db, scope, entry.id), "This project is archived.");
      expect(await countRunning(scope)).toBe(0);
    });

    it("listEntriesInRange returns own stopped entries in order", async () => {
      const a = await createManualEntry(db, scope, manual({ description: "a" }, 60));
      const b = await createManualEntry(db, scope, manual({ description: "b" }, 0));
      await createManualEntry(db, scope, manual({ description: "before" }, -120));
      await createManualEntry(db, scope, manual({ description: "boundary" }, 180));
      await createManualEntry(db, memberScope, manual({ description: "theirs" }, 30));
      await startTimer(db, scope, details({ description: "running" }), at(NOW, minutes(90)));

      const rows = await listEntriesInRange(db, scope, { from: NOW, to: at(NOW, minutes(180)) });
      expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
    });

    it("reassignProjectEntries moves entries and clears their task", async () => {
      const web = await createProject(db, scope, { name: "Web" });
      const app = await createProject(db, scope, { name: "App" });
      const design = await addTask(web.id, "Design");
      const mine = await createManualEntry(
        db,
        scope,
        manual({ projectId: web.id, taskId: design }),
      );
      const theirs = await createManualEntry(db, memberScope, manual({ projectId: web.id }));
      await createManualEntry(db, scope, manual({ projectId: app.id }, 60));

      expect(await countProjectEntries(db, scope.workspaceId, web.id)).toBe(2);
      expect(await reassignProjectEntries(db, scope.workspaceId, web.id, app.id)).toBe(2);
      expect(await countProjectEntries(db, scope.workspaceId, web.id)).toBe(0);
      const movedMine = (await range(scope)).find((e) => e.id === mine.id);
      expect(movedMine).toMatchObject({ projectId: app.id, taskId: null, task: null });
      expect(new Date(movedMine!.updatedAt).getTime()).toBeGreaterThan(
        new Date(mine.updatedAt).getTime(),
      );
      expect((await range(memberScope)).map((e) => [e.id, e.projectId])).toEqual([
        [theirs.id, app.id],
      ]);
      expect(await reassignProjectEntries(db, scope.workspaceId, app.id, null)).toBe(3);
    });

    it("reassignProjectEntries re-rates more entries than a statement can bind (over 65,535)", async () => {
      const web = await createProject(db, scope, { name: "Web" });
      const app = await createProject(db, scope, { name: "App" });
      await db.execute(sql`
        insert into time_entry (id, workspace_id, user_id, project_id, billable, start, "end", duration_seconds)
        select 'bulk-' || g, ${scope.workspaceId}, ${scope.userId}, ${web.id}, true,
               timestamptz '2026-03-02 01:00+00' + make_interval(secs => g),
               timestamptz '2026-03-02 02:00+00' + make_interval(secs => g), 3600
        from generate_series(1, 66000) g`);
      expect(await reassignProjectEntries(db, scope.workspaceId, web.id, app.id)).toBe(66000);
      expect(await countProjectEntries(db, scope.workspaceId, app.id)).toBe(66000);
    }, 120_000);

    it("softDeleteProjectEntries hides them", async () => {
      const web = await createProject(db, scope, { name: "Web" });
      await createManualEntry(db, scope, manual({ projectId: web.id }));
      await createManualEntry(db, memberScope, manual({ projectId: web.id }));
      const kept = await createManualEntry(db, scope, manual({}, 60));

      const stampsOf = () =>
        db
          .select({ id: timeEntry.id, updatedAt: timeEntry.updatedAt })
          .from(timeEntry)
          .where(eq(timeEntry.projectId, web.id));
      const before = new Map((await stampsOf()).map((r) => [r.id, r.updatedAt.getTime()]));
      expect(await softDeleteProjectEntries(db, scope.workspaceId, web.id)).toBe(2);
      const after = await stampsOf();
      expect(after).toHaveLength(2);
      expect(after.every((r) => r.updatedAt.getTime() > (before.get(r.id) ?? Infinity))).toBe(true);
      expect((await range(scope)).map((r) => r.id)).toEqual([kept.id]);
      expect(await range(memberScope)).toEqual([]);
    });

    it("the DTO carries the task and the project's client name", async () => {
      const web = await createProject(db, scope, { name: "Web" });
      const design = await addTask(web.id, "Design");
      const entry = await createManualEntry(
        db,
        scope,
        manual({ projectId: web.id, taskId: design }),
      );
      expect(entry.task).toEqual({ id: design, name: "Design" });
      expect(entry.project).toEqual({
        id: web.id,
        name: "Web",
        color: web.color,
        clientName: null,
      });
      const { started } = await continueEntry(db, scope, entry.id, at(NOW, hours(2)));
      expect(started.task).toEqual({ id: design, name: "Design" });
    });
  });
});
