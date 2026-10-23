import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb, createTestUser, createTestWorkspace, truncateAll } from "../../../test/db";
import { createManualEntry, type EntryScope, listEntriesInRange } from "../time-entries";
import { createTag, deleteTag, listTagOptions, listTags, updateTag } from "./tags";

const handle = connectTestDb();
const db = handle.db;

const NOW = new Date("2026-03-11T04:00:00.000Z");

let scope: EntryScope;
let other: EntryScope;

async function entryWith(tagIds: string[], offsetMin = 0) {
  const start = new Date(NOW.getTime() + offsetMin * 60_000);
  return createManualEntry(db, scope, {
    description: "work",
    projectId: null,
    taskId: null,
    tagIds,
    billable: false,
    start,
    end: new Date(start.getTime() + 30 * 60_000),
  });
}

describe("tags service", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const alice = await createTestUser(db, "Alice A");
    const bob = await createTestUser(db, "Bob B");
    const ws = await createTestWorkspace(db, "Workspace A", alice.id);
    const wsB = await createTestWorkspace(db, "Workspace B", bob.id);
    scope = { workspaceId: ws.id, userId: alice.id, role: "owner" };
    other = { workspaceId: wsB.id, userId: bob.id, role: "owner" };
  });

  it("lists with usage counts and hides archived tags unless asked", async () => {
    const design = await createTag(db, scope.workspaceId, { name: "design" });
    const old = await createTag(db, scope.workspaceId, { name: "old" });
    await entryWith([design.id]);
    await entryWith([design.id, old.id], 60);
    await updateTag(db, scope.workspaceId, old.id, { archived: true });

    const active = await listTags(db, scope.workspaceId, { includeArchived: false });
    expect(active.map((t) => [t.name, t.usageCount, t.archived])).toEqual([["design", 2, false]]);
    const all = await listTags(db, scope.workspaceId, { includeArchived: true });
    expect(all.map((t) => [t.name, t.usageCount, t.archived])).toEqual([
      ["design", 2, false],
      ["old", 1, true],
    ]);
    expect(await listTags(db, other.workspaceId, { includeArchived: true })).toEqual([]);
  });

  it("lists picker options as id, name and colour, archived excluded, no usage counts", async () => {
    const beta = await createTag(db, scope.workspaceId, { name: "beta" });
    const alpha = await createTag(db, scope.workspaceId, { name: "alpha" });
    await updateTag(db, scope.workspaceId, beta.id, { archived: true });
    expect(await listTagOptions(db, scope.workspaceId)).toEqual([
      { id: alpha.id, name: "alpha", color: alpha.color },
    ]);
  });

  it("the tags page refuses a duplicate name; the picker reuses it", async () => {
    const first = await createTag(db, scope.workspaceId, { name: "urgent", color: "#112233" });
    expect((await createTag(db, scope.workspaceId, { name: "urgent" })).id).toBe(first.id);
    await expect(
      createTag(db, scope.workspaceId, { name: "urgent" }, { onDuplicate: "refuse" }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "A tag with this name already exists." });
    await updateTag(db, scope.workspaceId, first.id, { archived: true });
    await expect(
      createTag(db, scope.workspaceId, { name: "urgent" }, { onDuplicate: "refuse" }),
    ).rejects.toThrow(/archived/);
  });

  it("renames, recolours and archives; names stay unique", async () => {
    const design = await createTag(db, scope.workspaceId, { name: "design" });
    await createTag(db, scope.workspaceId, { name: "dev" });
    const updated = await updateTag(db, scope.workspaceId, design.id, {
      name: "visual",
      color: "#123456",
    });
    expect(updated).toMatchObject({ name: "visual", color: "#123456", archived: false });
    await expect(
      updateTag(db, scope.workspaceId, design.id, { name: "dev" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(updateTag(db, other.workspaceId, design.id, { name: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deleting a tag removes it from entries and reports how many", async () => {
    const review = await createTag(db, scope.workspaceId, { name: "review" });
    const keep = await createTag(db, scope.workspaceId, { name: "keep" });
    await entryWith([review.id, keep.id]);
    await entryWith([review.id], 60);

    expect(await deleteTag(db, scope.workspaceId, review.id)).toEqual({ affectedEntries: 2 });
    const rows = await listEntriesInRange(db, scope, {
      from: NOW,
      to: new Date(NOW.getTime() + 3_600_000 * 2),
    });
    expect(rows.map((e) => e.tagIds)).toEqual([[keep.id], []]);
    expect(
      (await listTags(db, scope.workspaceId, { includeArchived: true })).map((t) => t.name),
    ).toEqual(["keep"]);
    await expect(deleteTag(db, other.workspaceId, keep.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
