import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  addDaysInZone,
  addDaysToKey,
  computeDurationSeconds,
  invoiceTotals,
  localDateKey,
  localWeekday,
  periodBounds,
  periodOf,
  personalWorkspaceName,
  pickColor,
  previousPeriod,
  slugify,
  uniqueSlug,
  weekdayOfKey,
  zonedDateTimeToInstant,
} from "@timekeep/core";
import { datasetHolidays } from "@timekeep/core/holiday-import";
import { hashPassword } from "better-auth/crypto";
import { and, eq, gte, inArray, isNotNull, isNull, like, lt, sql } from "drizzle-orm";

import { createDb, type Database, type DbExecutor } from "./client";
import { e2eOnlyWorkspaceIds, e2eUsersInCustomerWorkspaces } from "./e2e-tenant";
import { type JournalEntry, listPendingMigrations } from "./migrations-status";
import { rateEntriesSql } from "./rates-sql";
import {
  account,
  approvalEvent,
  approvalRequest,
  client,
  expense,
  expenseCategory,
  holiday,
  invoice,
  invoiceItem,
  invoiceSettings,
  kiosk,
  kioskCredential,
  managedUser,
  membership,
  payment,
  project,
  projectGroup,
  projectMember,
  rate,
  recurringInvoice,
  tag,
  task,
  targetRule,
  taskGroup,
  timeEntry,
  favoriteEntry,
  timeEntryTag,
  timeOffPolicy,
  timeOffRequest,
  user,
  userGroup,
  userGroupMember,
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
  opts: {
    slug?: string;
    timezone?: string;
    allowBreaks?: boolean;
    taskVisibility?: "EVERYONE" | "BY_GROUP";
  } = {},
) {
  const taken = new Set(
    (await db.select({ slug: workspace.slug }).from(workspace)).map((r) => r.slug),
  );
  const slug = opts.slug ?? uniqueSlug(slugify(name), (s) => taken.has(s));
  const id = randomUUID();
  await db.insert(workspace).values({ id, name, slug });
  await db.insert(workspaceSettings).values({
    workspaceId: id,
    timezone: opts.timezone ?? "UTC",
    allowBreaks: opts.allowBreaks ?? false,
    taskVisibility: opts.taskVisibility ?? "EVERYONE",
  });
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
      allowBreaks: true, // the seeded lunch breaks must be something the demo users could add
      // Tasks by group (decision 11): the demo shows the rule; seedTeamAndRates assigns the groups.
      taskVisibility: "BY_GROUP",
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

    const catalog = await seedTrackerData(tx, demo.id, ids);
    await seedTeamAndRates(tx, demo.id, ids, catalog);
    await seedCostAndCurrency(tx, demo.id, ids, catalog);
    await seedEstimates(tx, catalog);
    await seedExpenses(tx, demo.id, ids, catalog);
    await seedInvoices(tx, demo.id, ids, catalog);
    await seedApprovals(tx, demo.id, ids);
    await seedTimeOff(tx, demo.id, ids);
    const kioskToken = await seedKiosk(tx, demo.id, ids, catalog.taskIds);

    return { workspaceSlug: demo.slug, kioskToken };
  });
}

/**
 * Kiosk (Phase 5c): "Front desk" for everyone on Internal › Meetings, a task
 * the demo members' group can see, with PIN 1234 for member1 and member2. No
 * limited user: e2e cleanup keeps this tenant's members to `@demo.test`.
 */
async function seedKiosk(
  db: DbExecutor,
  workspaceId: string,
  ids: Map<string, string>,
  taskIds: Map<string, string>,
): Promise<string> {
  const taskId = taskIds.get("Internal/Meetings");
  if (!taskId) throw new Error("Internal/Meetings task missing");
  const [internal] = await db
    .select({ projectId: task.projectId })
    .from(task)
    .where(eq(task.id, taskId));
  const token = randomBytes(32).toString("base64url");
  await db.insert(kiosk).values({
    id: randomUUID(),
    workspaceId,
    name: "Front desk",
    tokenHash: createHash("sha256").update(token).digest("hex"),
    projectId: internal?.projectId,
    taskId,
    createdBy: ids.get("owner@demo.test"),
  });
  const pinHash = await hashPassword("1234");
  await db.insert(kioskCredential).values(
    ["member1@demo.test", "member2@demo.test"].flatMap((email) => {
      const userId = ids.get(email);
      return userId
        ? [{ id: randomUUID(), workspaceId, userId, pinHash, pinSetAt: new Date() }]
        : [];
    }),
  );
  return token;
}

/**
 * Approvals (Phase 5a): weekly periods approved by team managers; member1's
 * week before last is submitted and approved by the manager, so the demo
 * shows an approved, read-only week. Locks stay off.
 */
async function seedApprovals(db: DbExecutor, workspaceId: string, ids: Map<string, string>) {
  await db
    .update(workspaceSettings)
    .set({ approvalEnabled: true, approvalPeriod: "WEEKLY", approvalReviewers: "TEAM_MANAGERS" })
    .where(eq(workspaceSettings.workspaceId, workspaceId));
  const member = ids.get("member1@demo.test");
  const manager = ids.get("manager@demo.test");
  if (!member || !manager) throw new Error("seed: member1 or manager missing");
  const rule = {
    period: "WEEKLY" as const,
    timezone: DEMO_WORKSPACE.timezone,
    weekStart: 1 as const,
  };
  const period = previousPeriod(previousPeriod(periodOf(new Date(), rule), rule), rule);
  const bounds = periodBounds(period, rule.timezone);
  const [totals] = await db
    .select({
      work: sql<number>`coalesce(sum(${timeEntry.durationSeconds}), 0)::bigint`.mapWith(Number),
      billable:
        sql<number>`coalesce(sum(case when ${timeEntry.billable} then ${timeEntry.durationSeconds} else 0 end), 0)::bigint`.mapWith(
          Number,
        ),
      count: sql<number>`count(*)::int`,
    })
    .from(timeEntry)
    .where(
      and(
        eq(timeEntry.workspaceId, workspaceId),
        eq(timeEntry.userId, member),
        eq(timeEntry.type, "work"),
        sql`${timeEntry.end} is not null`,
        sql`${timeEntry.start} >= ${bounds.from} and ${timeEntry.start} < ${bounds.to}`,
      ),
    );
  const requestId = randomUUID();
  const submittedAt = bounds.to;
  const decidedAt = new Date(bounds.to.getTime() + 26 * 3_600_000);
  await db.insert(approvalRequest).values({
    id: requestId,
    workspaceId,
    userId: member,
    periodStart: period.start,
    periodEnd: period.end,
    status: "APPROVED",
    workSeconds: totals?.work ?? 0,
    billableSeconds: totals?.billable ?? 0,
    entryCount: totals?.count ?? 0,
    submittedAt,
    decidedBy: manager,
    decidedAt,
  });
  await db.insert(approvalEvent).values([
    {
      id: randomUUID(),
      workspaceId,
      requestId,
      userId: member,
      actorId: member,
      action: "SUBMIT",
      createdAt: submittedAt,
    },
    {
      id: randomUUID(),
      workspaceId,
      requestId,
      userId: member,
      actorId: manager,
      action: "APPROVE",
      createdAt: decidedAt,
    },
  ]);
}

/**
 * Time off, holidays, capacity and targets (Phase 5b): two policies for
 * everyone, the Philippines' public holidays this year and next (imported from
 * the bundled dataset, as an admin would), member1's approved vacation day
 * three weeks ago and a pending one next month, an inactive under-target rule,
 * and member2 working Sunday to Thursday.
 */
async function seedTimeOff(db: DbExecutor, workspaceId: string, ids: Map<string, string>) {
  const member1 = ids.get("member1@demo.test");
  const member2 = ids.get("member2@demo.test");
  const manager = ids.get("manager@demo.test");
  if (!member1 || !member2 || !manager) throw new Error("seed: demo users missing");
  const tz = DEMO_WORKSPACE.timezone;
  const today = localDateKey(new Date(), tz);
  const year = Number(today.slice(0, 4));

  const holidayDates = new Set<string>();
  for (const y of [year, year + 1]) {
    const rows = datasetHolidays("PH", null, y, { includeOptional: false });
    for (const r of rows) holidayDates.add(r.date);
    await db.insert(holiday).values(
      rows.map((r) => ({
        id: randomUUID(),
        workspaceId,
        date: r.date,
        name: r.name,
        source: `imported: PH ${y}`,
        country: "PH",
        estimated: r.estimated,
      })),
    );
  }

  const vacation = randomUUID();
  // Policies count from the start of the year, so balances do not depend on the seed's date.
  const yearStart = zonedDateTimeToInstant({ date: `${year}-01-01`, hours: 0, minutes: 0 }, tz);
  await db.insert(timeOffPolicy).values([
    {
      id: vacation,
      workspaceId,
      name: "Vacation leave",
      unit: "DAYS",
      accrual: "YEARLY",
      allowanceCenti: 1500,
      requiresApproval: true,
      createdAt: yearStart,
    },
    {
      id: randomUUID(),
      workspaceId,
      name: "Sick leave",
      unit: "DAYS",
      accrual: "YEARLY",
      allowanceCenti: 1500,
      requiresApproval: false,
      createdAt: yearStart,
    },
  ]);

  /** The first Monday-to-Friday on or after `from` that is not a holiday. */
  const workday = (from: string) => {
    let d = from;
    while ([0, 6].includes(weekdayOfKey(d)) || holidayDates.has(d)) d = addDaysToKey(d, 1);
    return d;
  };
  const approvedDay = workday(addDaysToKey(today, -21));
  const pendingDay = workday(addDaysToKey(today, 30));
  // Both inside this year, or the demo balance would not show them.
  const requests = [
    { day: approvedDay, status: "APPROVED" as const, note: "Family trip" },
    { day: pendingDay, status: "PENDING" as const, note: "Dentist" },
  ].filter((r) => r.day.startsWith(String(year)));
  if (requests.length) {
    await db.insert(timeOffRequest).values(
      requests.map((r) => ({
        id: randomUUID(),
        workspaceId,
        userId: member1,
        policyId: vacation,
        startDate: r.day,
        endDate: r.day,
        amountCenti: 100,
        note: r.note,
        status: r.status,
        decidedBy: r.status === "APPROVED" ? manager : null,
        decidedAt: r.status === "APPROVED" ? new Date() : null,
      })),
    );
  }

  await db.insert(targetRule).values({
    id: randomUUID(),
    workspaceId,
    kind: "UNDER",
    period: "DAY",
    thresholdMinutes: 240,
    active: false,
  });
  await db
    .update(membership)
    .set({ workingDays: [0, 1, 2, 3, 4] })
    .where(and(eq(membership.workspaceId, workspaceId), eq(membership.userId, member2)));
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
  template?: boolean;
}[] = [
  {
    name: "Website redesign",
    client: 0,
    visibility: "PUBLIC",
    tasks: ["Design", "Development", "QA"],
  },
  { name: "Mobile app", client: 1, visibility: "PRIVATE", tasks: ["iOS", "Android"] },
  { name: "Internal", client: null, visibility: "PUBLIC", tasks: ["Meetings", "Admin"] },
  // A template (Phase 4b) for "Start from template"; no entries land on it.
  {
    name: "Client onboarding",
    client: null,
    visibility: "PUBLIC",
    tasks: ["Kickoff", "Handover"],
    template: true,
  },
  // Tasks by group: its tasks belong to Finance only, so members outside Finance never see it.
  { name: "Finance ops", client: 1, visibility: "PUBLIC", tasks: ["Invoicing", "Payroll"] },
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
async function seedTrackerData(
  db: DbExecutor,
  workspaceId: string,
  ids: Map<string, string>,
): Promise<{
  projectIds: string[];
  firstTaskIds: (string | null)[];
  /** Task ids by "<project name>/<task name>", for the group assignments. */
  taskIds: Map<string, string>;
}> {
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
      isTemplate: p.template ?? false,
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
  const taskIds = new Map<string, string>();
  const taskRows: (typeof task.$inferInsert)[] = [];
  DEMO_PROJECTS.forEach((p, i) => {
    const projectId = projectIds[i];
    if (!projectId) return;
    p.tasks.forEach((name, j) => {
      const id = randomUUID();
      if (j === 0) firstTaskIds[i] = id;
      taskIds.set(`${p.name}/${name}`, id);
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
  // The owner's one favourite (Phase 4b): the design review on the first project.
  const ownerId = ids.get("owner@demo.test");
  if (ownerId && projectIds[0] && tagIds[0]) {
    await db.insert(favoriteEntry).values({
      id: randomUUID(),
      workspaceId,
      userId: ownerId,
      description: "Design review",
      projectId: projectIds[0],
      taskId: firstTaskIds[0] ?? null,
      tagIds: [tagIds[0]],
      billable: true,
    });
  }

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
      // Lunch: a 30-minute break at noon (decision 6; out of the reports by default).
      const lunchStart = zonedDateTimeToInstant({ date, hours: 12, minutes: 0 }, tz);
      const lunchEnd = new Date(lunchStart.getTime() + 30 * 60_000);
      if (lunchEnd <= now) {
        entries.push({
          id: randomUUID(),
          workspaceId,
          userId,
          description: "Lunch",
          projectId: null,
          taskId: null,
          billable: false,
          type: "break",
          start: lunchStart,
          end: lunchEnd,
          durationSeconds: 1800,
        });
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
  return { projectIds, firstTaskIds, taskIds };
}

/**
 * Phase 4: three groups and the tasks they see (decision 11: the demo shows
 * tasks by group), the manager manages member1 and the Mobile app project, a
 * rate at every level (from before the first entry), and every seeded entry
 * rated with them through the same SQL the app uses.
 *
 * The group assignments keep the demo-tenant e2e specs true: member2 (Design,
 * Engineering) keeps seeing Internal (Meetings) and never Mobile app, member1
 * (Design, Finance) keeps Mobile app › iOS, and the manager (Engineering) keeps
 * Website redesign in their picker. Internal › Admin is the task with no group;
 * Mobile app's tasks give Finance the private project's access (rule 9).
 */
async function seedTeamAndRates(
  db: DbExecutor,
  workspaceId: string,
  ids: Map<string, string>,
  catalog: { projectIds: string[]; firstTaskIds: (string | null)[]; taskIds: Map<string, string> },
) {
  const user = (email: string) => {
    const id = ids.get(email);
    if (!id) throw new Error(`seed: ${email} missing`);
    return id;
  };
  const groups = [
    { name: "Design", members: ["member1@demo.test", "member2@demo.test"] },
    { name: "Engineering", members: ["admin@demo.test", "manager@demo.test", "member2@demo.test"] },
    { name: "Finance", members: ["member1@demo.test"] },
  ];
  const groupIds = new Map<string, string>();
  for (const g of groups) {
    const groupId = randomUUID();
    groupIds.set(g.name, groupId);
    await db.insert(userGroup).values({ id: groupId, workspaceId, name: g.name });
    await db
      .insert(userGroupMember)
      .values(g.members.map((email) => ({ groupId, userId: user(email) })));
  }
  const group = (name: string) => {
    const id = groupIds.get(name);
    if (!id) throw new Error(`seed: group ${name} missing`);
    return id;
  };
  const taskOf = (key: string) => {
    const id = catalog.taskIds.get(key);
    if (!id) throw new Error(`seed: task ${key} missing`);
    return id;
  };
  const assignments: [task: string, groups: string[]][] = [
    ["Website redesign/Design", ["Design"]],
    ["Website redesign/Development", ["Engineering"]],
    ["Mobile app/iOS", ["Finance"]],
    ["Mobile app/Android", ["Finance"]],
    ["Internal/Meetings", ["Design", "Engineering"]],
    // Internal/Admin stays without a group: the "No group" case.
    ["Client onboarding/Kickoff", ["Design"]],
    ["Client onboarding/Handover", ["Design"]],
    ["Finance ops/Invoicing", ["Finance"]],
    ["Finance ops/Payroll", ["Finance"]],
  ];
  await db.insert(taskGroup).values(
    assignments.flatMap(([key, names]) =>
      names.map((name) => ({
        taskId: taskOf(key),
        groupId: group(name),
        assignedBy: user("owner@demo.test"),
      })),
    ),
  );

  const manager = user("manager@demo.test");
  const [website, mobile] = catalog.projectIds;
  const ios = catalog.firstTaskIds[1];
  if (!website || !mobile || !ios) throw new Error("seed: projects or tasks missing");
  // Rule 9: Finance's tasks on the private Mobile app give the group its access.
  await db.insert(projectGroup).values({ projectId: mobile, groupId: group("Finance") });
  await db
    .insert(managedUser)
    .values({ workspaceId, managerId: manager, userId: user("member1@demo.test") });
  // The manager is already on the private Mobile app project; make them its manager.
  await db
    .update(projectMember)
    .set({ isManager: true })
    .where(and(eq(projectMember.projectId, mobile), eq(projectMember.userId, manager)));

  const effectiveFrom = new Date(0);
  const owner = user("owner@demo.test");
  const levels: Omit<
    typeof rate.$inferInsert,
    "id" | "workspaceId" | "currency" | "effectiveFrom"
  >[] = [
    { level: "workspace", amountMinor: 5000 },
    { level: "member", userId: user("member2@demo.test"), amountMinor: 6000 },
    { level: "project", projectId: website, amountMinor: 8000 },
    {
      level: "project_member",
      projectId: website,
      userId: user("member1@demo.test"),
      amountMinor: 9000,
    },
    { level: "task", projectId: mobile, taskId: ios, amountMinor: 12000 },
  ];
  const rates: (typeof rate.$inferInsert)[] = levels.map((r) => ({
    id: randomUUID(),
    workspaceId,
    kind: "billable" as const,
    currency: "USD",
    effectiveFrom,
    createdBy: owner,
    ...r,
  }));
  await db.insert(rate).values(rates);
  await db.execute(rateEntriesSql(eq(timeEntry.workspaceId, workspaceId)));
}

/** What an hour of each demo person costs the company, in the workspace's USD (minor units). */
const DEMO_COST_RATES: [email: string, amountMinor: number][] = [
  ["owner@demo.test", 4000],
  ["admin@demo.test", 3500],
  ["manager@demo.test", 3000],
  ["member1@demo.test", 2500],
  ["member2@demo.test", 2200],
];

/**
 * Phase 6a: a cost rate for every demo person (and member1's own on Website
 * redesign), so the reports show cost and profit; and Initech, a client
 * billed in EUR, with one project, its rate in EUR and two hours of the
 * owner's time, so the demo shows amounts in two currencies that are never
 * added. The project has no tasks, so tasks by group hides it from nobody.
 */
async function seedCostAndCurrency(
  db: DbExecutor,
  workspaceId: string,
  ids: Map<string, string>,
  catalog: { projectIds: string[] },
) {
  const owner = ids.get("owner@demo.test");
  const member1 = ids.get("member1@demo.test");
  const website = catalog.projectIds[0];
  if (!owner || !member1 || !website) throw new Error("seed: owner, member1 or project missing");
  const effectiveFrom = new Date(0);
  const base = { workspaceId, effectiveFrom, createdBy: owner };

  const clientId = randomUUID();
  const projectId = randomUUID();
  await db.insert(client).values({
    id: clientId,
    workspaceId,
    name: "Initech",
    email: "billing@initech.example",
    currency: "EUR",
  });
  await db.insert(project).values({
    id: projectId,
    workspaceId,
    name: "Euro launch",
    color: pickColor("Euro launch"),
    clientId,
    visibility: "PUBLIC",
    billable: true,
  });

  await db.insert(rate).values([
    ...DEMO_COST_RATES.flatMap(([email, amountMinor]) => {
      const userId = ids.get(email);
      return userId
        ? [
            {
              ...base,
              id: randomUUID(),
              kind: "cost" as const,
              level: "member" as const,
              userId,
              amountMinor,
              currency: "USD",
            },
          ]
        : [];
    }),
    {
      ...base,
      id: randomUUID(),
      kind: "cost" as const,
      level: "project_member" as const,
      userId: member1,
      projectId: website,
      amountMinor: 3000,
      currency: "USD",
    },
    // A project billed in EUR needs its own rate: the USD rates are never converted.
    {
      ...base,
      id: randomUUID(),
      kind: "billable" as const,
      level: "project" as const,
      projectId,
      amountMinor: 7000,
      currency: "EUR",
    },
  ]);

  // The owner's last two weekdays before yesterday, 20:00-21:00: after the seeded working day.
  const tz = DEMO_WORKSPACE.timezone;
  const now = new Date();
  const todayStart = zonedDateTimeToInstant(
    { date: localDateKey(now, tz), hours: 0, minutes: 0 },
    tz,
  );
  const entries: (typeof timeEntry.$inferInsert)[] = [];
  for (let back = 2; back <= 9 && entries.length < 2; back++) {
    const dayStart = addDaysInZone(todayStart, -back, tz);
    const weekday = localWeekday(dayStart, tz);
    if (weekday === 0 || weekday === 6) continue;
    const start = zonedDateTimeToInstant(
      { date: localDateKey(dayStart, tz), hours: 20, minutes: 0 },
      tz,
    );
    entries.push({
      id: randomUUID(),
      workspaceId,
      userId: owner,
      description: "Launch plan",
      projectId,
      taskId: null,
      billable: true,
      start,
      end: new Date(start.getTime() + 3_600_000),
      durationSeconds: 3600,
    });
  }
  await db.insert(timeEntry).values(entries);
  // Both snapshots, by the SQL the app uses: cost on every work entry, EUR on the new ones.
  await db.execute(rateEntriesSql(eq(timeEntry.workspaceId, workspaceId)));
}

/**
 * Estimates (Phase 6b): Website redesign has 200 hours for the whole project,
 * Mobile app a monthly money budget in its currency, and Design a 40-hour
 * task estimate. Progress is computed from the seeded entries.
 */
async function seedEstimates(
  db: DbExecutor,
  catalog: { projectIds: string[]; taskIds: Map<string, string> },
) {
  const website = catalog.projectIds[0];
  const mobile = catalog.projectIds[1];
  const design = catalog.taskIds.get("Website redesign/Design");
  if (!website || !mobile || !design) throw new Error("seed: estimate targets missing");
  await db
    .update(project)
    .set({ estimateKind: "TIME", estimateSeconds: 200 * 3600, estimateReset: "NONE" })
    .where(eq(project.id, website));
  await db
    .update(project)
    .set({ estimateKind: "MONEY", estimateMinor: 500_000, estimateReset: "MONTHLY" })
    .where(eq(project.id, mobile));
  await db
    .update(task)
    .set({ estimateSeconds: 40 * 3600 })
    .where(eq(task.id, design));
}

const DEMO_EXPENSE_CATEGORIES: {
  name: string;
  kind: "FIXED" | "UNIT";
  unitName?: string;
  unitPriceMinor?: number;
  billableDefault: boolean;
}[] = [
  { name: "Travel", kind: "FIXED", billableDefault: true },
  { name: "Meals", kind: "FIXED", billableDefault: false },
  { name: "Mileage", kind: "UNIT", unitName: "km", unitPriceMinor: 1500, billableDefault: true },
  { name: "Software", kind: "FIXED", billableDefault: true },
];

/**
 * Expenses (Phase 6c): a dozen over the last month for the two members and
 * the manager, on Website redesign and Mobile app, in the workspace currency;
 * no receipts (the demo tenant writes nothing to the private bucket).
 */
async function seedExpenses(
  db: DbExecutor,
  workspaceId: string,
  ids: Map<string, string>,
  catalog: { projectIds: string[] },
) {
  const tz = DEMO_WORKSPACE.timezone;
  const categoryIds = new Map<string, string>();
  await db.insert(expenseCategory).values(
    DEMO_EXPENSE_CATEGORIES.map((c) => {
      const id = randomUUID();
      categoryIds.set(c.name, id);
      return {
        id,
        workspaceId,
        name: c.name,
        kind: c.kind,
        unitName: c.unitName ?? null,
        unitPriceMinor: c.unitPriceMinor ?? null,
        billableDefault: c.billableDefault,
      };
    }),
  );
  const [website, mobile] = catalog.projectIds;
  if (!website || !mobile) throw new Error("seed: expense projects missing");
  //  who        project  category   amount/quantity        days ago  description
  const rows: [string, string, string, number, number, string][] = [
    ["member1@demo.test", website, "Travel", 12_550, 2, "Taxi to the client"],
    ["member1@demo.test", website, "Meals", 2_400, 2, "Lunch with the client"],
    ["member1@demo.test", mobile, "Mileage", 4_250, 5, "Site visit (42.5 km)"],
    ["member1@demo.test", website, "Software", 9_900, 9, "Icon pack"],
    ["member2@demo.test", mobile, "Travel", 45_000, 3, "Flight to the workshop"],
    ["member2@demo.test", mobile, "Meals", 3_150, 3, "Dinner, workshop day"],
    ["member2@demo.test", mobile, "Mileage", 1_200, 12, "Airport run (12 km)"],
    ["member2@demo.test", website, "Software", 1_999, 16, "Font licence"],
    ["manager@demo.test", website, "Travel", 8_000, 7, "Train to the review"],
    ["manager@demo.test", mobile, "Software", 29_000, 20, "Device lab month"],
    ["manager@demo.test", mobile, "Meals", 5_600, 20, "Team lunch"],
    ["manager@demo.test", website, "Mileage", 3_000, 26, "Client office (30 km)"],
  ];
  const now = new Date();
  await db.insert(expense).values(
    rows.flatMap(([email, projectId, category, value, daysAgo, description]) => {
      const userId = ids.get(email);
      const categoryId = categoryIds.get(category);
      const def = DEMO_EXPENSE_CATEGORIES.find((c) => c.name === category);
      if (!userId || !categoryId || !def) return [];
      const unit = def.kind === "UNIT";
      const price = def.unitPriceMinor ?? 0;
      return [
        {
          id: randomUUID(),
          workspaceId,
          userId,
          projectId,
          categoryId,
          date: localDateKey(addDaysInZone(now, -daysAgo, tz), tz),
          // A unit expense stores its quantity in hundredths and the price it was priced at.
          amountMinor: unit
            ? Number((BigInt(value) * BigInt(price) + BigInt(50)) / BigInt(100))
            : value,
          quantityCenti: unit ? value : null,
          unitPriceMinor: unit ? price : null,
          billable: def.billableDefault,
          description,
          createdBy: userId,
        },
      ];
    }),
  );
}

/**
 * Invoicing (Phase 6d): the settings (VAT 12%, 30-day terms, the next number
 * INV-0003); INV-0001 sent to Acme Corp for the owner's own billable Website
 * time of the week before last (so no other demo person's entries are locked),
 * half paid; INV-0002 a draft for Globex with two manual lines; and a monthly
 * retainer template for Globex. Built here, not through the web service: the
 * seed runs without the app.
 */
async function seedInvoices(
  db: DbExecutor,
  workspaceId: string,
  ids: Map<string, string>,
  catalog: { projectIds: string[] },
) {
  const tz = DEMO_WORKSPACE.timezone;
  const owner = ids.get("owner@demo.test");
  const website = catalog.projectIds[0];
  if (!owner || !website) throw new Error("seed: owner or Website missing");
  const clients = await db
    .select({ id: client.id, name: client.name })
    .from(client)
    .where(eq(client.workspaceId, workspaceId));
  const acme = clients.find((c) => c.name === "Acme Corp");
  const globex = clients.find((c) => c.name === "Globex");
  if (!acme || !globex) throw new Error("seed: Acme Corp or Globex missing");
  const vat = 1200;
  await db.insert(invoiceSettings).values({
    workspaceId,
    companyName: "Demo Workspace Inc.",
    address: "1 Ayala Avenue\nMakati City, Metro Manila",
    taxLine: "TIN 000-123-456-000",
    notes: "Thank you for your business.",
    paymentTermsDays: 30,
    nextNumber: 3,
    tax1Name: "VAT",
    tax1Bps: vat,
  });

  const today = localDateKey(new Date(), tz);
  const midnight = (key: string) => zonedDateTimeToInstant({ date: key, hours: 0, minutes: 0 }, tz);
  const entries = await db
    .select({
      id: timeEntry.id,
      seconds: timeEntry.durationSeconds,
      amountMinor: timeEntry.amountMinor,
      rateMinor: timeEntry.billableRateMinor,
    })
    .from(timeEntry)
    .where(
      and(
        eq(timeEntry.workspaceId, workspaceId),
        eq(timeEntry.projectId, website),
        eq(timeEntry.userId, owner),
        eq(timeEntry.billable, true),
        eq(timeEntry.rateCurrency, "USD"),
        isNotNull(timeEntry.amountMinor),
        isNotNull(timeEntry.end),
        isNull(timeEntry.deletedAt),
        isNull(timeEntry.invoiceId),
        gte(timeEntry.start, midnight(addDaysToKey(today, -14))),
        lt(timeEntry.start, midnight(addDaysToKey(today, -7))),
      ),
    );
  const rates = new Set(entries.map((e) => e.rateMinor));
  const timeLine = {
    kind: "TIME" as const,
    description: "Website redesign",
    quantityCenti: Math.round(entries.reduce((n, e) => n + (e.seconds ?? 0), 0) / 36),
    unitPriceMinor: rates.size === 1 ? ([...rates][0] ?? null) : null,
    amountMinor: entries.reduce((n, e) => n + (e.amountMinor ?? 0), 0),
    entryIds: entries.map((e) => e.id),
  };
  // Without time in the window (a fresh database on an odd day), a manual line keeps the demo whole.
  const sentLines =
    entries.length > 0
      ? [timeLine]
      : [
          {
            kind: "MANUAL" as const,
            description: "Website redesign",
            quantityCenti: 1000,
            unitPriceMinor: 10_000,
            amountMinor: 100_000,
            entryIds: [] as string[],
          },
        ];

  const rows = [
    {
      number: "INV-0001",
      clientId: acme.id,
      status: "SENT" as const,
      issueDate: addDaysToKey(today, -6),
      lines: sentLines,
    },
    {
      number: "INV-0002",
      clientId: globex.id,
      status: "DRAFT" as const,
      issueDate: today,
      lines: [
        {
          kind: "MANUAL" as const,
          description: "Workshop facilitation (days)",
          quantityCenti: 200,
          unitPriceMinor: 60_000,
          amountMinor: 120_000,
          entryIds: [] as string[],
        },
        {
          kind: "MANUAL" as const,
          description: "Travel",
          quantityCenti: 100,
          unitPriceMinor: 25_000,
          amountMinor: 25_000,
          entryIds: [] as string[],
        },
      ],
    },
  ];
  const sentId = randomUUID();
  for (const [i, r] of rows.entries()) {
    const id = i === 0 ? sentId : randomUUID();
    const totals = invoiceTotals(r.lines, { discountBps: 0, tax1Bps: vat, tax2Bps: null });
    await db.insert(invoice).values({
      id,
      workspaceId,
      clientId: r.clientId,
      number: r.number,
      issueDate: r.issueDate,
      dueDate: addDaysToKey(r.issueDate, 30),
      currency: "USD",
      status: r.status,
      tax1Name: "VAT",
      tax1Bps: vat,
      notes: "Thank you for your business.",
      subtotalMinor: totals.subtotalMinor,
      totalMinor: totals.totalMinor,
      sentAt: r.status === "SENT" ? midnight(r.issueDate) : null,
      createdBy: owner,
    });
    await db.insert(invoiceItem).values(
      r.lines.map((l, position) => ({
        id: randomUUID(),
        invoiceId: id,
        position: position + 1,
        ...l,
      })),
    );
    if (r.status === "SENT") {
      if (timeLine.entryIds.length > 0 && r.lines[0] === timeLine) {
        await db
          .update(timeEntry)
          .set({ invoiceId: id })
          .where(inArray(timeEntry.id, timeLine.entryIds));
      }
      await db.insert(payment).values({
        id: randomUUID(),
        invoiceId: id,
        date: addDaysToKey(today, -2),
        amountMinor: Math.floor(totals.totalMinor / 2),
        note: "Deposit",
        createdBy: owner,
      });
    }
  }

  await db.insert(recurringInvoice).values({
    id: randomUUID(),
    workspaceId,
    clientId: globex.id,
    name: "Globex monthly retainer",
    schedule: "MONTHLY",
    dayOfMonth: 1,
    startDate: `${today.slice(0, 8)}01`,
    lines: [{ description: "Monthly retainer", quantityCenti: 100, unitPriceMinor: 150_000 }],
    mode: "DRAFT",
    createdBy: owner,
  });
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
    .then(({ workspaceSlug, kioskToken }) => {
      console.info(`[seed] demo workspace ready at /w/${workspaceSlug}`);
      for (const u of DEMO_USERS)
        console.info(`[seed]   ${u.role.padEnd(7)} ${u.email} / ${DEMO_PASSWORD}`);
      // A bearer token: the repo's Actions logs are public.
      if (!process.env.CI) console.info(`[seed] demo kiosk at /kiosk/${kioskToken} (PIN 1234)`);
    })
    .catch((error) => {
      console.error("[seed] failed", error);
      process.exitCode = 1;
    })
    .finally(() => handle.close());
}
