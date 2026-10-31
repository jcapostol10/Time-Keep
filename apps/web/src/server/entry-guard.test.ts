import { randomUUID } from "node:crypto";

import {
  and,
  approvalEvent,
  approvalRequest,
  eq,
  managedUser,
  rate,
  timeEntry,
  workspaceSettings,
} from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import { loadViewer, scopeForUser } from "./authz";
import { createProject, deleteProject, updateProject } from "./catalog/projects";
import { requestRateRecalc, runRateRecalcJob } from "./rate-recalc";
import {
  bulkUpdateEntries,
  createManualEntries,
  createManualEntry,
  deleteEntries,
  duplicateEntry,
  type EntryScope,
  restoreEntries,
  scopesForEntries,
  splitEntry,
  startTimer,
  stopTimer,
  updateEntry,
} from "./time-entries";
import { copyWeek } from "./timesheet";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

// Asia/Manila, Monday weeks. "Now" is Wednesday 28 Oct 12:00 local.
const NOW = new Date("2026-10-28T04:00:00.000Z");
const SUBMITTED = { start: "2026-10-19", end: "2026-10-25" };
// Tuesday 20 Oct 09:00-10:00 local: inside the submitted week.
const IN = {
  start: new Date("2026-10-20T01:00:00.000Z"),
  end: new Date("2026-10-20T02:00:00.000Z"),
};
// Monday 26 Oct 09:00-10:00 local: the current week.
const OUT = {
  start: new Date("2026-10-26T01:00:00.000Z"),
  end: new Date("2026-10-26T02:00:00.000Z"),
};
const details = {
  description: "Work",
  projectId: null,
  taskId: null,
  tagIds: [] as string[],
  billable: false,
};
const NOTE = "Client asked for the fix";

let wsId: string;
let ids: Record<string, string>;
let inId: string;
let outId: string;
let deletedId: string;

async function setRules(patch: Partial<typeof workspaceSettings.$inferInsert>) {
  await db.update(workspaceSettings).set(patch).where(eq(workspaceSettings.workspaceId, wsId));
}

async function request(
  userId: string,
  period: { start: string; end: string },
  status: "PENDING" | "APPROVED" | "REJECTED",
) {
  const id = randomUUID();
  await db.insert(approvalRequest).values({
    id,
    workspaceId: wsId,
    userId,
    periodStart: period.start,
    periodEnd: period.end,
    status,
  });
  return id;
}

/** Bob, written by Bob himself, by Max (his manager) or by Ann (an admin). */
async function as(who: "bob" | "max" | "ann" | "olga"): Promise<EntryScope> {
  const viewer = await loadViewer(db, wsId, ids[who]!);
  return who === "bob" ? viewer : scopeForUser(db, viewer, ids.bob!);
}

async function adminEdits() {
  return db
    .select()
    .from(approvalEvent)
    .where(and(eq(approvalEvent.workspaceId, wsId), eq(approvalEvent.action, "ADMIN_EDIT")));
}

beforeEach(async () => {
  await truncateAll(db);
  const olga = await createTestUser(db, "Olga Owner");
  const ann = await createTestUser(db, "Ann Admin");
  const max = await createTestUser(db, "Max Manager");
  const bob = await createTestUser(db, "Bob Member");
  const ws = await createTestWorkspace(db, "Workspace", olga.id);
  wsId = ws.id;
  ids = { olga: olga.id, ann: ann.id, max: max.id, bob: bob.id };
  await addMember(db, wsId, ann.id, "admin");
  await addMember(db, wsId, max.id, "manager");
  await addMember(db, wsId, bob.id, "member");
  await db.insert(managedUser).values({ workspaceId: wsId, managerId: max.id, userId: bob.id });
  await setRules({ timezone: "Asia/Manila", weekStart: 1, approvalEnabled: true });
  const bobScope = await as("bob");
  inId = (await createManualEntry(db, bobScope, { ...details, ...IN }, NOW)).id;
  outId = (await createManualEntry(db, bobScope, { ...details, ...OUT }, NOW)).id;
  deletedId = (
    await createManualEntry(db, bobScope, { ...details, description: "Gone", ...IN }, NOW)
  ).id;
  await deleteEntries(db, bobScope, [deletedId]);
});

type Path = (scope: EntryScope, note?: string) => Promise<unknown>;

const PATHS: [string, Path][] = [
  [
    "create an entry in it",
    (s, note) => createManualEntry(db, s, { ...details, ...IN, note }, NOW),
  ],
  [
    "edit an entry's description",
    (s, note) => updateEntry(db, s, inId, { description: "Changed", note }, NOW),
  ],
  [
    "edit an entry's times",
    (s, note) => updateEntry(db, s, inId, { end: new Date(IN.end.getTime() + 60_000), note }, NOW),
  ],
  [
    "move an entry into it",
    (s, note) => updateEntry(db, s, outId, { start: IN.start, end: IN.end, note }, NOW),
  ],
  ["restore an entry", (s, note) => restoreEntries(db, s, [deletedId], { note })],
  ["duplicate an entry", (s, note) => duplicateEntry(db, s, inId, { note })],
  [
    "split an entry",
    (s, note) => splitEntry(db, s, inId, new Date(IN.start.getTime() + 30 * 60_000), NOW, { note }),
  ],
  [
    "bulk edit an entry",
    async (s, note) => {
      const viewer = await loadViewer(db, wsId, (s.actedBy ?? s.actor).userId);
      const groups = await scopesForEntries(db, viewer, [inId]);
      return bulkUpdateEntries(db, groups, { description: "Bulk" }, NOW, { note });
    },
  ],
  [
    "import entries",
    (s, note) =>
      db.transaction((tx) => createManualEntries(tx, s, [{ ...details, ...IN }], NOW, { note })),
  ],
  [
    "copy a week into it",
    (s, note) =>
      copyWeek(db, s, {
        fromWeekStart: new Date("2026-10-25T16:00:00.000Z"),
        toWeekStart: new Date("2026-10-18T16:00:00.000Z"),
        tz: "Asia/Manila",
        note,
      }),
  ],
  // Last: the paths before it use the entry.
  ["delete an entry", (s, note) => deleteEntries(db, s, [inId], { note })],
];

describe.each(["PENDING", "APPROVED"] as const)("a %s week", (status) => {
  const message =
    status === "PENDING" ? "This period is submitted for approval." : "This period is approved.";

  beforeEach(async () => {
    await request(ids.bob!, SUBMITTED, status);
  });

  it.each(PATHS)("refuses the member: %s", async (_name, path) => {
    await expect(path(await as("bob"))).rejects.toThrow(message);
  });

  it.each(PATHS)("refuses the manager: %s", async (_name, path) => {
    await expect(path(await as("max"))).rejects.toThrow(message);
  });

  it.each(PATHS)("asks an admin for a note: %s", async (_name, path) => {
    await expect(path(await as("ann"))).rejects.toMatchObject({ code: "NOTE_REQUIRED" });
    expect(await adminEdits()).toEqual([]);
  });

  it.each(PATHS)("lets an admin with a note, and logs it: %s", async (_name, path) => {
    await path(await as("ann"), NOTE);
    const events = await adminEdits();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toMatchObject({ userId: ids.bob, actorId: ids.ann, note: NOTE });
    expect(events[0]?.requestId).not.toBeNull();
  });

  it("logs which entry changed and how", async () => {
    await updateEntry(db, await as("ann"), inId, { description: "Changed", note: NOTE }, NOW);
    const [event] = await adminEdits();
    expect(event?.entryId).toBe(inId);
    expect(event?.changes).toEqual({ description: { from: "Work", to: "Changed" } });
  });

  it("leaves the weeks around it alone", async () => {
    await expect(
      updateEntry(db, await as("bob"), outId, { description: "Fine" }, NOW),
    ).resolves.toBeDefined();
  });
});

describe("the current week submitted", () => {
  it("refuses a new timer in it, but stops one already running", async () => {
    const bob = await as("bob");
    const { started } = await startTimer(db, bob, details, NOW);
    await request(ids.bob!, { start: "2026-10-26", end: "2026-11-01" }, "APPROVED");
    await expect(
      stopTimer(db, bob, { entryId: started.id }, new Date(NOW.getTime() + 60_000)),
    ).resolves.toMatchObject({ id: started.id });
    await expect(startTimer(db, bob, details, new Date(NOW.getTime() + 120_000))).rejects.toThrow(
      "This period is approved.",
    );
  });
});

describe("a rejected week", () => {
  it("is editable again", async () => {
    await request(ids.bob!, SUBMITTED, "REJECTED");
    await expect(
      updateEntry(db, await as("bob"), inId, { description: "Fixed" }, NOW),
    ).resolves.toBeDefined();
  });
});

describe("lock dates", () => {
  it("a rolling lock refuses a member and a manager, not an admin, with no note", async () => {
    // 7 days: locked before Wednesday 21 Oct (local); the entry is on the 20th.
    await setRules({ lockMode: "ROLLING", lockDays: 7 });
    for (const who of ["bob", "max"] as const) {
      await expect(
        updateEntry(db, await as(who), inId, { description: "Late" }, NOW),
      ).rejects.toThrow("Entries before 21 Oct 2026 are locked.");
    }
    await expect(
      updateEntry(db, await as("ann"), inId, { description: "Late" }, NOW),
    ).resolves.toBeDefined();
    expect(await adminEdits()).toEqual([]);
  });

  it("a fixed lock refuses moving an entry out of a locked day", async () => {
    await setRules({ lockMode: "FIXED", lockDate: "2026-10-21" });
    await expect(
      updateEntry(db, await as("bob"), inId, { start: OUT.start, end: OUT.end }, NOW),
    ).rejects.toThrow("Entries before 21 Oct 2026 are locked.");
    await expect(
      createManualEntry(db, await as("bob"), { ...details, ...IN }, NOW),
    ).rejects.toThrow("locked");
    await expect(
      updateEntry(db, await as("bob"), outId, { description: "Open" }, NOW),
    ).resolves.toBeDefined();
  });
});

describe("with approval and lock off", () => {
  it("changes nothing", async () => {
    await setRules({ approvalEnabled: false });
    for (const [, path] of PATHS) await path(await as("bob"));
    expect(await adminEdits()).toEqual([]);
  });
});

describe("writes outside the entry editor", () => {
  it("the rate job skips approved periods", async () => {
    await request(ids.bob!, SUBMITTED, "APPROVED");
    await db.update(timeEntry).set({ billable: true }).where(eq(timeEntry.workspaceId, wsId));
    await db.insert(rate).values({
      id: randomUUID(),
      workspaceId: wsId,
      level: "workspace",
      amountMinor: 5000,
      currency: "USD",
      effectiveFrom: new Date(0),
    });
    const { jobId } = await requestRateRecalc(db, wsId, ids.olga!, new Date(0));
    await runRateRecalcJob(db, jobId);
    const rows = await db.select().from(timeEntry).where(eq(timeEntry.workspaceId, wsId));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(inId)?.billableRateMinor).toBeNull();
    expect(byId.get(outId)?.billableRateMinor).toBe(5000);
  });

  it("deleting a project with submitted time is refused; archiving still works", async () => {
    const owner = await loadViewer(db, wsId, ids.olga!);
    const web = await createProject(db, owner, { name: "Web" });
    await updateEntry(db, await as("bob"), inId, { projectId: web.id }, NOW);
    await request(ids.bob!, SUBMITTED, "PENDING");
    await expect(deleteProject(db, owner, web.id, { mode: "delete" })).rejects.toThrow(
      "Archive it instead: it has time in submitted periods.",
    );
    await expect(updateProject(db, owner, web.id, { archived: true })).resolves.toBeDefined();
  });
});
