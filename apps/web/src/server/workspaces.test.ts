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
});
