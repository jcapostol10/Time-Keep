import { randomUUID } from "node:crypto";

import { autoMapColumns } from "@timekeep/core";
import { eq, project } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addMember,
  asViewer,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import { routeParams } from "../../test/route-env";
import type { AuthSession } from "./auth";

await vi.hoisted(async () => {
  const { routesUseTestDatabase } = await import("../../test/route-env");
  routesUseTestDatabase();
});

const session = vi.hoisted(() => ({ current: null as AuthSession | null }));
vi.mock("./session", () => ({ getSession: async () => session.current }));

const { GET: ratesGET } = await import("@/app/api/w/[workspaceSlug]/rates/route");
const { POST: importPOST } = await import("@/app/api/w/[workspaceSlug]/time-entries/import/route");
const { createProject } = await import("./catalog/projects");

const handle = connectTestDb();
const db = handle.db;
let slug: string;
let workspaceId: string;
let ownerId: string;

const ctx = () => routeParams({ workspaceSlug: slug });
const HEADER = "Date,Start,End,Description,Project,Task,Tags,Billable,Email";
const OPTIONS = {
  timezone: "Asia/Manila",
  dateFormat: "yyyy-MM-dd",
  createMissing: true,
  mapping: autoMapColumns(HEADER.split(",")),
};

function importRequest(csv: string, options: string, query = "", headers: HeadersInit = {}) {
  const form = new FormData();
  form.set("file", new File([csv], "entries.csv", { type: "text/csv" }));
  form.set("options", options);
  return new Request(`http://localhost/api/w/${slug}/time-entries/import${query}`, {
    method: "POST",
    body: form,
    headers,
  });
}

/** Phase 4 review follow-ups that live in route handlers. */
describe("route follow-ups", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const owner = await createTestUser(db, "Olga Owner");
    const ws = await createTestWorkspace(db, "Workspace", owner.id);
    slug = ws.slug;
    workspaceId = ws.id;
    ownerId = owner.id;
    session.current = {
      user: owner,
      session: { id: randomUUID(), userId: owner.id },
    } as unknown as AuthSession;
  });

  it("the rates route answers 404, not 500, for an unknown target", async () => {
    const res = await ratesGET(
      new Request(`http://localhost/api/w/${slug}/rates?level=project&projectId=${randomUUID()}`),
      ctx(),
    );
    expect(res.status).toBe(404);
  });

  it("the import route answers 400 for options that are not JSON", async () => {
    const res = await importPOST(importRequest(`${HEADER}\n`, "{not json", "?dryRun=1"), ctx());
    expect(res.status).toBe(400);
  });

  it("the import route refuses an oversized body before reading it", async () => {
    const res = await importPOST(
      importRequest(`${HEADER}\n`, JSON.stringify(OPTIONS), "?dryRun=1", {
        "content-length": String(5 * 1024 * 1024),
      }),
      ctx(),
    );
    expect(res.status).toBe(413);
  });

  it("the import's check names an archived or template project instead of planning to create it", async () => {
    const owner = asViewer({ workspaceId, userId: ownerId, role: "owner" });
    const old = await createProject(db, owner, { name: "Old" });
    await db.update(project).set({ archived: true }).where(eq(project.id, old.id));
    const base = await createProject(db, owner, { name: "Base" });
    await db.update(project).set({ isTemplate: true }).where(eq(project.id, base.id));
    const csv = [
      HEADER,
      "2026-03-09,09:00,10:00,Work,Old,,,yes,",
      "2026-03-09,11:00,12:00,Work,Base,,,yes,",
    ].join("\n");
    const res = await importPOST(importRequest(csv, JSON.stringify(OPTIONS), "?dryRun=1"), ctx());
    expect(res.status).toBe(200);
    const plan = (await res.json()) as {
      rows: { error: string | null }[];
      creates: { projects: string[] };
    };
    expect(plan.rows.map((r) => r.error)).toEqual([
      'Line 2: project "Old" is archived',
      'Line 3: project "Base" is a template',
    ]);
    expect(plan.creates.projects).toEqual([]);
  });

  it("the import's row errors do not tell a member which addresses are members", async () => {
    const bob = await createTestUser(db, "Bob Member");
    const carol = await createTestUser(db, "Carol Member");
    await addMember(db, workspaceId, bob.id, "member");
    await addMember(db, workspaceId, carol.id, "member");
    session.current = {
      user: bob,
      session: { id: randomUUID(), userId: bob.id },
    } as unknown as AuthSession;
    const csv = [
      HEADER,
      `2026-03-09,09:00,10:00,Work,,,,yes,${carol.email}`,
      "2026-03-09,11:00,12:00,Work,,,,yes,nobody@example.com",
    ].join("\n");
    const res = await importPOST(importRequest(csv, JSON.stringify(OPTIONS), "?dryRun=1"), ctx());
    const plan = (await res.json()) as { rows: { error: string | null }[] };
    expect(plan.rows.map((r) => r.error)).toEqual([
      `Line 2: you cannot add time for ${carol.email}`,
      "Line 3: you cannot add time for nobody@example.com",
    ]);
  });
});
