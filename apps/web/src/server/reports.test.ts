import { randomUUID } from "node:crypto";

import {
  DEFAULT_REPORT_QUERY,
  type ReportQuery,
  type ViewerPrefs,
  zonedDateTimeToInstant,
} from "@timekeep/core";
import { and, eq, membership, projectMember, task, timeEntry } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
  asViewer,
} from "../../test/db";
import { createClient } from "./catalog/clients";
import { createProject } from "./catalog/projects";
import { createTag } from "./catalog/tags";
import type { Viewer } from "./catalog/viewer";
import {
  detailedReport,
  effectiveQuery,
  reportFilterOptions,
  summaryReport,
  weeklyReport,
} from "./reports";
import {
  createManualEntry,
  deleteEntries,
  type EntryScope,
  listEntriesInRange,
  startTimer,
} from "./time-entries";

const handle = connectTestDb();
const db = handle.db;

const TZ = "Asia/Manila";
/** Wed 2026-03-11 12:00 Manila. */
const NOW = new Date("2026-03-11T04:00:00.000Z");
const PREFS: ViewerPrefs = {
  timezone: TZ,
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
const NY: ViewerPrefs = { ...PREFS, timezone: "America/New_York", weekStart: 0 };

/** Mar 2 00:00 → Mar 16 00:00 Manila. */
const RANGE = { from: "2026-03-01T16:00:00.000Z", to: "2026-03-15T16:00:00.000Z" };
const q = (over: Partial<ReportQuery> = {}): ReportQuery => ({
  ...DEFAULT_REPORT_QUERY,
  preset: "custom",
  ...RANGE,
  ...over,
});

let alice: Viewer; // owner
let max: Viewer; // manager
let bob: Viewer; // member
let ids: Record<string, string>;

const at = (date: string, hm: string) => {
  const [h, m] = hm.split(":").map(Number) as [number, number];
  return zonedDateTimeToInstant({ date, hours: h, minutes: m }, TZ);
};

async function entry(
  scope: EntryScope,
  args: {
    description: string;
    date: string;
    start: string;
    hours: number;
    projectId?: string | null;
    taskId?: string | null;
    tagIds?: string[];
    billable?: boolean;
  },
) {
  const start = at(args.date, args.start);
  return createManualEntry(db, scope, {
    description: args.description,
    projectId: args.projectId ?? null,
    taskId: args.taskId ?? null,
    tagIds: args.tagIds ?? [],
    billable: args.billable ?? false,
    start,
    end: new Date(start.getTime() + args.hours * 3_600_000),
  });
}

describe("report engine", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const a = await createTestUser(db, "Alice A");
    const m = await createTestUser(db, "Max M");
    const b = await createTestUser(db, "Bob B");
    const ws = await createTestWorkspace(db, "Workspace A", a.id);
    await addMember(db, ws.id, m.id, "manager");
    await addMember(db, ws.id, b.id, "member");
    alice = asViewer({ workspaceId: ws.id, userId: a.id, role: "owner" });
    max = asViewer({ workspaceId: ws.id, userId: m.id, role: "manager" });
    bob = asViewer({ workspaceId: ws.id, userId: b.id, role: "member" });

    const blank = { address: "", email: "", notes: "", currency: null };
    const acme = await createClient(db, ws.id, { name: "Acme", ...blank });
    const globex = await createClient(db, ws.id, { name: "Globex", ...blank });
    const web = await createProject(db, alice, { name: "Web", clientId: acme.id });
    const app = await createProject(db, alice, {
      name: "App",
      clientId: globex.id,
      visibility: "PRIVATE",
    });
    await db.insert(projectMember).values({ projectId: app.id, userId: b.id });
    await createProject(db, alice, { name: "Secret", visibility: "PRIVATE" });
    const internal = await createProject(db, alice, { name: "Internal" });
    const design = randomUUID();
    const dev = randomUUID();
    await db.insert(task).values([
      { id: design, workspaceId: ws.id, projectId: web.id, name: "Design" },
      { id: dev, workspaceId: ws.id, projectId: web.id, name: "Dev" },
    ]);
    const urgent = await createTag(db, ws.id, { name: "urgent" });
    const review = await createTag(db, ws.id, { name: "review" });
    ids = {
      acme: acme.id,
      globex: globex.id,
      web: web.id,
      app: app.id,
      internal: internal.id,
      design,
      dev,
      urgent: urgent.id,
      review: review.id,
    };

    // Alice: 1.5h + 2h on Web (Acme), 1h Internal, 0.5h without a project = 5h.
    await entry(alice, {
      description: "Design review",
      date: "2026-03-09",
      start: "09:00",
      hours: 1.5,
      projectId: web.id,
      taskId: design,
      tagIds: [urgent.id],
      billable: true,
    });
    await entry(alice, {
      description: "Build",
      date: "2026-03-10",
      start: "11:00",
      hours: 2,
      projectId: web.id,
      taskId: dev,
      tagIds: [urgent.id, review.id],
      billable: true,
    });
    await entry(alice, {
      description: "Standup",
      date: "2026-03-03",
      start: "14:00",
      hours: 1,
      projectId: internal.id,
    });
    await entry(alice, { description: "Email", date: "2026-03-04", start: "08:00", hours: 0.5 });
    // Bob: 1h Web, 1h App (private, member), 1h Internal across midnight = 3h.
    await entry(bob, {
      description: "Fixes",
      date: "2026-03-09",
      start: "13:00",
      hours: 1,
      projectId: web.id,
      tagIds: [review.id],
      billable: true,
    });
    await entry(bob, {
      description: "Mobile",
      date: "2026-03-10",
      start: "09:00",
      hours: 1,
      projectId: app.id,
      billable: true,
    });
    await entry(bob, {
      description: "Late deploy",
      date: "2026-03-09",
      start: "23:30",
      hours: 1,
      projectId: internal.id,
    });
    // Max: 2h Web.
    await entry(max, {
      description: "Review",
      date: "2026-03-05",
      start: "10:00",
      hours: 2,
      projectId: web.id,
      billable: true,
    });
    // Never counted: a running timer and a deleted entry.
    await startTimer(
      db,
      alice,
      { description: "Now", projectId: null, taskId: null, tagIds: [], billable: false },
      NOW,
    );
    const gone = await entry(bob, {
      description: "Gone",
      date: "2026-03-08",
      start: "10:00",
      hours: 4,
    });
    await deleteEntries(db, bob, [gone.id]);
  });

  it("totals equal the entry list's sum for the same range and person", async () => {
    const report = await summaryReport(db, bob, q(), PREFS, NOW);
    const listed = await listEntriesInRange(db, bob, {
      from: new Date(RANGE.from),
      to: new Date(RANGE.to),
    });
    const sum = listed.reduce((n, e) => n + (e.durationSeconds ?? 0), 0);
    expect(sum).toBe(3 * 3600);
    // Bob is a member: amounts (and their unrated count) are hidden from him.
    expect(report.totals).toEqual({
      durationSeconds: sum,
      billableSeconds: 7200,
      entryCount: 3,
      amountMinor: 0,
      unratedCount: 0,
    });
  });

  it("forces a member to their own entries whatever userIds says; a manager reads their scope", async () => {
    expect(effectiveQuery(q({ userIds: [alice.userId] }), bob).userIds).toEqual([bob.userId]);
    const asBob = await summaryReport(db, bob, q({ userIds: [alice.userId] }), PREFS, NOW);
    expect(asBob.totals.durationSeconds).toBe(3 * 3600);
    // Max manages Bob: his own 2h and Bob's 3h (manager-scope.test.ts covers the rest).
    const scoped = asViewer(max, { userIds: [bob.userId] });
    expect(effectiveQuery(q({ userIds: [bob.userId] }), scoped).userIds).toEqual([bob.userId]);
    const asMax = await summaryReport(db, scoped, q(), PREFS, NOW);
    expect(asMax.totals).toMatchObject({
      durationSeconds: 5 * 3600,
      billableSeconds: 5 * 3600 - 3600,
      entryCount: 4,
    });
    const maxForBob = await summaryReport(db, scoped, q({ userIds: [bob.userId] }), PREFS, NOW);
    expect(maxForBob.totals.durationSeconds).toBe(3 * 3600);
    // Without assignments a manager reads only their own time.
    expect((await summaryReport(db, max, q(), PREFS, NOW)).totals.durationSeconds).toBe(2 * 3600);
  });

  it("applies every filter", async () => {
    const total = async (over: Partial<ReportQuery>) =>
      (await summaryReport(db, alice, q(over), PREFS, NOW)).totals.durationSeconds;
    expect(await total({ clientIds: [ids.acme!] })).toBe(6.5 * 3600);
    expect(await total({ clientIds: ["none"] })).toBe(2.5 * 3600); // Internal 1h + 1h, Email 0.5h
    expect(await total({ projectIds: ["none"] })).toBe(0.5 * 3600);
    expect(await total({ projectIds: [ids.web!, "none"] })).toBe(7 * 3600);
    expect(await total({ taskIds: [ids.design!] })).toBe(1.5 * 3600);
    expect(await total({ taskIds: ["none"] })).toBe(6.5 * 3600);
    expect(await total({ tagIds: [ids.urgent!, ids.review!], tagMode: "or" })).toBe(4.5 * 3600);
    expect(await total({ tagIds: [ids.urgent!, ids.review!], tagMode: "and" })).toBe(2 * 3600);
    expect(await total({ tagIds: ["none"] })).toBe(5.5 * 3600);
    expect(await total({ billable: "yes" })).toBe(7.5 * 3600);
    expect(await total({ billable: "no" })).toBe(2.5 * 3600);
    expect(await total({ description: "DEPLOY" })).toBe(3600);
  });

  it("groups by client, project and user with totals at every level; tag groups overlap", async () => {
    const report = await summaryReport(
      db,
      alice,
      q({ groupBy: ["client", "project", "user"] }),
      PREFS,
      NOW,
    );
    expect(report.groups.map((g) => [g.label, g.totals.durationSeconds])).toEqual([
      ["Acme", 6.5 * 3600],
      ["No client", 2.5 * 3600],
      ["Globex", 3600],
    ]);
    const acme = report.groups[0]!;
    expect(acme.children.map((g) => [g.label, g.totals.durationSeconds])).toEqual([
      ["Web", 6.5 * 3600],
    ]);
    expect(acme.children[0]!.children.map((g) => [g.label, g.totals.durationSeconds])).toEqual([
      ["Alice A", 3.5 * 3600],
      ["Max M", 2 * 3600],
      ["Bob B", 3600],
    ]);
    const byTag = await summaryReport(db, alice, q({ groupBy: ["tag"] }), PREFS, NOW);
    expect(byTag.groups.map((g) => [g.label, g.totals.durationSeconds])).toEqual([
      ["No tag", 5.5 * 3600],
      ["urgent", 3.5 * 3600],
      ["review", 3 * 3600],
    ]);
    expect(byTag.totals.durationSeconds).toBe(10 * 3600);
  });

  it("keeps the levels above a tag level equal to grouping without tags", async () => {
    const plain = await summaryReport(db, alice, q({ groupBy: ["client", "project"] }), PREFS, NOW);
    const tagged = await summaryReport(
      db,
      alice,
      q({ groupBy: ["client", "project", "tag"] }),
      PREFS,
      NOW,
    );
    const levels = (groups: typeof plain.groups) =>
      groups.map((g) => [g.label, g.totals, g.children.map((c) => [c.label, c.totals])]);
    expect(levels(tagged.groups)).toEqual(levels(plain.groups));
    const web = tagged.groups[0]!.children[0]!;
    expect(web.totals.durationSeconds).toBe(6.5 * 3600);
    // The tag level itself still overlaps: an entry with two tags sits under both.
    const tagSum = web.children.reduce((sum, g) => sum + g.totals.durationSeconds, 0);
    expect(tagSum).toBeGreaterThan(web.totals.durationSeconds);
  });

  it("dates an entry by its start in the viewer's zone, midnight crossing included", async () => {
    const manila = await summaryReport(db, bob, q({ groupBy: ["date"] }), PREFS, NOW);
    expect(manila.groups.map((g) => [g.id, g.totals.durationSeconds])).toEqual([
      ["2026-03-09", 7200],
      ["2026-03-10", 3600],
    ]);
    const newYork = await summaryReport(db, bob, q({ groupBy: ["date"] }), NY, NOW);
    expect(newYork.groups.map((g) => [g.id, g.totals.durationSeconds])).toEqual([
      ["2026-03-09", 10800],
    ]);
  });

  it("groups by week from the viewer's week start, in the viewer's zone", async () => {
    const byKey = (r: { groups: { id: string | null; totals: { durationSeconds: number } }[] }) =>
      r.groups.map((g) => [g.id, g.totals.durationSeconds]).sort();
    // Manila, Monday weeks: Mar 3 + Mar 4, then Mar 9 + Mar 10.
    const manila = await summaryReport(
      db,
      alice,
      q({ groupBy: ["week"], userIds: [alice.userId] }),
      PREFS,
      NOW,
    );
    expect(byKey(manila)).toEqual([
      ["2026-03-02", 1.5 * 3600],
      ["2026-03-09", 3.5 * 3600],
    ]);
    // In New York the Mar 9 09:00 Manila entry is Sunday Mar 8 evening: a Sunday week
    // starts with it, a Monday week ends with it.
    const sunday = await summaryReport(
      db,
      alice,
      q({ groupBy: ["week"], userIds: [alice.userId] }),
      NY,
      NOW,
    );
    expect(byKey(sunday)).toEqual([
      ["2026-03-01", 1.5 * 3600],
      ["2026-03-08", 3.5 * 3600],
    ]);
    const monday = await summaryReport(
      db,
      alice,
      q({ groupBy: ["week"], userIds: [alice.userId] }),
      { ...NY, weekStart: 1 },
      NOW,
    );
    expect(byKey(monday)).toEqual([
      ["2026-03-02", 3 * 3600],
      ["2026-03-09", 2 * 3600],
    ]);
  });

  it("groups by month in the viewer's zone, not UTC's", async () => {
    // 00:30 on Apr 1 in Manila is still Mar 31 in UTC.
    await entry(alice, {
      description: "Month end",
      date: "2026-03-31",
      start: "23:00",
      hours: 0.5,
    });
    await entry(alice, { description: "New month", date: "2026-04-01", start: "00:30", hours: 1 });
    const report = await summaryReport(
      db,
      alice,
      q({
        groupBy: ["month"],
        userIds: [alice.userId],
        from: "2026-02-28T16:00:00.000Z",
        to: "2026-04-30T16:00:00.000Z",
      }),
      PREFS,
      NOW,
    );
    expect(report.groups.map((g) => [g.id, g.totals.durationSeconds])).toEqual([
      ["2026-03", 5.5 * 3600],
      ["2026-04", 3600],
    ]);
  });

  it("dates entries by their New York day across the fall-back change", async () => {
    const scope = alice;
    const add = (description: string, start: string, hours: number) =>
      createManualEntry(db, scope, {
        description,
        projectId: null,
        taskId: null,
        tagIds: [],
        billable: false,
        start: new Date(start),
        end: new Date(new Date(start).getTime() + hours * 3_600_000),
      });
    // 01:30 EDT, the first of the two 01:30s on Nov 1 2026.
    await add("Early", "2026-11-01T05:30:00.000Z", 1);
    // 23:30 EST on Nov 1: a fixed -04:00 offset would put it on Nov 2.
    await add("Late", "2026-11-02T04:30:00.000Z", 0.5);
    // 00:30 EST on Nov 2.
    await add("Next day", "2026-11-02T05:30:00.000Z", 0.25);
    const report = await summaryReport(
      db,
      alice,
      q({ groupBy: ["date"], from: "2026-11-01T04:00:00.000Z", to: "2026-11-03T05:00:00.000Z" }),
      NY,
      new Date("2026-11-04T12:00:00.000Z"),
    );
    expect(report.groups.map((g) => [g.id, g.totals.durationSeconds])).toEqual([
      ["2026-11-01", 1.5 * 3600],
      ["2026-11-02", 0.25 * 3600],
    ]);
    expect(report.series.map((p) => [p.key, p.nonBillableSeconds])).toEqual([
      ["2026-11-01", 1.5 * 3600],
      ["2026-11-02", 0.25 * 3600],
    ]);
  });

  it("builds a day series over the range with empty days, whose sum is the total", async () => {
    const report = await summaryReport(db, alice, q(), PREFS, NOW);
    expect(report.bucket).toBe("day");
    expect(report.series).toHaveLength(14);
    expect(report.series[0]).toMatchObject({
      key: "2026-03-02",
      billableSeconds: 0,
      nonBillableSeconds: 0,
    });
    const sum = report.series.reduce((n, p) => n + p.billableSeconds + p.nonBillableSeconds, 0);
    expect(sum).toBe(10 * 3600);
    expect(report.series.find((p) => p.key === "2026-03-09")).toMatchObject({
      billableSeconds: 2.5 * 3600,
      nonBillableSeconds: 3600,
    });
  });

  it("rows of deactivated or removed members are read-only: no scope can be built for them", async () => {
    await db
      .update(membership)
      .set({ status: "DEACTIVATED" })
      .where(and(eq(membership.workspaceId, alice.workspaceId), eq(membership.userId, bob.userId)));
    await db
      .delete(membership)
      .where(and(eq(membership.workspaceId, alice.workspaceId), eq(membership.userId, max.userId)));
    const page = await detailedReport(
      db,
      alice,
      q(),
      PREFS,
      { sort: "start", dir: "desc", limit: 50 },
      NOW,
    );
    const of = (userId: string) => page.entries.filter((e) => e.userId === userId);
    expect(of(bob.userId).length).toBeGreaterThan(0);
    expect(of(max.userId).length).toBeGreaterThan(0);
    expect(of(bob.userId).every((e) => !e.editable)).toBe(true);
    expect(of(max.userId).every((e) => !e.editable)).toBe(true);
    expect(of(alice.userId).every((e) => e.editable)).toBe(true);
  });

  it("sums the range on the first page only, so an export's page loop does not repeat it", async () => {
    const page = (cursor?: { value: string; id: string }) =>
      detailedReport(db, alice, q(), PREFS, { cursor, sort: "start", dir: "desc", limit: 3 }, NOW);
    const p1 = await page();
    expect(p1.totals).toMatchObject({ entryCount: 8, durationSeconds: 10 * 3600 });
    const p2 = await page(p1.nextCursor!);
    expect(p2.entries).toHaveLength(3);
    expect(p2.totals).toBeNull();
  });

  it("pages entries by keyset, stable across an insert, and sorts by duration", async () => {
    const page = (cursor?: { value: string; id: string }, sort: "start" | "duration" = "start") =>
      detailedReport(db, alice, q(), PREFS, { cursor, sort, dir: "desc", limit: 3 }, NOW);
    const p1 = await page();
    expect(p1.entries).toHaveLength(3);
    expect(p1.totals?.entryCount).toBe(8);
    expect(p1.entries[0]!.description).toBe("Build");
    // An owner may write everyone's time (Phase 4b add time for others): every row is editable.
    expect(p1.entries.map((e) => e.editable)).toEqual([true, true, true]);
    expect(p1.nextCursor).not.toBeNull();
    await entry(alice, { description: "Newest", date: "2026-03-11", start: "08:00", hours: 1 });
    const p2 = await page(p1.nextCursor!);
    const p3 = await page(p2.nextCursor!);
    expect(p3.nextCursor).toBeNull();
    const all = [...p1.entries, ...p2.entries, ...p3.entries].map((e) => e.id);
    expect(new Set(all).size).toBe(8);
    expect([...p1.entries, ...p2.entries, ...p3.entries].map((e) => e.description)).not.toContain(
      "Newest",
    );
    const byDuration = await page(undefined, "duration");
    expect(byDuration.entries.map((e) => e.durationSeconds)).toEqual([7200, 7200, 5400]);
    expect(p1.entries[0]).toMatchObject({
      projectName: "Web",
      clientName: "Acme",
      taskName: "Dev",
      userName: "Alice A",
      billable: true,
    });
    expect(p1.entries[0]!.tags.sort()).toEqual(["review", "urgent"]);
  });

  it("lays the week out by user and by project with day totals equal to the summary", async () => {
    const week = q({ from: "2026-03-08T16:00:00.000Z", to: "2026-03-15T16:00:00.000Z" });
    const byUser = await weeklyReport(db, alice, { ...week, weeklyBy: "user" }, PREFS, NOW);
    expect(byUser.dayKeys[0]).toBe("2026-03-09");
    expect(byUser.rows.map((r) => [r.label, r.total])).toEqual([
      ["Alice A", 3.5 * 3600],
      ["Bob B", 3 * 3600],
    ]);
    expect(byUser.dayTotals.slice(0, 2)).toEqual([3.5 * 3600, 3 * 3600]);
    const summary = await summaryReport(db, alice, week, PREFS, NOW);
    expect(byUser.total).toBe(summary.totals.durationSeconds);
    const byProject = await weeklyReport(db, alice, week, PREFS, NOW);
    expect(byProject.rows.map((r) => [r.label, r.total])).toEqual([
      ["Web", 4.5 * 3600],
      ["App", 3600],
      ["Internal", 3600],
    ]);
  });

  it("sums beyond 2^31 seconds without overflowing", async () => {
    // 700 entries of 999 hours: about 2.5 billion seconds, past a 32-bit integer.
    const hours999 = 999 * 3600;
    const base = new Date("2025-06-01T00:00:00.000Z").getTime();
    await db.insert(timeEntry).values(
      Array.from({ length: 700 }, (_, i) => ({
        id: randomUUID(),
        workspaceId: bob.workspaceId,
        userId: bob.userId,
        description: "Long",
        start: new Date(base + i * 3_600_000),
        end: new Date(base + i * 3_600_000 + hours999 * 1000),
        durationSeconds: hours999,
        billable: true,
      })),
    );
    const report = await summaryReport(
      db,
      alice,
      q({ from: "2025-05-31T00:00:00.000Z", to: "2025-07-01T00:00:00.000Z" }),
      PREFS,
      NOW,
    );
    expect(report.totals).toMatchObject({
      durationSeconds: 700 * hours999,
      billableSeconds: 700 * hours999,
      entryCount: 700,
    });
    expect(report.groups[0]!.totals.durationSeconds).toBe(700 * hours999);
  });

  it("offers filter options by role: no users for a member, only visible projects", async () => {
    const forAlice = await reportFilterOptions(db, alice);
    expect(forAlice.users?.map((u) => u.name)).toEqual(["Alice A", "Max M", "Bob B"]);
    expect(forAlice.projects.map((p) => p.name).sort()).toEqual([
      "App",
      "Internal",
      "Secret",
      "Web",
    ]);
    expect(forAlice.tasks.map((t) => t.name).sort()).toEqual(["Design", "Dev"]);
    const forBob = await reportFilterOptions(db, bob);
    expect(forBob.users).toBeNull();
    expect(forBob.projects.map((p) => p.name).sort()).toEqual(["App", "Internal", "Web"]);
    expect(forBob.clients.map((c) => c.name)).toEqual(["Acme", "Globex"]);
    expect(forBob.tags.map((t) => t.name)).toEqual(["review", "urgent"]);
  });

  it("lists former members whose time is still in the reports, after the active ones", async () => {
    const fay = await createTestUser(db, "Fay F");
    await addMember(db, alice.workspaceId, fay.id, "member");
    const fayScope = asViewer({ workspaceId: alice.workspaceId, userId: fay.id, role: "member" });
    await entry(fayScope, {
      description: "Handover",
      date: "2026-03-09",
      start: "09:00",
      hours: 2,
    });
    await db
      .delete(membership)
      .where(and(eq(membership.workspaceId, alice.workspaceId), eq(membership.userId, fay.id)));
    // Deactivated, but never tracked here: nothing to filter by.
    const gus = await createTestUser(db, "Gus G");
    await addMember(db, alice.workspaceId, gus.id, "member", "DEACTIVATED");

    const options = await reportFilterOptions(db, alice);
    expect(options.users?.map((u) => u.name)).toEqual([
      "Alice A",
      "Max M",
      "Bob B",
      "Fay F (former member)",
    ]);
    expect(options.users?.at(-1)?.id).toBe(fay.id);
    const report = await summaryReport(db, alice, q({ userIds: [fay.id] }), PREFS, NOW);
    expect(report.totals.durationSeconds).toBe(2 * 3600);
  });
});
