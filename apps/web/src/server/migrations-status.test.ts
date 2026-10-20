import { randomUUID } from "node:crypto";

import { count, membership, sql, user, workspace } from "@timekeep/db";
import { listPendingMigrations, readJournal } from "@timekeep/db/migrations-status";
import { seed } from "@timekeep/db/seed";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb, createTestUser, truncateAll } from "../../test/db";

const handle = connectTestDb();
const db = handle.db;

async function demoUserCount() {
  const [row] = await db
    .select({ n: count() })
    .from(user)
    .where(like(sql`lower(${user.email})`, "%@demo.test"));
  return row?.n ?? 0;
}

describe("migration status and the seed's guards", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());
  beforeEach(async () => truncateAll(db));

  it("reports nothing pending on a migrated database", async () => {
    expect(await listPendingMigrations(db)).toEqual([]);
  });

  it("reports journal entries newer than the last applied migration", async () => {
    const journal = [...readJournal(), { tag: "9999_future", when: Date.now() + 1_000_000 }];
    expect(await listPendingMigrations(db, journal)).toEqual(["9999_future"]);
  });

  it("the seed refuses to touch a database with pending migrations", async () => {
    await db.insert(user).values({
      id: randomUUID(),
      name: "Stale Demo",
      email: "stale@demo.test",
      emailVerified: true,
    });
    const journal = [...readJournal(), { tag: "9999_future", when: Date.now() + 1_000_000 }];
    await expect(seed(db, { journal })).rejects.toThrow(/pending.*9999_future/);
    // Nothing was reset: the stale demo user is still there.
    expect(await demoUserCount()).toBe(1);
  });

  it("a seed that fails part-way leaves nothing behind", async () => {
    // A real workspace already owns the "demo" slug, so the seed fails after
    // creating the demo users; the transaction must take them with it.
    const owner = await createTestUser(db, "Real Owner");
    const id = randomUUID();
    await db.insert(workspace).values({ id, name: "Taken", slug: "demo" });
    await db.insert(membership).values({
      id: randomUUID(),
      workspaceId: id,
      userId: owner.id,
      role: "owner",
      status: "ACTIVE",
    });
    await expect(seed(db)).rejects.toThrow();
    expect(await demoUserCount()).toBe(0);
  });
});
