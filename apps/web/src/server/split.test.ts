import { randomUUID } from "node:crypto";

import { eq, rate, timeEntry, workspaceSettings } from "@timekeep/db";
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
import { createTag } from "./catalog/tags";
import type { Viewer } from "./catalog/viewer";
import { createManualEntry, splitEntry, startTimer } from "./time-entries";

const handle = connectTestDb();
const db = handle.db;

const START = new Date("2026-03-10T01:00:00.000Z");
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

let wsId: string;
let olga: Viewer;
let bob: Viewer;
let projectId: string;
let tagId: string;

async function stored(id: string) {
  const [row] = await db.select().from(timeEntry).where(eq(timeEntry.id, id));
  return row!;
}

/** Split: one entry becomes two with the same details, tags and rate (an edit of times). */
describe("split", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const o = await createTestUser(db, "Olga Owner");
    const b = await createTestUser(db, "Bob Member");
    const ws = await createTestWorkspace(db, "Workspace", o.id);
    wsId = ws.id;
    await addMember(db, wsId, b.id, "member");
    olga = await loadViewer(db, wsId, o.id);
    bob = await loadViewer(db, wsId, b.id);
    projectId = (await createProject(db, olga, { name: "Web" })).id;
    tagId = (await createTag(db, wsId, { name: "t" })).id;
    await db.insert(rate).values({
      id: randomUUID(),
      workspaceId: wsId,
      level: "workspace",
      amountMinor: 6000,
      currency: "USD",
      effectiveFrom: new Date(0),
    });
  });

  it("keeps details, tags and the rate on both parts", async () => {
    const whole = await createManualEntry(db, olga, {
      description: "Long one",
      projectId,
      taskId: null,
      tagIds: [tagId],
      billable: true,
      start: START,
      end: at(120),
    });
    // The rate changes after the entry was saved: a split keeps the stored rate.
    await db.update(rate).set({ amountMinor: 9000 }).where(eq(rate.workspaceId, wsId));
    const { first, second } = await splitEntry(db, olga, whole.id, at(45));
    expect(first).toMatchObject({
      id: whole.id,
      description: "Long one",
      projectId,
      tagIds: [tagId],
      billable: true,
      durationSeconds: 45 * 60,
    });
    expect(second).toMatchObject({
      description: "Long one",
      projectId,
      tagIds: [tagId],
      billable: true,
      start: at(45).toISOString(),
      end: at(120).toISOString(),
      durationSeconds: 75 * 60,
    });
    expect(second.id).not.toBe(whole.id);
    expect(await stored(first.id)).toMatchObject({ billableRateMinor: 6000, amountMinor: 4500 });
    expect(await stored(second.id)).toMatchObject({ billableRateMinor: 6000, amountMinor: 7500 });
  });

  it("refuses a point outside the entry or at its edges", async () => {
    const whole = await createManualEntry(db, olga, {
      description: "x",
      projectId: null,
      taskId: null,
      tagIds: [],
      billable: false,
      start: START,
      end: at(60),
    });
    for (const point of [at(-1), START, at(60), at(61)]) {
      await expect(splitEntry(db, olga, whole.id, point)).rejects.toThrow(
        "Pick a time inside the entry.",
      );
    }
  });

  it("refuses a running entry", async () => {
    const { started } = await startTimer(db, olga, {
      description: "running",
      projectId: null,
      taskId: null,
      tagIds: [],
      billable: false,
    });
    await expect(splitEntry(db, olga, started.id, new Date())).rejects.toThrow(
      "Stop the timer before splitting it.",
    );
  });

  it("a member under force timer cannot split", async () => {
    const whole = await createManualEntry(db, bob, {
      description: "x",
      projectId: null,
      taskId: null,
      tagIds: [],
      billable: false,
      start: START,
      end: at(60),
    });
    await db
      .update(workspaceSettings)
      .set({ forceTimer: true })
      .where(eq(workspaceSettings.workspaceId, wsId));
    const forced = await loadViewer(db, wsId, bob.userId);
    await expect(splitEntry(db, forced, whole.id, at(30))).rejects.toMatchObject({ status: 403 });
    await expect(splitEntry(db, olga, whole.id, at(30))).rejects.toMatchObject({ status: 404 });
  });
});
