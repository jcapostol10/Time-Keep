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
import { inArray, like, sql } from "drizzle-orm";

import { createDb, type Database, type DbExecutor } from "./client";
import { e2eOnlyWorkspaceIds, e2eUsersInCustomerWorkspaces } from "./e2e-tenant";
import { type JournalEntry, listPendingMigrations } from "./migrations-status";
import {
  account,
  client,
  membership,
  project,
  projectMember,
  tag,
  task,
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

/**
 * Removes the seeded demo data before reseeding. Only workspaces whose
 * members are all demo or e2e users are deleted, so a customer workspace that
 * ever invited a demo account is kept (the shared production database holds
 * real tenants too). The demo users go, taking their memberships with them.
 */
export async function resetDemoData(db: DbExecutor) {
  const blocked = await e2eUsersInCustomerWorkspaces(db, "@demo.test");
  if (blocked.length > 0) {
    const list = blocked.map((b) => `${b.email} in "${b.workspace}"`).join(", ");
    throw new Error(
      `Refusing to reseed: demo users belong to customer workspaces (${list}). ` +
        "Remove them from those workspaces first; deleting them would delete customer data.",
    );
  }
  const demoOnly = await e2eOnlyWorkspaceIds(db, { withMemberDomain: "@demo.test" });
  if (demoOnly.length > 0) await db.delete(workspace).where(inArray(workspace.id, demoOnly));
  await db.delete(user).where(like(sql`lower(${user.email})`, "%@demo.test"));
  // A leftover demo workspace with no members left; never one with a real member.
  await db.execute(sql`
    delete from ${workspace} w
    where w.slug = ${DEMO_WORKSPACE.slug}
      and not exists (select 1 from ${membership} m where m.workspace_id = w.id)
  `);
}

async function createUser(db: DbExecutor, name: string, email: string, passwordHash: string) {
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
  db: DbExecutor,
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

/**
 * Rebuilds the demo tenant in one transaction, so a failure part-way leaves
 * the previous data (or nothing) rather than a half-seeded tenant. Refuses to
 * run while this package's migrations are not all applied: previews share the
 * production database and never migrate it, so a schema-changing branch runs
 * the "Migrate shared database" workflow first.
 */
export async function seed(db: Database, opts: { journal?: JournalEntry[] } = {}) {
  const pending = await listPendingMigrations(db, opts.journal);
  if (pending.length > 0) {
    throw new Error(
      `Refusing to seed: migrations pending (${pending.join(", ")}). ` +
        'Previews never migrate; run the "Migrate shared database" workflow for this branch first.',
    );
  }

  return db.transaction(async (tx) => {
    await resetDemoData(tx);

    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const ids = new Map<string, string>();
    for (const u of DEMO_USERS) {
      const id = await createUser(tx, u.name, u.email, passwordHash);
      ids.set(u.email, id);
      await createWorkspace(tx, personalWorkspaceName(u.name), id, {
        timezone: DEMO_WORKSPACE.timezone,
      });
    }

    const ownerId = ids.get("owner@demo.test");
    if (!ownerId) throw new Error("owner missing");
    const demo = await createWorkspace(tx, DEMO_WORKSPACE.name, ownerId, {
      slug: DEMO_WORKSPACE.slug,
      timezone: DEMO_WORKSPACE.timezone,
    });

    for (const u of DEMO_USERS) {
      if (u.role === "owner") continue;
      const userId = ids.get(u.email);
      if (!userId) continue;
      await tx.insert(membership).values({
        id: randomUUID(),
        workspaceId: demo.id,
        userId,
        role: u.role,
        status: "ACTIVE",
      });
    }

    await seedTrackerData(tx, demo.id, ids);

    return { workspaceSlug: demo.slug };
  });
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

const DEMO_CLIENTS = ["Acme Corp", "Globex"] as const;
/** name, client index (null = none), visibility, tasks (the last of "Website redesign" is done). */
const DEMO_PROJECTS: {
  name: string;
  client: number | null;
  visibility: "PUBLIC" | "PRIVATE";
  tasks: string[];
}[] = [
  {
    name: "Website redesign",
    client: 0,
    visibility: "PUBLIC",
    tasks: ["Design", "Development", "QA"],
  },
  { name: "Mobile app", client: 1, visibility: "PRIVATE", tasks: ["iOS", "Android"] },
  { name: "Internal", client: null, visibility: "PUBLIC", tasks: ["Meetings", "Admin"] },
];
/** member2 is left off the private project so the demo tenant has a project a member cannot see. */
const PRIVATE_PROJECT_MEMBERS = [
  "owner@demo.test",
  "admin@demo.test",
  "manager@demo.test",
  "member1@demo.test",
];
const DEMO_TAGS = ["design", "dev", "meeting", "review"] as const;
const DEMO_ENTRY_KINDS: {
  description: string;
  project: number | null;
  tags: number[];
  billable: boolean;
}[] = [
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
async function seedTrackerData(db: DbExecutor, workspaceId: string, ids: Map<string, string>) {
  const tz = DEMO_WORKSPACE.timezone;
  const clientIds = DEMO_CLIENTS.map(() => randomUUID());
  await db.insert(client).values(
    DEMO_CLIENTS.map((name, i) => ({
      id: clientIds[i] ?? randomUUID(),
      workspaceId,
      name,
      email: `billing@${name.toLowerCase().replace(/\s+/g, "")}.example`,
    })),
  );
  const projectIds = DEMO_PROJECTS.map(() => randomUUID());
  await db.insert(project).values(
    DEMO_PROJECTS.map((p, i) => ({
      id: projectIds[i] ?? randomUUID(),
      workspaceId,
      name: p.name,
      color: pickColor(p.name),
      clientId: p.client === null ? null : (clientIds[p.client] ?? null),
      visibility: p.visibility,
      billable: p.client !== null,
    })),
  );
  const privateMembers = DEMO_PROJECTS.flatMap((p, i) =>
    p.visibility === "PRIVATE"
      ? PRIVATE_PROJECT_MEMBERS.flatMap((email) => {
          const userId = ids.get(email);
          const projectId = projectIds[i];
          return userId && projectId ? [{ projectId, userId }] : [];
        })
      : [],
  );
  if (privateMembers.length > 0) await db.insert(projectMember).values(privateMembers);
  // First task of each project; entries land on it.
  const firstTaskIds: (string | null)[] = [];
  const taskRows: (typeof task.$inferInsert)[] = [];
  DEMO_PROJECTS.forEach((p, i) => {
    const projectId = projectIds[i];
    if (!projectId) return;
    p.tasks.forEach((name, j) => {
      const id = randomUUID();
      if (j === 0) firstTaskIds[i] = id;
      taskRows.push({
        id,
        workspaceId,
        projectId,
        name,
        status: p.name === "Website redesign" && j === p.tasks.length - 1 ? "DONE" : "ACTIVE",
      });
    });
  });
  await db.insert(task).values(taskRows);
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
    // A user only ever tracks time on projects they can see.
    const kinds = DEMO_ENTRY_KINDS.filter(
      (k) =>
        k.project === null ||
        DEMO_PROJECTS[k.project]?.visibility === "PUBLIC" ||
        PRIVATE_PROJECT_MEMBERS.includes(email),
    );
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
        const kind = kinds[Math.floor(random() * kinds.length)] ?? kinds[0]!;
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
          description: kind.description,
          projectId: kind.project === null ? null : (projectIds[kind.project] ?? null),
          taskId: kind.project === null ? null : (firstTaskIds[kind.project] ?? null),
          billable: kind.billable,
          start,
          end,
          durationSeconds: computeDurationSeconds(start, end),
        });
        for (const t of kind.tags) {
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
        taskId: firstTaskIds[1] ?? null,
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
  const url = process.env.DATABASE_URL_SESSION ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL_SESSION or DATABASE_URL is not set");
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
