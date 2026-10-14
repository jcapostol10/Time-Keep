import { randomUUID } from "node:crypto";

import {
  addDaysInZone,
  computeDurationSeconds,
  localDateKey,
  localWeekday,
  personalWorkspaceName,
  pickColor,
  slugify,
  uniqueSlug,
  zonedDateTimeToInstant,
} from "@timekeep/core";
import { hashPassword } from "better-auth/crypto";
import { eq, inArray, like } from "drizzle-orm";

import { createDb, type Database } from "./client";
import {
  account,
  membership,
  project,
  tag,
  timeEntry,
  timeEntryTag,
  user,
  workspace,
  workspaceSettings,
} from "./schema";

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

  await seedTrackerData(db, demo.id, ids);

  return { workspaceSlug: demo.slug };
}

/** Deterministic PRNG so every seed run produces the same demo entries. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

const DEMO_PROJECTS = ["Website redesign", "Mobile app", "Internal"] as const;
const DEMO_TAGS = ["design", "dev", "meeting", "review"] as const;
const DEMO_TASKS: { description: string; project: number | null; tags: number[]; billable: boolean }[] = [
  { description: "Design review", project: 0, tags: [0, 3], billable: true },
  { description: "Homepage layout", project: 0, tags: [0], billable: true },
  { description: "API integration", project: 1, tags: [1], billable: true },
  { description: "Bug fixes", project: 1, tags: [1], billable: true },
  { description: "Team standup", project: 2, tags: [2], billable: false },
  { description: "Planning", project: 2, tags: [2], billable: false },
  { description: "Code review", project: 1, tags: [1, 3], billable: true },
  { description: "Email", project: null, tags: [], billable: false },
];

/**
 * Two weeks of stopped entries (weekdays, 09:00–18:00 Manila) for every demo
 * user, plus one entry for member1 that crosses midnight. No running timers.
 */
async function seedTrackerData(db: Database, workspaceId: string, ids: Map<string, string>) {
  const tz = DEMO_WORKSPACE.timezone;
  const projectIds = DEMO_PROJECTS.map(() => randomUUID());
  await db.insert(project).values(
    DEMO_PROJECTS.map((name, i) => ({
      id: projectIds[i] ?? randomUUID(),
      workspaceId,
      name,
      color: pickColor(name),
    })),
  );
  const tagIds = DEMO_TAGS.map(() => randomUUID());
  await db.insert(tag).values(
    DEMO_TAGS.map((name, i) => ({
      id: tagIds[i] ?? randomUUID(),
      workspaceId,
      name,
      color: pickColor(name),
    })),
  );

  const now = new Date();
  const today = localDateKey(now, tz);
  const todayStart = zonedDateTimeToInstant({ date: today, hours: 0, minutes: 0 }, tz);

  for (const [email, userId] of ids) {
    const random = mulberry32(hash(email));
    const entries: (typeof timeEntry.$inferInsert)[] = [];
    const links: (typeof timeEntryTag.$inferInsert)[] = [];

    for (let back = 13; back >= 0; back--) {
      const dayStart = addDaysInZone(todayStart, -back, tz);
      const weekday = localWeekday(dayStart, tz);
      if (weekday === 0 || weekday === 6) continue;
      const date = localDateKey(dayStart, tz);
      let minutes = 9 * 60 + Math.floor(random() * 4) * 15;
      const count = 2 + Math.floor(random() * 3);
      for (let i = 0; i < count && minutes < 17 * 60; i++) {
        const task = DEMO_TASKS[Math.floor(random() * DEMO_TASKS.length)] ?? DEMO_TASKS[0]!;
        const length = 30 + Math.floor(random() * 7) * 15;
        const start = zonedDateTimeToInstant(
          { date, hours: Math.floor(minutes / 60), minutes: minutes % 60 },
          tz,
        );
        const end = new Date(start.getTime() + length * 60_000);
        if (end > now) break;
        const id = randomUUID();
        entries.push({
          id,
          workspaceId,
          userId,
          description: task.description,
          projectId: task.project === null ? null : (projectIds[task.project] ?? null),
          billable: task.billable,
          start,
          end,
          durationSeconds: computeDurationSeconds(start, end),
        });
        for (const t of task.tags) {
          const tagId = tagIds[t];
          if (tagId) links.push({ timeEntryId: id, tagId });
        }
        minutes += length + Math.floor(random() * 3) * 15;
      }
    }

    if (email === "member1@demo.test") {
      // 23:30 -> 00:30 two days ago: one entry, listed under its start date.
      const date = localDateKey(addDaysInZone(todayStart, -2, tz), tz);
      const start = zonedDateTimeToInstant({ date, hours: 23, minutes: 30 }, tz);
      const end = new Date(start.getTime() + 60 * 60_000);
      entries.push({
        id: randomUUID(),
        workspaceId,
        userId,
        description: "Release deploy",
        projectId: projectIds[1] ?? null,
        billable: true,
        start,
        end,
        durationSeconds: 3600,
      });
    }

    if (entries.length > 0) await db.insert(timeEntry).values(entries);
    if (links.length > 0) await db.insert(timeEntryTag).values(links);
  }
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
