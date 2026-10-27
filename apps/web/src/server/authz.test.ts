import { randomUUID } from "node:crypto";

import {
  and,
  eq,
  managedGroup,
  managedUser,
  projectMember,
  userGroup,
  userGroupMember,
} from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import { assertCan, loadActor } from "./authz";
import { createProject } from "./catalog/projects";
import { WorkspaceAccessError } from "./workspace-access";

const handle = connectTestDb();
const db = handle.db;

describe("actors", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());
  beforeEach(async () => truncateAll(db));

  async function fixture() {
    const owner = await createTestUser(db, "Olga Owner");
    const max = await createTestUser(db, "Max Manager");
    const bob = await createTestUser(db, "Bob Member");
    const carol = await createTestUser(db, "Carol Member");
    const ws = await createTestWorkspace(db, "Workspace", owner.id);
    await addMember(db, ws.id, max.id, "manager");
    await addMember(db, ws.id, bob.id, "member");
    await addMember(db, ws.id, carol.id, "member");
    const groupId = randomUUID();
    await db.insert(userGroup).values({ id: groupId, workspaceId: ws.id, name: "Design" });
    await db.insert(userGroupMember).values({ groupId, userId: carol.id });
    await db.insert(managedUser).values({ workspaceId: ws.id, managerId: max.id, userId: bob.id });
    await db.insert(managedGroup).values({ workspaceId: ws.id, managerId: max.id, groupId });
    const ownerViewer = {
      workspaceId: ws.id,
      userId: owner.id,
      role: "owner" as const,
      actor: await loadActor(db, ws.id, owner.id, "owner"),
    };
    const internal = await createProject(db, ownerViewer, { name: "Internal" });
    await db
      .insert(projectMember)
      .values({ projectId: internal.id, userId: max.id, isManager: true });
    return { ws, owner, max, bob, carol, groupId, internal };
  }

  it("expands a managed group to its current members and lists managed projects", async () => {
    const f = await fixture();
    const actor = await loadActor(db, f.ws.id, f.max.id, "manager");
    expect([...actor.managedUserIds].sort()).toEqual([f.bob.id, f.carol.id].sort());
    expect([...actor.managedProjectIds]).toEqual([f.internal.id]);

    await db
      .delete(userGroupMember)
      .where(and(eq(userGroupMember.groupId, f.groupId), eq(userGroupMember.userId, f.carol.id)));
    const after = await loadActor(db, f.ws.id, f.max.id, "manager");
    expect([...after.managedUserIds]).toEqual([f.bob.id]);
  });

  it("gives owners and admins no scope sets: they are unscoped", async () => {
    const f = await fixture();
    const actor = await loadActor(db, f.ws.id, f.owner.id, "owner");
    expect(actor.managedUserIds.size).toBe(0);
    expect(actor.managedProjectIds.size).toBe(0);
  });

  it("refuses with 404 outside the scope and 403 for the role", async () => {
    const f = await fixture();
    const manager = await loadActor(db, f.ws.id, f.max.id, "manager");
    const member = await loadActor(db, f.ws.id, f.bob.id, "member");
    const outside = { kind: "entry" as const, userId: f.owner.id, projectId: null };
    expect(() => assertCan(manager, "entry.read", outside)).toThrow(WorkspaceAccessError);
    try {
      assertCan(manager, "entry.read", outside);
    } catch (error) {
      expect((error as WorkspaceAccessError).status).toBe(404);
    }
    try {
      assertCan(member, "rate.set", { kind: "none" });
      expect.unreachable();
    } catch (error) {
      expect((error as WorkspaceAccessError).status).toBe(403);
    }
    expect(() =>
      assertCan(manager, "entry.read", { kind: "entry", userId: f.bob.id, projectId: null }),
    ).not.toThrow();
  });
});
