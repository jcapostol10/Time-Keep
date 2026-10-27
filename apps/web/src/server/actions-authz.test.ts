import { randomUUID } from "node:crypto";

import { projectMember } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addMember,
  asViewer,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import type { AuthSession } from "./auth";

await vi.hoisted(async () => {
  const { routesUseTestDatabase } = await import("../../test/route-env");
  routesUseTestDatabase();
});

const session = vi.hoisted(() => ({ current: null as AuthSession | null }));
vi.mock("./session", () => ({ getSession: async () => session.current }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { updateEntryAction } = await import("./actions/time-entries");
const { createProjectAction, updateProjectAction } = await import("./actions/projects");
const { createProject } = await import("./catalog/projects");
const { inviteMembersAction } = await import("./actions/team");
const { createManualEntry } = await import("./time-entries");

const handle = connectTestDb();
const db = handle.db;

function signIn(u: { id: string }) {
  session.current = {
    user: u,
    session: { id: randomUUID(), userId: u.id },
  } as unknown as AuthSession;
}

describe("server actions ask the permission matrix", () => {
  let slug: string;
  let ids: Record<string, string>;

  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const max = await createTestUser(db, "Max Manager");
    const bob = await createTestUser(db, "Bob Member");
    const carol = await createTestUser(db, "Carol Member");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    slug = ws.slug;
    await addMember(db, ws.id, max.id, "manager");
    await addMember(db, ws.id, bob.id, "member");
    await addMember(db, ws.id, carol.id, "member");
    const owner = asViewer({ workspaceId: ws.id, userId: olga.id, role: "owner" });
    const managed = await createProject(db, owner, { name: "Managed" });
    const other = await createProject(db, owner, { name: "Other" });
    await db
      .insert(projectMember)
      .values({ projectId: managed.id, userId: max.id, isManager: true });
    const carolsEntry = await createManualEntry(
      db,
      asViewer({ workspaceId: ws.id, userId: carol.id, role: "member" }),
      {
        description: "Carol's",
        projectId: null,
        taskId: null,
        tagIds: [],
        billable: false,
        start: new Date("2026-03-02T01:00:00Z"),
        end: new Date("2026-03-02T02:00:00Z"),
      },
    );
    ids = {
      olga: olga.id,
      max: max.id,
      bob: bob.id,
      managed: managed.id,
      other: other.id,
      carolsEntry: carolsEntry.id,
    };
    users = { max, bob };
  });
  let users: Record<string, { id: string }>;

  it("answers another member's entry with not found", async () => {
    signIn(users.bob!);
    const result = await updateEntryAction(slug, ids.carolsEntry!, { description: "mine now" });
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toMatch(/not found/i);
  });

  it("refuses a member creating a project with the matrix's 403 message", async () => {
    signIn(users.bob!);
    const result = await createProjectAction(slug, { name: "Nope" });
    expect(result).toEqual({ ok: false, error: "You don't have permission to do that." });
  });

  it("refuses a manager's bulk invite before Better Auth is asked", async () => {
    signIn(users.max!);
    const result = await inviteMembersAction(slug, { emails: "a@x.co", role: "member" });
    expect(result).toEqual({ ok: false, error: "You don't have permission to do that." });
  });

  it("lets a manager edit a project they manage, and not one they don't", async () => {
    signIn(users.max!);
    const managed = await updateProjectAction(slug, ids.managed!, { note: "updated" });
    expect(managed.ok).toBe(true);
    const other = await updateProjectAction(slug, ids.other!, { note: "nope" });
    expect(other).toEqual({ ok: false, error: "Not found" });
  });
});
