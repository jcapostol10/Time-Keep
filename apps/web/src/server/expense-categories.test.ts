import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import { loadViewer } from "./authz";
import type { Viewer } from "./catalog/viewer";
import {
  createExpenseCategory,
  listExpenseCategories,
  updateExpenseCategory,
} from "./expense-categories";

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

let wsId: string;
let ids: Record<string, string>;
const viewer = (who: string): Promise<Viewer> => loadViewer(db, wsId, ids[who]!);

beforeEach(async () => {
  await truncateAll(db);
  const olga = await createTestUser(db, "Olga Owner");
  const max = await createTestUser(db, "Max Manager");
  const bob = await createTestUser(db, "Bob Member");
  const ws = await createTestWorkspace(db, "Workspace", olga.id);
  wsId = ws.id;
  ids = { olga: olga.id, max: max.id, bob: bob.id };
  await addMember(db, wsId, max.id, "manager");
  await addMember(db, wsId, bob.id, "member");
});

describe("expense categories (Phase 6c)", () => {
  it("owners create, members only list", async () => {
    const created = await createExpenseCategory(db, await viewer("olga"), {
      name: "Mileage",
      kind: "UNIT",
      unitName: "km",
      unitPriceMinor: 1500,
      billableDefault: true,
    });
    expect(created).toMatchObject({
      name: "Mileage",
      kind: "UNIT",
      unitName: "km",
      unitPriceMinor: 1500,
      billableDefault: true,
      archived: false,
    });
    await expect(
      createExpenseCategory(db, await viewer("bob"), { name: "Taxi", kind: "FIXED" } as never),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      createExpenseCategory(db, await viewer("max"), { name: "Taxi", kind: "FIXED" } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect((await listExpenseCategories(db, await viewer("bob"))).map((c) => c.name)).toEqual([
      "Mileage",
    ]);
  });

  it("a second category with the same name is a conflict", async () => {
    const owner = await viewer("olga");
    const input = {
      name: "Travel",
      kind: "FIXED" as const,
      unitName: null,
      unitPriceMinor: null,
      billableDefault: true,
    };
    await createExpenseCategory(db, owner, input);
    await expect(createExpenseCategory(db, owner, input)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "A category with this name exists.",
    });
  });

  it("archiving hides a category from the default list", async () => {
    const owner = await viewer("olga");
    const fields = { unitName: null, unitPriceMinor: null, billableDefault: false };
    const meals = await createExpenseCategory(db, owner, {
      name: "Meals",
      kind: "FIXED",
      ...fields,
    });
    await createExpenseCategory(db, owner, { name: "Travel", kind: "FIXED", ...fields });
    const archived = await updateExpenseCategory(db, owner, meals.id, { archived: true });
    expect(archived.archived).toBe(true);
    expect((await listExpenseCategories(db, owner)).map((c) => c.name)).toEqual(["Travel"]);
    expect(
      (await listExpenseCategories(db, owner, { includeArchived: true })).map((c) => c.name),
    ).toEqual(["Meals", "Travel"]);
    // A manager may not archive.
    await expect(
      updateExpenseCategory(db, await viewer("max"), meals.id, { archived: false }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
