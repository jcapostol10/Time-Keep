import { autoMapColumns } from "@timekeep/core";
import { eq, managedUser, project, tag, timeEntry, workspaceSettings } from "@timekeep/db";
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
import { createTask } from "./catalog/tasks";
import type { Viewer } from "./catalog/viewer";
import { commitEntryImport, type ImportOptions, planEntryImport } from "./entry-import";

const handle = connectTestDb();
const db = handle.db;

const HEADER = "Date,Start,End,Description,Project,Task,Tags,Billable,Email";
const OPTIONS: ImportOptions = {
  timezone: "Asia/Manila",
  dateFormat: "yyyy-MM-dd",
  createMissing: true,
  mapping: autoMapColumns(HEADER.split(",")),
};
const csv = (...lines: string[]) => [HEADER, ...lines].join("\n");

let wsId: string;
let ids: Record<string, string>;
let emails: Record<string, string>;
const viewer = (who: string): Promise<Viewer> => loadViewer(db, wsId, ids[who]!);

/** Dry run and commit resolve the same way; what the check shows is what the import does. */
describe("entry import", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const max = await createTestUser(db, "Max Manager");
    const bob = await createTestUser(db, "Bob Member");
    const dana = await createTestUser(db, "Dana Gone");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    wsId = ws.id;
    ids = { olga: olga.id, max: max.id, bob: bob.id, dana: dana.id };
    emails = { olga: olga.email, max: max.email, bob: bob.email, dana: dana.email };
    await addMember(db, wsId, max.id, "manager");
    await addMember(db, wsId, bob.id, "member");
    await addMember(db, wsId, dana.id, "member", "DEACTIVATED");
    await db.insert(managedUser).values({ workspaceId: wsId, managerId: max.id, userId: bob.id });
    const owner = await viewer("olga");
    const web = await createProject(db, owner, { name: "Web" });
    await createTask(db, owner, web.id, { name: "Setup", assigneeIds: [] });
    await createTag(db, wsId, { name: "t1" });
  });

  it("the dry run and the commit agree", async () => {
    const text = csv(
      "2026-03-09,09:00,10:30,Design review,Web,Setup,t1,yes,",
      "2026-03-09,11:00,12:00,Kickoff,New Proj,,fresh;t1,no,",
      "2026-03-09,13:00,oops,Broken,,,,,",
    );
    const olga = await viewer("olga");
    const plan = await planEntryImport(db, olga, text, OPTIONS);
    expect(plan).toMatchObject({
      ok: 2,
      errors: 1,
      creates: { clients: [], projects: ["New Proj"], tasks: [], tags: ["fresh"] },
    });
    expect(plan.rows.map((r) => r.status)).toEqual(["ok", "ok", "error"]);
    expect(plan.rows[2]!.error).toBe("Line 4: invalid end time");

    const { imported } = await commitEntryImport(db, olga, text, OPTIONS, plan.fingerprint);
    expect(imported).toBe(2);
    const rows = await db.select().from(timeEntry).where(eq(timeEntry.workspaceId, wsId));
    expect(rows.map((r) => r.description).sort()).toEqual(["Design review", "Kickoff"]);
    const kickoff = rows.find((r) => r.description === "Kickoff")!;
    const [created] = await db.select().from(project).where(eq(project.id, kickoff.projectId!));
    expect(created?.name).toBe("New Proj");
    expect(
      (await db.select().from(tag).where(eq(tag.workspaceId, wsId))).map((t) => t.name).sort(),
    ).toEqual(["fresh", "t1"]);
    const review = rows.find((r) => r.description === "Design review")!;
    expect(review).toMatchObject({ billable: true, userId: ids.olga, durationSeconds: 5400 });
    expect(review.start.toISOString()).toBe("2026-03-09T01:00:00.000Z");
  });

  it("a changed fingerprint refuses the commit", async () => {
    const text = csv("2026-03-09,09:00,10:00,Work,Web,,,,");
    const olga = await viewer("olga");
    await expect(commitEntryImport(db, olga, text, OPTIONS, "0".repeat(64))).rejects.toThrow(
      "changed since the check",
    );
    expect(await db.select().from(timeEntry).where(eq(timeEntry.workspaceId, wsId))).toEqual([]);
  });

  it("missing names are errors without createMissing and creations with it, once per name", async () => {
    const text = csv(
      "2026-03-09,09:00,10:00,A,Fresh Proj,,,,",
      "2026-03-09,10:00,11:00,B,fresh proj,,,,",
    );
    const olga = await viewer("olga");
    const strict = await planEntryImport(db, olga, text, { ...OPTIONS, createMissing: false });
    expect(strict.errors).toBe(2);
    expect(strict.rows[0]!.error).toBe('Line 2: unknown project "Fresh Proj"');
    const loose = await planEntryImport(db, olga, text, OPTIONS);
    expect(loose).toMatchObject({ ok: 2, errors: 0, creates: { projects: ["Fresh Proj"] } });
    await commitEntryImport(db, olga, text, OPTIONS, loose.fingerprint);
    const created = await db.select().from(project).where(eq(project.workspaceId, wsId));
    expect(created.map((p) => p.name).sort()).toEqual(["Fresh Proj", "Web"]);
  });

  it("the email column follows entry.write", async () => {
    const forBob = csv(`2026-03-09,09:00,10:00,By admin,Web,,,,${emails.bob}`);
    const olga = await viewer("olga");
    const plan = await planEntryImport(db, olga, forBob, OPTIONS);
    expect(plan.rows[0]).toMatchObject({ status: "ok", userName: "Bob Member" });
    await commitEntryImport(db, olga, forBob, OPTIONS, plan.fingerprint);
    expect(await db.select().from(timeEntry).where(eq(timeEntry.userId, ids.bob!))).toHaveLength(1);

    const bob = await viewer("bob");
    const upward = await planEntryImport(
      db,
      bob,
      csv(`2026-03-09,09:00,10:00,For the boss,Web,,,,${emails.olga}`),
      OPTIONS,
    );
    expect(upward.rows[0]!.error).toBe(`Line 2: you cannot add time for ${emails.olga}`);
    const unknown = await planEntryImport(
      db,
      olga,
      csv("2026-03-09,09:00,10:00,Nobody,Web,,,,ghost@example.com"),
      OPTIONS,
    );
    expect(unknown.rows[0]!.error).toBe("Line 2: unknown email ghost@example.com");
    const gone = await planEntryImport(
      db,
      olga,
      csv(`2026-03-09,09:00,10:00,Left,Web,,,,${emails.dana}`),
      OPTIONS,
    );
    expect(gone.rows[0]!.error).toBe(`Line 2: unknown email ${emails.dana}`);
  });

  it("a BOM and a ; delimiter parse, and two identical lines import two entries", async () => {
    const text =
      "﻿" +
      [
        "Date;Start;End;Description;Project",
        "2026-03-09;09:00;10:00;Twice;Web",
        "2026-03-09;09:00;10:00;Twice;Web",
      ].join("\r\n");
    const olga = await viewer("olga");
    const options = {
      ...OPTIONS,
      mapping: autoMapColumns(["Date", "Start", "End", "Description", "Project"]),
    };
    const plan = await planEntryImport(db, olga, text, options);
    expect(plan.ok).toBe(2);
    await commitEntryImport(db, olga, text, options, plan.fingerprint);
    expect(await db.select().from(timeEntry).where(eq(timeEntry.workspaceId, wsId))).toHaveLength(
      2,
    );
  });

  it("too many rows and too big a file are refused before parsing", async () => {
    const olga = await viewer("olga");
    const many = csv(...Array.from({ length: 10_001 }, () => "2026-03-09,09:00,10:00,x,,,,,"));
    await expect(planEntryImport(db, olga, many, OPTIONS)).rejects.toThrow("more than 10,000 rows");
    const big = `${HEADER}\n${"x".repeat(4 * 1024 * 1024 + 1)}`;
    await expect(planEntryImport(db, olga, big, OPTIONS)).rejects.toThrow("over 4 MB");
  });

  it("force timer refuses a member's own rows and not an admin's", async () => {
    await db
      .update(workspaceSettings)
      .set({ forceTimer: true })
      .where(eq(workspaceSettings.workspaceId, wsId));
    const text = csv("2026-03-09,09:00,10:00,Mine,Web,,,,");
    const bob = await planEntryImport(db, await viewer("bob"), text, OPTIONS);
    expect(bob.rows[0]!.error).toBe("Line 2: force timer is on: time is added with the timer");
    const olga = await planEntryImport(db, await viewer("olga"), text, OPTIONS);
    expect(olga.rows[0]!.status).toBe("ok");
    const forBob = await planEntryImport(
      db,
      await viewer("max"),
      csv(`2026-03-09,09:00,10:00,For Bob,Web,,,,${emails.bob}`),
      OPTIONS,
    );
    expect(forBob.rows[0]!.status).toBe("ok");
  });

  it("the workspace's required fields are checked in the dry run", async () => {
    await db
      .update(workspaceSettings)
      .set({ requiredFields: ["project"] })
      .where(eq(workspaceSettings.workspaceId, wsId));
    const plan = await planEntryImport(
      db,
      await viewer("olga"),
      csv("2026-03-09,09:00,10:00,No project,,,,,"),
      OPTIONS,
    );
    expect(plan.rows[0]!.error).toBe("Line 2: project is required");
  });
});
