import { randomUUID } from "node:crypto";

import { personalWorkspaceName, slugify, uniqueSlug } from "@timekeep/core";
import { hashPassword } from "better-auth/crypto";
import { eq, inArray, like } from "drizzle-orm";

import { createDb, type Database } from "./client";
import { account, membership, user, workspace, workspaceSettings } from "./schema";

/**
 * Demo workspace used for local development, e2e tests and screenshots.
 * Idempotent: running it again rebuilds the demo data from scratch.
 */
export const DEMO_PASSWORD = "password123";
export const DEMO_WORKSPACE = { name: "Demo Workspace", slug: "demo", timezone: "Asia/Manila" };

export const DEMO_USERS = [
  { name: "Olivia Owner", email: "owner@demo.test", role: "owner" },
  { name: "Adam Admin", email: "admin@demo.test", role: "admin" },
  { name: "Maya Manager", email: "manager@demo.test", role: "manager" },
  { name: "Mia Member", email: "member1@demo.test", role: "member" },
  { name: "Max Member", email: "member2@demo.test", role: "member" },
] as const;

async function resetDemoData(db: Database) {
  const demoUsers = await db
    .select({ id: user.id })
    .from(user)
    .where(like(user.email, "%@demo.test"));
  const demoUserIds = demoUsers.map((u) => u.id);

  if (demoUserIds.length > 0) {
    // Workspaces owned by demo users (personal ones included) go with them.
    const owned = await db
      .select({ workspaceId: membership.workspaceId })
      .from(membership)
      .where(inArray(membership.userId, demoUserIds));
    const ownedIds = [...new Set(owned.map((m) => m.workspaceId))];
    if (ownedIds.length > 0) await db.delete(workspace).where(inArray(workspace.id, ownedIds));
    await db.delete(user).where(inArray(user.id, demoUserIds));
  }
  await db.delete(workspace).where(eq(workspace.slug, DEMO_WORKSPACE.slug));
}

async function createUser(db: Database, name: string, email: string, passwordHash: string) {
  const id = randomUUID();
  await db
    .insert(user)
    .values({ id, name, email, emailVerified: true, timezone: DEMO_WORKSPACE.timezone });
  await db.insert(account).values({
    id: randomUUID(),
    userId: id,
    accountId: id,
    providerId: "credential",
    password: passwordHash,
  });
  return id;
}

async function createWorkspace(
  db: Database,
  name: string,
  ownerId: string,
  opts: { slug?: string; timezone?: string } = {},
) {
  const taken = new Set(
    (await db.select({ slug: workspace.slug }).from(workspace)).map((r) => r.slug),
  );
  const slug = opts.slug ?? uniqueSlug(slugify(name), (s) => taken.has(s));
  const id = randomUUID();
  await db.insert(workspace).values({ id, name, slug });
  await db.insert(workspaceSettings).values({ workspaceId: id, timezone: opts.timezone ?? "UTC" });
  await db.insert(membership).values({
    id: randomUUID(),
    workspaceId: id,
    userId: ownerId,
    role: "owner",
    status: "ACTIVE",
  });
  return { id, slug };
}

export async function seed(db: Database) {
  await resetDemoData(db);

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const ids = new Map<string, string>();
  for (const u of DEMO_USERS) {
    const id = await createUser(db, u.name, u.email, passwordHash);
    ids.set(u.email, id);
    await createWorkspace(db, personalWorkspaceName(u.name), id, {
      timezone: DEMO_WORKSPACE.timezone,
    });
  }

  const ownerId = ids.get("owner@demo.test");
  if (!ownerId) throw new Error("owner missing");
  const demo = await createWorkspace(db, DEMO_WORKSPACE.name, ownerId, {
    slug: DEMO_WORKSPACE.slug,
    timezone: DEMO_WORKSPACE.timezone,
  });

  for (const u of DEMO_USERS) {
    if (u.role === "owner") continue;
    const userId = ids.get(u.email);
    if (!userId) continue;
    await db.insert(membership).values({
      id: randomUUID(),
      workspaceId: demo.id,
      userId,
      role: u.role,
      status: "ACTIVE",
    });
  }

  return { workspaceSlug: demo.slug };
}

const isDirectRun = process.argv[1]?.endsWith("seed.ts") ?? false;

if (isDirectRun) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const handle = createDb(url, { max: 2 });
  seed(handle.db)
    .then(({ workspaceSlug }) => {
      console.info(`[seed] demo workspace ready at /w/${workspaceSlug}`);
      for (const u of DEMO_USERS)
        console.info(`[seed]   ${u.role.padEnd(7)} ${u.email} / ${DEMO_PASSWORD}`);
    })
    .catch((error) => {
      console.error("[seed] failed", error);
      process.exitCode = 1;
    })
    .finally(() => handle.close());
}
