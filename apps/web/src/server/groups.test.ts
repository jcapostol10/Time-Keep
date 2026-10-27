import { eq, projectMember } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import { loadViewer } from "./authz";
import {
  createProject,
  listPickerProjects,
  setProjectGroups,
  setProjectMembers,
} from "./catalog/projects";
import type { Viewer } from "./catalog/viewer";
import { createGroup, deleteGroup, listGroups, renameGroup, setGroupMembers } from "./groups";
import { WorkspaceAccessError } from "./workspace-access";

const handle = connectTestDb();
const db = handle.db;

let wsId: string;
let ids: Record<string, string>;
const viewer = (who: string): Promise<Viewer> => loadViewer(db, wsId, ids[who]!);

describe("groups", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const max = await createTestUser(db, "Max Manager");
    const bob = await createTestUser(db, "Bob Member");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    wsId = ws.id;
    await addMember(db, ws.id, max.id, "manager");
    await addMember(db, ws.id, bob.id, "member");
    ids = { olga: olga.id, max: max.id, bob: bob.id };
  });

  it("creates, renames and deletes groups, with unique names, for admins only", async () => {
    const owner = await viewer("olga");
    const design = await createGroup(db, owner, "Design");
    await expect(createGroup(db, owner, " design ")).rejects.toThrow(/already/i);
    await renameGroup(db, owner, design.id, "Designers");
    expect((await listGroups(db, owner)).map((g) => g.name)).toEqual(["Designers"]);
    await expect(createGroup(db, await viewer("max"), "Mine")).rejects.toBeInstanceOf(
      WorkspaceAccessError,
    );
    await deleteGroup(db, owner, design.id);
    expect(await listGroups(db, owner)).toEqual([]);
  });

  it("lets a group's members see and track on a private project", async () => {
    const owner = await viewer("olga");
    const secret = await createProject(db, owner, { name: "Secret", visibility: "PRIVATE" });
    const design = await createGroup(db, owner, "Design");
    await setProjectGroups(db, owner, secret.id, [design.id]);

    const names = async () =>
      (await listPickerProjects(db, await viewer("bob"))).map((p) => p.name);
    expect(await names()).toEqual([]);
    await setGroupMembers(db, owner, design.id, [ids.bob!]);
    expect(await names()).toEqual(["Secret"]);
    await setGroupMembers(db, owner, design.id, []);
    expect(await names()).toEqual([]);
  });

  it("only adds workspace members to a group", async () => {
    const owner = await viewer("olga");
    const design = await createGroup(db, owner, "Design");
    const stranger = await createTestUser(db, "Stranger S");
    await expect(setGroupMembers(db, owner, design.id, [stranger.id])).rejects.toThrow(/members/i);
  });

  it("keeps a project's managers when its member list is replaced", async () => {
    const owner = await viewer("olga");
    const web = await createProject(db, owner, { name: "Web", visibility: "PRIVATE" });
    await db.insert(projectMember).values({ projectId: web.id, userId: ids.max!, isManager: true });
    await setProjectMembers(db, owner, web.id, [ids.bob!]);
    const rows = await db.select().from(projectMember).where(eq(projectMember.projectId, web.id));
    expect(rows.map((r) => [r.userId === ids.max ? "max" : "bob", r.isManager]).sort()).toEqual([
      ["bob", false],
      ["max", true],
    ]);
  });
});
