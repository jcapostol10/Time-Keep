import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb, createTestUser, truncateAll } from "../../test/db";
import { createWorkspace } from "./workspaces";

const handle = connectTestDb();
const db = handle.db;

describe("createWorkspace", () => {
  beforeEach(async () => truncateAll(db));
  afterAll(async () => handle.close());

  it("gives concurrent workspaces with the same name distinct slugs", async () => {
    const owners = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createTestUser(db, `Same Name ${i}`)),
    );
    // Separate connections, so the five creations really run at the same time.
    const handles = owners.map(() => connectTestDb());
    try {
      const created = await Promise.all(
        owners.map((owner, i) =>
          createWorkspace(handles[i]!.db, { name: "Fresh Tester's workspace", ownerId: owner.id }),
        ),
      );
      const slugs = created.map((w) => w.slug).sort();
      expect(new Set(slugs).size).toBe(5);
      expect(slugs[0]).toBe("fresh-tester-s-workspace");
    } finally {
      await Promise.all(handles.map((h) => h.close()));
    }
  });

  it("gives distinct slugs when a name's suffixed slug is another name's base", async () => {
    // "Acme" with "acme" taken becomes "acme-2", which is the base of "Acme 2".
    for (let round = 0; round < 5; round++) {
      const name = `Neighbour ${round} x`;
      const [first, second, third] = await Promise.all(
        [0, 1, 2].map((i) => createTestUser(db, `Neighbour owner ${round}-${i}`)),
      );
      await createWorkspace(db, { name, ownerId: first!.id });
      const handles = [connectTestDb(), connectTestDb()];
      try {
        const created = await Promise.all([
          createWorkspace(handles[0]!.db, { name, ownerId: second!.id }),
          createWorkspace(handles[1]!.db, { name: `${name} 2`, ownerId: third!.id }),
        ]);
        expect(new Set(created.map((w) => w.slug)).size).toBe(2);
      } finally {
        await Promise.all(handles.map((h) => h.close()));
      }
    }
  });
});
