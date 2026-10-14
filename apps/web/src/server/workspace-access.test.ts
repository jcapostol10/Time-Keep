import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import {
  listUserWorkspaces,
  resolveWorkspaceAccess,
  WorkspaceAccessError,
} from "./workspace-access";

const handle = connectTestDb();
const db = handle.db;

async function expectAccessError(promise: Promise<unknown>, status: 401 | 403 | 404) {
  await expect(promise).rejects.toBeInstanceOf(WorkspaceAccessError);
  await promise.catch((error: WorkspaceAccessError) => expect(error.status).toBe(status));
}

describe("tenant isolation: resolveWorkspaceAccess", () => {
  beforeAll(async () => truncateAll(db));
  beforeEach(async () => truncateAll(db));
  afterAll(async () => handle.close());

  it("a member of workspace A cannot read workspace B", async () => {
    const alice = await createTestUser(db, "Alice A");
    const bob = await createTestUser(db, "Bob B");
    await createTestWorkspace(db, "Workspace A", alice.id);
    const wsB = await createTestWorkspace(db, "Workspace B", bob.id);

    await expectAccessError(
      resolveWorkspaceAccess(db, { userId: alice.id, workspaceSlug: wsB.slug, minRole: "member" }),
      404,
    );
  });

  it("a non-member gets exactly the same error as for a workspace that does not exist", async () => {
    const alice = await createTestUser(db, "Alice A");
    const bob = await createTestUser(db, "Bob B");
    const wsB = await createTestWorkspace(db, "Workspace B", bob.id);

    const existing = await resolveWorkspaceAccess(db, {
      userId: alice.id,
      workspaceSlug: wsB.slug,
      minRole: "member",
    }).catch((e: WorkspaceAccessError) => e);
    const missing = await resolveWorkspaceAccess(db, {
      userId: alice.id,
      workspaceSlug: "does-not-exist",
      minRole: "member",
    }).catch((e: WorkspaceAccessError) => e);

    expect(existing).toBeInstanceOf(WorkspaceAccessError);
    expect(missing).toBeInstanceOf(WorkspaceAccessError);
    expect((existing as WorkspaceAccessError).status).toBe(
      (missing as WorkspaceAccessError).status,
    );
    expect((existing as Error).message).toBe((missing as Error).message);
  });

  it("a member can read their own workspace and gets their role and settings", async () => {
    const alice = await createTestUser(db, "Alice A");
    const wsA = await createTestWorkspace(db, "Workspace A", alice.id);

    const ctx = await resolveWorkspaceAccess(db, {
      userId: alice.id,
      workspaceSlug: wsA.slug,
      minRole: "member",
    });
    expect(ctx.workspace.id).toBe(wsA.id);
    expect(ctx.role).toBe("owner");
    expect(ctx.settings.workspaceId).toBe(wsA.id);
    expect(ctx.settings.currency).toBe("USD");
  });

  it("enforces the minimum role", async () => {
    const owner = await createTestUser(db, "Olivia Owner");
    const admin = await createTestUser(db, "Adam Admin");
    const member = await createTestUser(db, "Mia Member");
    const ws = await createTestWorkspace(db, "Acme", owner.id);
    await addMember(db, ws.id, admin.id, "admin");
    await addMember(db, ws.id, member.id, "member");

    await expectAccessError(
      resolveWorkspaceAccess(db, { userId: member.id, workspaceSlug: ws.slug, minRole: "admin" }),
      403,
    );
    await expect(
      resolveWorkspaceAccess(db, { userId: admin.id, workspaceSlug: ws.slug, minRole: "admin" }),
    ).resolves.toMatchObject({ role: "admin" });
    await expectAccessError(
      resolveWorkspaceAccess(db, { userId: admin.id, workspaceSlug: ws.slug, minRole: "owner" }),
      403,
    );
    await expect(
      resolveWorkspaceAccess(db, { userId: owner.id, workspaceSlug: ws.slug, minRole: "owner" }),
    ).resolves.toMatchObject({ role: "owner" });
  });

  it("rejects deactivated members", async () => {
    const owner = await createTestUser(db, "Olivia Owner");
    const gone = await createTestUser(db, "Gone Person");
    const ws = await createTestWorkspace(db, "Acme", owner.id);
    await addMember(db, ws.id, gone.id, "member", "DEACTIVATED");

    await expectAccessError(
      resolveWorkspaceAccess(db, { userId: gone.id, workspaceSlug: ws.slug, minRole: "member" }),
      404,
    );
  });

  it("returns 404 for an unknown slug", async () => {
    const alice = await createTestUser(db, "Alice A");
    await expectAccessError(
      resolveWorkspaceAccess(db, { userId: alice.id, workspaceSlug: "nope", minRole: "member" }),
      404,
    );
  });

  it("listUserWorkspaces only returns workspaces the user is an active member of", async () => {
    const alice = await createTestUser(db, "Alice A");
    const bob = await createTestUser(db, "Bob B");
    const wsA = await createTestWorkspace(db, "Workspace A", alice.id);
    const wsB = await createTestWorkspace(db, "Workspace B", bob.id);
    const wsC = await createTestWorkspace(db, "Workspace C", bob.id);
    await addMember(db, wsC.id, alice.id, "member");

    const slugs = (await listUserWorkspaces(db, alice.id)).map((w) => w.slug).sort();
    expect(slugs).toEqual([wsA.slug, wsC.slug].sort());
    expect(slugs).not.toContain(wsB.slug);
  });

  it("gives colliding workspace names unique slugs", async () => {
    const ada1 = await createTestUser(db, "Ada One");
    const ada2 = await createTestUser(db, "Ada Two");
    const first = await createTestWorkspace(db, "Ada's workspace", ada1.id);
    const second = await createTestWorkspace(db, "Ada's workspace", ada2.id);
    expect(first.slug).toBe("ada-s-workspace");
    expect(second.slug).toBe("ada-s-workspace-2");
  });
});
