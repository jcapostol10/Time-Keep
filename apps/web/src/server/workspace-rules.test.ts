import { randomUUID } from "node:crypto";

import { can } from "@timekeep/core";
import { eq, userGroup, userGroupMember, workspaceSettings } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import { loadViewer, scopeFilter } from "./authz";
import { reportFilterOptions } from "./reports";

const handle = connectTestDb();
const db = handle.db;

let wsId: string;
let bobId: string;
let annId: string;

type Rules = Partial<typeof workspaceSettings.$inferInsert>;
async function setRules(patch: Rules) {
  await db.update(workspaceSettings).set(patch).where(eq(workspaceSettings.workspaceId, wsId));
}

/** The workspace_settings rule columns reach the matrix through loadActor. */
describe("workspace rules reach the matrix", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const ann = await createTestUser(db, "Ann Admin");
    const bob = await createTestUser(db, "Bob Member");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    wsId = ws.id;
    annId = ann.id;
    bobId = bob.id;
    await addMember(db, wsId, annId, "admin");
    await addMember(db, wsId, bobId, "member");
  });

  it("hides a page from members only", async () => {
    await setRules({ hiddenPages: ["reports"] });
    const bob = await loadViewer(db, wsId, bobId);
    const ann = await loadViewer(db, wsId, annId);
    const reports = { kind: "page", page: "reports" } as const;
    expect(can(bob.actor, "page.view", reports)).toBe(false);
    expect(can(bob.actor, "page.view", { kind: "page", page: "team" })).toBe(true);
    expect(can(ann.actor, "page.view", reports)).toBe(true);
  });

  it("lets members see the team's time when the workspace allows it", async () => {
    let bob = await loadViewer(db, wsId, bobId);
    expect(scopeFilter(bob.actor)).toBeDefined();
    expect((await reportFilterOptions(db, bob)).users).toBeNull();

    await setRules({ membersSeeTeamTime: true });
    bob = await loadViewer(db, wsId, bobId);
    expect(scopeFilter(bob.actor)).toBeUndefined();
    expect((await reportFilterOptions(db, bob)).users).not.toBeNull();
    expect(can(bob.actor, "report.viewAmounts", { kind: "none" })).toBe(false);
  });

  it("opens creation per the creators setting", async () => {
    const create = { kind: "project", projectId: null } as const;
    expect(can((await loadViewer(db, wsId, bobId)).actor, "project.create", create)).toBe(false);
    await setRules({ projectCreators: "everyone" });
    expect(can((await loadViewer(db, wsId, bobId)).actor, "project.create", create)).toBe(true);
    expect(can((await loadViewer(db, wsId, bobId)).actor, "tag.create", { kind: "none" })).toBe(
      false,
    );
  });

  it("force timer blocks a member's own times, not an admin's", async () => {
    await setRules({ forceTimer: true });
    const bob = await loadViewer(db, wsId, bobId);
    const ann = await loadViewer(db, wsId, annId);
    const own = (userId: string) => ({ kind: "entry", userId, projectId: null }) as const;
    expect(can(bob.actor, "entry.writeTimes", own(bobId))).toBe(false);
    expect(can(ann.actor, "entry.writeTimes", own(annId))).toBe(true);
    expect(can(ann.actor, "entry.writeTimes", own(bobId))).toBe(true);
  });

  it("carries the actor's groups only when tasks are shown by group", async () => {
    const groupId = randomUUID();
    await db.insert(userGroup).values({ id: groupId, workspaceId: wsId, name: "Design" });
    await db.insert(userGroupMember).values({ groupId, userId: bobId });

    expect((await loadViewer(db, wsId, bobId)).actor.groupIds.size).toBe(0);

    await setRules({ taskVisibility: "BY_GROUP" });
    expect([...(await loadViewer(db, wsId, bobId)).actor.groupIds]).toEqual([groupId]);
    expect((await loadViewer(db, wsId, annId)).actor.groupIds.size).toBe(0);
  });
});
