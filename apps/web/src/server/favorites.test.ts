import { and, eq, project, projectMember } from "@timekeep/db";
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
import { listFavorites, MAX_FAVORITES, pinFavorite, unpinFavorite } from "./favorites";

const handle = connectTestDb();
const db = handle.db;

let wsId: string;
let olga: Viewer;
let bob: Viewer;
let webId: string;
let secretId: string;
let tagId: string;

const details = (over: Partial<Parameters<typeof pinFavorite>[2]> = {}) => ({
  description: "Design review",
  projectId: webId,
  taskId: null,
  tagIds: [tagId],
  billable: true,
  ...over,
});

describe("favourites", () => {
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
    webId = (await createProject(db, olga, { name: "Web" })).id;
    secretId = (await createProject(db, olga, { name: "Secret", visibility: "PRIVATE" })).id;
    await db.insert(projectMember).values({ projectId: secretId, userId: b.id });
    tagId = (await createTag(db, wsId, { name: "urgent" })).id;
  });

  it("lists the viewer's own favourites, oldest first, with their details", async () => {
    const a = await pinFavorite(db, olga, details({ description: "First" }));
    const b = await pinFavorite(db, olga, details({ description: "Second" }));
    expect(a).toMatchObject({
      description: "First",
      project: { name: "Web" },
      tags: [{ name: "urgent" }],
      billable: true,
      blocked: null,
    });
    expect((await listFavorites(db, olga)).map((f) => f.id)).toEqual([a.id, b.id]);
    expect(await listFavorites(db, bob)).toEqual([]);
    await unpinFavorite(db, olga, a.id);
    expect((await listFavorites(db, olga)).map((f) => f.id)).toEqual([b.id]);
    await expect(unpinFavorite(db, bob, b.id)).rejects.toThrow("Favourite not found.");
  });

  it("refuses the same details twice and stops at the limit", async () => {
    await pinFavorite(db, olga, details());
    await expect(pinFavorite(db, olga, details())).rejects.toThrow("Already pinned.");
    for (let i = 1; i < MAX_FAVORITES; i++) {
      await pinFavorite(db, olga, details({ description: `Pin ${i}` }));
    }
    await expect(pinFavorite(db, olga, details({ description: "One more" }))).rejects.toThrow(
      "You can pin up to 20 favourites.",
    );
  });

  it("blocks a favourite on an archived project or one no longer visible", async () => {
    const onWeb = await pinFavorite(db, bob, details());
    const onSecret = await pinFavorite(db, bob, details({ projectId: secretId, tagIds: [] }));
    await db.update(project).set({ archived: true }).where(eq(project.id, webId));
    await db
      .delete(projectMember)
      .where(and(eq(projectMember.projectId, secretId), eq(projectMember.userId, bob.userId)));
    const list = await listFavorites(db, bob);
    expect(list.find((f) => f.id === onWeb.id)?.blocked).toBe("This project is archived.");
    expect(list.find((f) => f.id === onSecret.id)?.blocked).toBe(
      "This project is no longer visible to you.",
    );
  });
});
