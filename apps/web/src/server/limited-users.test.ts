import { randomUUID } from "node:crypto";

import {
  account,
  and,
  eq,
  kioskCredential,
  membership,
  timeEntry,
  user,
  workspace,
} from "@timekeep/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

await vi.hoisted(async () => {
  const { routesUseTestDatabase } = await import("../../test/route-env");
  routesUseTestDatabase();
});

const { connectTestDb } = await import("../../test/db");
const { setUpTimeOffCast } = await import("../../test/time-off-fixtures");
const { getAuth } = await import("./auth");
const { setPin } = await import("./kiosk/credentials");
const { convertLimitedUser, createLimitedUser } = await import("./limited-users");
const { removeMember } = await import("./team");

const handle = connectTestDb();
const db = handle.db;
afterAll(() => handle.close());

let cast: Awaited<ReturnType<typeof setUpTimeOffCast>>;
beforeEach(async () => {
  cast = await setUpTimeOffCast(db);
});

const membershipOf = async (userId: string) => {
  const [m] = await db
    .select()
    .from(membership)
    .where(and(eq(membership.workspaceId, cast.wsId), eq(membership.userId, userId)));
  return m;
};

describe("createLimitedUser", () => {
  it("adds a kiosk-only member with no login and no workspace of their own", async () => {
    const workspacesBefore = (await db.select().from(workspace)).length;
    const { userId } = await createLimitedUser(db, await cast.viewer("ann"), { name: "Kim Kiosk" });

    const [u] = await db.select().from(user).where(eq(user.id, userId));
    expect(u?.email).toBe(`limited+${userId}@kiosk.invalid`);
    expect(u?.emailVerified).toBe(false);
    expect(await db.select().from(account).where(eq(account.userId, userId))).toEqual([]);
    expect(await membershipOf(userId)).toMatchObject({ role: "member", limited: true });
    expect((await db.select().from(workspace)).length).toBe(workspacesBefore);

    await expect(
      getAuth().api.signInEmail({ body: { email: u?.email ?? "", password: "anything1" } }),
    ).rejects.toThrow();
  });

  it("is refused to a manager with 403", async () => {
    await expect(
      createLimitedUser(db, await cast.viewer("max"), { name: "Kim" }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("convertLimitedUser", () => {
  it("replaces the email in place and clears limited", async () => {
    const ann = await cast.viewer("ann");
    const { userId } = await createLimitedUser(db, ann, { name: "Kim Kiosk" });
    const email = `kim.${randomUUID().slice(0, 8)}@example.com`;

    expect(await convertLimitedUser(db, ann, userId, { email })).toEqual({ email });

    const [u] = await db.select().from(user).where(eq(user.id, userId));
    expect(u?.email).toBe(email);
    expect(await membershipOf(userId)).toMatchObject({ limited: false });
  });

  it("refuses an address that already has an account", async () => {
    const ann = await cast.viewer("ann");
    const { userId } = await createLimitedUser(db, ann, { name: "Kim Kiosk" });
    const [olga] = await db.select().from(user).where(eq(user.id, cast.ids.olga));
    await expect(
      convertLimitedUser(db, ann, userId, { email: (olga?.email ?? "").toUpperCase() }),
    ).rejects.toThrow("This address already has an account; invite it instead.");
  });

  it("is refused to a manager, and is a 404 for someone who is not limited", async () => {
    const { userId } = await createLimitedUser(db, await cast.viewer("ann"), { name: "Kim" });
    await expect(
      convertLimitedUser(db, await cast.viewer("max"), userId, { email: "k@example.com" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      convertLimitedUser(db, await cast.viewer("ann"), cast.ids.bob, { email: "k@example.com" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("removeMember of a limited user", () => {
  it("deletes their kiosk credential and keeps their entries", async () => {
    const ann = await cast.viewer("ann");
    const { userId } = await createLimitedUser(db, ann, { name: "Kim Kiosk" });
    await setPin(db, ann, userId, "1234");
    await db.insert(timeEntry).values({
      id: randomUUID(),
      workspaceId: cast.wsId,
      userId,
      start: new Date("2026-10-01T01:00:00Z"),
      end: new Date("2026-10-01T02:00:00Z"),
      durationSeconds: 3600,
    });

    await removeMember(db, ann, userId);

    expect(
      await db.select().from(kioskCredential).where(eq(kioskCredential.userId, userId)),
    ).toEqual([]);
    expect(await db.select().from(timeEntry).where(eq(timeEntry.userId, userId))).toHaveLength(1);
  });
});
