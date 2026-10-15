import { randomUUID } from "node:crypto";

import { capturedEmail, eq, invitation, timeEntry, user, workspace } from "@timekeep/db";
import { cleanupE2eData, isE2eEmail } from "@timekeep/db/e2e-tenant";
import { resetDemoData } from "@timekeep/db/seed";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { addMember, connectTestDb, createTestWorkspace, truncateAll } from "../../test/db";

const handle = connectTestDb();
const db = handle.db;

async function createUser(email: string) {
  const id = randomUUID();
  await db
    .insert(user)
    .values({ id, name: email.split("@")[0] ?? email, email, emailVerified: true });
  return id;
}

async function exists(table: typeof workspace | typeof user, id: string) {
  const rows = await db.select({ id: table.id }).from(table).where(eq(table.id, id));
  return rows.length === 1;
}

describe("e2e tenant boundaries", () => {
  beforeEach(async () => truncateAll(db));
  afterAll(async () => handle.close());

  it("recognises e2e addresses", () => {
    expect(isE2eEmail("owner@demo.test")).toBe(true);
    expect(isE2eEmail("Tina.123@E2E.test")).toBe(true);
    expect(isE2eEmail("someone@customer.com")).toBe(false);
    expect(isE2eEmail("demo.test@customer.com")).toBe(false);
  });

  it("reseeding refuses to touch a demo user who belongs to a customer workspace", async () => {
    const customer = await createUser("boss@customer.com");
    const demoUser = await createUser("member1@demo.test");
    const customerWs = await createTestWorkspace(db, "Customer Co", customer);
    await addMember(db, customerWs.id, demoUser, "member");
    await db.insert(timeEntry).values({
      id: randomUUID(),
      workspaceId: customerWs.id,
      userId: demoUser,
      start: new Date("2026-10-01T01:00:00Z"),
      end: new Date("2026-10-01T02:00:00Z"),
      durationSeconds: 3600,
    });
    await db.insert(invitation).values({
      id: randomUUID(),
      workspaceId: customerWs.id,
      email: "colleague@customer.com",
      inviterId: demoUser,
    });

    await expect(resetDemoData(db)).rejects.toThrow(/member1@demo\.test.*Customer Co/);

    expect(await exists(workspace, customerWs.id)).toBe(true);
    expect(await exists(user, demoUser)).toBe(true);
    expect(await db.select().from(timeEntry)).toHaveLength(1);
    expect(await db.select().from(invitation)).toHaveLength(1);
  });

  it("reseeding still removes demo-only workspaces", async () => {
    const demoUser = await createUser("member1@demo.test");
    const demoOnly = await createTestWorkspace(db, "Demo personal", demoUser);

    await resetDemoData(db);

    expect(await exists(user, demoUser)).toBe(false);
    expect(await exists(workspace, demoOnly.id)).toBe(false);
  });

  it("cleanup removes an e2e user with their personal workspace and entries", async () => {
    const tester = await createUser("tina.1@e2e.test");
    const ws = await createTestWorkspace(db, "Tina's workspace", tester);
    await db.insert(timeEntry).values({
      id: randomUUID(),
      workspaceId: ws.id,
      userId: tester,
      start: new Date("2026-10-01T01:00:00Z"),
      end: new Date("2026-10-01T02:00:00Z"),
      durationSeconds: 3600,
    });

    const result = await cleanupE2eData(db);

    expect(result).toMatchObject({ users: 1, workspaces: 1 });
    expect(await exists(user, tester)).toBe(false);
    expect(await exists(workspace, ws.id)).toBe(false);
    expect(await db.select().from(timeEntry)).toHaveLength(0);
  });

  it("cleanup skips an e2e user who belongs to a customer workspace, keeping their data there", async () => {
    const customer = await createUser("boss@customer.com");
    const tester = await createUser("ivy.2@e2e.test");
    const customerWs = await createTestWorkspace(db, "Customer Co", customer);
    await addMember(db, customerWs.id, tester, "member");
    await db.insert(timeEntry).values({
      id: randomUUID(),
      workspaceId: customerWs.id,
      userId: tester,
      start: new Date("2026-10-01T01:00:00Z"),
      end: new Date("2026-10-01T02:00:00Z"),
      durationSeconds: 3600,
    });

    const result = await cleanupE2eData(db);

    expect(result).toMatchObject({ users: 0, skipped: 1 });
    expect(await exists(workspace, customerWs.id)).toBe(true);
    expect(await exists(user, customer)).toBe(true);
    expect(await exists(user, tester)).toBe(true);
    expect(await db.select().from(timeEntry)).toHaveLength(1);
  });

  it("cleanup keeps the demo users and the demo workspace", async () => {
    const owner = await createUser("owner@demo.test");
    const demo = await createTestWorkspace(db, "Demo Workspace", owner);

    const result = await cleanupE2eData(db);

    expect(result).toMatchObject({ users: 0, workspaces: 0 });
    expect(await exists(user, owner)).toBe(true);
    expect(await exists(workspace, demo.id)).toBe(true);
  });

  it("cleanup prunes captured email older than a day", async () => {
    const now = new Date("2026-10-15T00:00:00Z");
    await db.insert(capturedEmail).values([
      {
        id: randomUUID(),
        toAddress: "a@e2e.test",
        subject: "old",
        html: "",
        text: "",
        createdAt: new Date("2026-10-13T00:00:00Z"),
      },
      {
        id: randomUUID(),
        toAddress: "a@e2e.test",
        subject: "new",
        html: "",
        text: "",
        createdAt: new Date("2026-10-14T12:00:00Z"),
      },
    ]);

    const result = await cleanupE2eData(db, { now });

    expect(result.emails).toBe(1);
    const left = await db.select({ subject: capturedEmail.subject }).from(capturedEmail);
    expect(left).toEqual([{ subject: "new" }]);
  });
});
