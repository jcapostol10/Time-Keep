import { randomUUID } from "node:crypto";

import { DEFAULT_REPORT_QUERY, type ViewerPrefs } from "@timekeep/core";
import {
  and,
  eq,
  invitation,
  managedGroup,
  managedUser,
  membership,
  projectMember,
  rate,
  timeEntry,
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
import { loadViewer } from "./authz";
import { createProject } from "./catalog/projects";
import type { Viewer } from "./catalog/viewer";
import { summaryReport } from "./reports";
import {
  changeRole,
  listTeam,
  removeMember,
  setManagerScope,
  setMemberStatus,
  transferOwnership,
} from "./team";
import { createManualEntry, startTimer } from "./time-entries";
import { resolveWorkspaceAccess, WorkspaceAccessError } from "./workspace-access";

const handle = connectTestDb();
const db = handle.db;

const PREFS: ViewerPrefs = {
  timezone: "UTC",
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};

let wsId: string;
let wsName: string;
let slug: string;
let ids: Record<string, string>;
const viewer = (who: string): Promise<Viewer> => loadViewer(db, wsId, ids[who]!);

async function status(error: Promise<unknown>): Promise<number | string> {
  try {
    await error;
    return "resolved";
  } catch (e) {
    if (e instanceof WorkspaceAccessError) return e.status;
    return (e as Error).message;
  }
}

describe("team service", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const ada = await createTestUser(db, "Ada Admin");
    const ann = await createTestUser(db, "Ann Admin");
    const max = await createTestUser(db, "Max Manager");
    const bob = await createTestUser(db, "Bob Member");
    const ws = await createTestWorkspace(db, "Acme Ltd", olga.id);
    wsId = ws.id;
    wsName = ws.name;
    slug = ws.slug;
    await addMember(db, ws.id, ada.id, "admin");
    await addMember(db, ws.id, ann.id, "admin");
    await addMember(db, ws.id, max.id, "manager");
    await addMember(db, ws.id, bob.id, "member");
    ids = { olga: olga.id, ada: ada.id, ann: ann.id, max: max.id, bob: bob.id };
  });

  it("never demotes, deactivates or removes the owner", async () => {
    const ada = await viewer("ada");
    expect(await status(changeRole(db, ada, ids.olga!, "member"))).toBe(403);
    expect(await status(setMemberStatus(db, ada, ids.olga!, "DEACTIVATED"))).toBe(403);
    expect(await status(removeMember(db, ada, ids.olga!))).toBe(403);
  });

  it("does not let an admin deactivate or remove themselves", async () => {
    const ada = await viewer("ada");
    expect(await status(setMemberStatus(db, ada, ids.ada!, "DEACTIVATED"))).toBe(403);
    expect(await status(removeMember(db, ada, ids.ada!))).toBe(403);
  });

  it("refuses a manager or member changing anyone", async () => {
    expect(await status(changeRole(db, await viewer("max"), ids.bob!, "admin"))).toBe(403);
    expect(await status(changeRole(db, await viewer("bob"), ids.max!, "member"))).toBe(403);
  });

  it("stops a deactivated member's timer and closes the workspace to them; reactivation restores it", async () => {
    const bob = await viewer("bob");
    const groupId = randomUUID();
    await db.insert(userGroup).values({ id: groupId, workspaceId: wsId, name: "Design" });
    await db.insert(userGroupMember).values({ groupId, userId: ids.bob! });
    const startedAt = new Date(Date.now() - 30 * 60_000);
    await startTimer(
      db,
      bob,
      { description: "Working", projectId: null, taskId: null, tagIds: [], billable: false },
      startedAt,
    );

    const now = new Date();
    await setMemberStatus(db, await viewer("ada"), ids.bob!, "DEACTIVATED", now);
    const running = await db
      .select()
      .from(timeEntry)
      .where(and(eq(timeEntry.userId, ids.bob!), eq(timeEntry.workspaceId, wsId)));
    expect(running).toHaveLength(1);
    expect(running[0]?.end?.getTime()).toBe(now.getTime());
    await expect(
      resolveWorkspaceAccess(db, { userId: ids.bob!, workspaceSlug: slug, minRole: "member" }),
    ).rejects.toMatchObject({ status: 404 });

    await setMemberStatus(db, await viewer("ada"), ids.bob!, "ACTIVE");
    await expect(
      resolveWorkspaceAccess(db, { userId: ids.bob!, workspaceSlug: slug, minRole: "member" }),
    ).resolves.toMatchObject({ role: "member" });
    const groups = await db
      .select()
      .from(userGroupMember)
      .where(eq(userGroupMember.userId, ids.bob!));
    expect(groups).toHaveLength(1);
  });

  it("removes a member's groups, scope and rates but keeps their time as a former member", async () => {
    const owner = await viewer("olga");
    const web = await createProject(db, owner, { name: "Web" });
    const groupId = randomUUID();
    await db.insert(userGroup).values({ id: groupId, workspaceId: wsId, name: "Design" });
    await db.insert(userGroupMember).values({ groupId, userId: ids.max! });
    await db.insert(projectMember).values({ projectId: web.id, userId: ids.max!, isManager: true });
    await db
      .insert(managedUser)
      .values({ workspaceId: wsId, managerId: ids.max!, userId: ids.bob! });
    await db.insert(rate).values({
      id: randomUUID(),
      workspaceId: wsId,
      level: "member",
      userId: ids.max!,
      amountMinor: 5000,
      currency: "USD",
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });
    const start = new Date("2026-03-02T01:00:00Z");
    await createManualEntry(db, await viewer("max"), {
      description: "Review",
      projectId: web.id,
      taskId: null,
      tagIds: [],
      billable: false,
      start,
      end: new Date(start.getTime() + 3_600_000),
    });

    await removeMember(db, await viewer("ada"), ids.max!);

    const left = await db
      .select()
      .from(membership)
      .where(and(eq(membership.workspaceId, wsId), eq(membership.userId, ids.max!)));
    expect(left).toEqual([]);
    expect(
      await db.select().from(userGroupMember).where(eq(userGroupMember.userId, ids.max!)),
    ).toEqual([]);
    expect(await db.select().from(projectMember).where(eq(projectMember.userId, ids.max!))).toEqual(
      [],
    );
    expect(await db.select().from(managedUser).where(eq(managedUser.managerId, ids.max!))).toEqual(
      [],
    );
    expect(await db.select().from(rate).where(eq(rate.userId, ids.max!))).toEqual([]);

    const report = await summaryReport(
      db,
      owner,
      {
        ...DEFAULT_REPORT_QUERY,
        preset: "custom",
        from: "2026-03-01T00:00:00.000Z",
        to: "2026-03-08T00:00:00.000Z",
        groupBy: ["user"],
      },
      PREFS,
    );
    expect(report.totals.durationSeconds).toBe(3600);
    expect(report.groups.map((g) => g.label)).toEqual(["Max Manager"]);
  });

  it("transfers ownership to an active admin who confirms the workspace name", async () => {
    const owner = await viewer("olga");
    expect(await status(transferOwnership(db, owner, ids.bob!, wsName))).toMatch(/admin/i);
    expect(await status(transferOwnership(db, owner, ids.ada!, "Acme"))).toMatch(/name/i);
    expect(await status(transferOwnership(db, await viewer("ada"), ids.ann!, wsName))).toBe(403);

    await transferOwnership(db, owner, ids.ada!, wsName);
    const roles = await db
      .select({ userId: membership.userId, role: membership.role })
      .from(membership)
      .where(eq(membership.workspaceId, wsId));
    const byUser = Object.fromEntries(roles.map((r) => [r.userId, r.role]));
    expect(byUser[ids.ada!]).toBe("owner");
    expect(byUser[ids.olga!]).toBe("admin");
    expect(roles.filter((r) => r.role === "owner")).toHaveLength(1);
  });

  it("drops a manager's scope when they stop being a manager", async () => {
    const ada = await viewer("ada");
    const owner = await viewer("olga");
    const web = await createProject(db, owner, { name: "Web" });
    const groupId = randomUUID();
    await db.insert(userGroup).values({ id: groupId, workspaceId: wsId, name: "Design" });
    await setManagerScope(db, ada, ids.max!, {
      userIds: [ids.bob!],
      groupIds: [groupId],
      projectIds: [web.id],
    });
    expect((await viewer("max")).actor.managedProjectIds.has(web.id)).toBe(true);

    await changeRole(db, ada, ids.max!, "member");
    expect(await db.select().from(managedUser).where(eq(managedUser.managerId, ids.max!))).toEqual(
      [],
    );
    expect(
      await db.select().from(managedGroup).where(eq(managedGroup.managerId, ids.max!)),
    ).toEqual([]);
    const pm = await db.select().from(projectMember).where(eq(projectMember.userId, ids.max!));
    expect(pm.every((r) => !r.isManager)).toBe(true);
  });

  it("refuses a scope for someone who is not a manager", async () => {
    expect(
      await status(
        setManagerScope(db, await viewer("ada"), ids.bob!, {
          userIds: [],
          groupIds: [],
          projectIds: [],
        }),
      ),
    ).toMatch(/manager/i);
  });

  it("lists members and invites, with rates for admins only", async () => {
    await db.insert(rate).values({
      id: randomUUID(),
      workspaceId: wsId,
      level: "member",
      userId: ids.bob!,
      amountMinor: 6000,
      currency: "USD",
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });
    await db.insert(invitation).values({
      id: randomUUID(),
      workspaceId: wsId,
      email: "new@example.com",
      role: "member",
      status: "pending",
      inviterId: ids.olga!,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const asAdmin = await listTeam(db, await viewer("ada"), {});
    expect(asAdmin.find((r) => r.userId === ids.bob)?.billableRateMinor).toBe(6000);
    expect(asAdmin.find((r) => r.email === "new@example.com")).toMatchObject({
      kind: "invite",
      status: "INVITED",
      userId: null,
    });
    const asManager = await listTeam(db, await viewer("max"), {});
    expect(asManager.find((r) => r.userId === ids.bob)?.billableRateMinor).toBeNull();
    expect(asManager.some((r) => r.kind === "invite")).toBe(false);
  });
});
