import { randomUUID } from "node:crypto";

import {
  eq,
  managedGroup,
  managedUser,
  project,
  rate,
  timeEntry,
  userGroup,
  userGroupMember,
} from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb, createTestUser, createTestWorkspace, truncateAll } from "../../test/db";

const handle = connectTestDb();
const db = handle.db;

function pgCode(error: unknown): string | undefined {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  return typeof cause === "object" && cause !== null
    ? (cause as { code?: string }).code
    : undefined;
}

describe("Phase 4a schema", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());
  beforeEach(async () => truncateAll(db));

  it("stores groups, a manager's people and groups, and rates with history", async () => {
    const owner = await createTestUser(db, "Owner O");
    const maya = await createTestUser(db, "Maya M");
    const mia = await createTestUser(db, "Mia M");
    const ws = await createTestWorkspace(db, "Workspace", owner.id);

    const [group] = await db
      .insert(userGroup)
      .values({ id: randomUUID(), workspaceId: ws.id, name: "Design" })
      .returning();
    if (!group) throw new Error("no group");
    await db.insert(userGroupMember).values({ groupId: group.id, userId: mia.id });
    await db.insert(managedUser).values({ workspaceId: ws.id, managerId: maya.id, userId: mia.id });
    await db
      .insert(managedGroup)
      .values({ workspaceId: ws.id, managerId: maya.id, groupId: group.id });

    const duplicateName = db
      .insert(userGroup)
      .values({ id: randomUUID(), workspaceId: ws.id, name: "Design" });
    await expect(duplicateName).rejects.toThrow();

    const effectiveFrom = new Date("2026-03-01T00:00:00Z");
    // A null amount means "no rate at this level from this date".
    await db.insert(rate).values({
      id: randomUUID(),
      workspaceId: ws.id,
      kind: "billable",
      level: "workspace",
      amountMinor: null,
      currency: "USD",
      effectiveFrom,
      createdBy: owner.id,
    });
    const sameDay = db.insert(rate).values({
      id: randomUUID(),
      workspaceId: ws.id,
      kind: "billable",
      level: "workspace",
      amountMinor: 5000,
      currency: "USD",
      effectiveFrom,
      createdBy: owner.id,
    });
    await expect(sameDay).rejects.toThrow();
    await sameDay.catch((error: unknown) => expect(pgCode(error)).toBe("23505"));
  });

  it("holds an amount beyond the int range on an entry", async () => {
    const owner = await createTestUser(db, "Owner O");
    const ws = await createTestWorkspace(db, "Workspace", owner.id);
    const [p] = await db
      .insert(project)
      .values({ id: randomUUID(), workspaceId: ws.id, name: "Web", color: "#0f766e" })
      .returning();
    const id = randomUUID();
    await db.insert(timeEntry).values({
      id,
      workspaceId: ws.id,
      userId: owner.id,
      projectId: p?.id ?? null,
      start: new Date("2026-03-02T01:00:00Z"),
      end: new Date("2026-03-02T02:00:00Z"),
      durationSeconds: 3600,
      billableRateMinor: 3_000_000_000,
      rateCurrency: "USD",
      rateSource: "project",
      amountMinor: 3_000_000_000,
    });
    const row = await db.query.timeEntry.findFirst({ where: eq(timeEntry.id, id) });
    expect(row?.amountMinor).toBe(3_000_000_000);
    expect(row?.rateSource).toBe("project");
  });
});
