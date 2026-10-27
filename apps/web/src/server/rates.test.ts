import { randomUUID } from "node:crypto";

import { amountFor, type RateRow, resolveRate } from "@timekeep/core";
import { eq, rate, rateEntriesSql, rateRecalcJob, task, timeEntry } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
} from "../../test/db";
import { loadViewer } from "./authz";
import { createProject } from "./catalog/projects";
import type { Viewer } from "./catalog/viewer";
import { currentRate, rateHistory, setRate } from "./rates";
import { createManualEntry } from "./time-entries";

const handle = connectTestDb();
const db = handle.db;

let wsId: string;
let ids: Record<string, string>;
const viewer = (who: string): Promise<Viewer> => loadViewer(db, wsId, ids[who]!);

const MANILA_MAR_9 = new Date("2026-03-08T16:00:00.000Z"); // 2026-03-09 00:00 in Manila

describe("rates", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const ana = await createTestUser(db, "Ana Member");
    const max = await createTestUser(db, "Max Manager");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    wsId = ws.id;
    await addMember(db, ws.id, ana.id, "member");
    await addMember(db, ws.id, max.id, "manager");
    ids = { olga: olga.id, ana: ana.id, max: max.id };
    const owner = await viewer("olga");
    for (const name of ["Web", "App", "Ops"]) {
      const p = await createProject(db, owner, { name });
      ids[name] = p.id;
    }
    const design = randomUUID();
    ids.design = design;
    await db
      .insert(task)
      .values({ id: design, workspaceId: ws.id, projectId: ids.Web!, name: "Design" });
  });

  it("rates entries in SQL exactly as core resolves them", async () => {
    const jan = new Date("2026-01-01T00:00:00Z");
    const rows: RateRow[] = [
      {
        level: "workspace",
        userId: null,
        projectId: null,
        taskId: null,
        amountMinor: 5000,
        currency: "USD",
        effectiveFrom: jan,
      },
      {
        level: "workspace",
        userId: null,
        projectId: null,
        taskId: null,
        amountMinor: 5500,
        currency: "USD",
        effectiveFrom: MANILA_MAR_9,
      },
      {
        level: "member",
        userId: ids.ana!,
        projectId: null,
        taskId: null,
        amountMinor: 6000,
        currency: "USD",
        effectiveFrom: jan,
      },
      {
        level: "project",
        userId: null,
        projectId: ids.Web!,
        taskId: null,
        amountMinor: 8000,
        currency: "USD",
        effectiveFrom: jan,
      },
      // The App project's rate stops on Mar 9: from then on its entries fall through.
      {
        level: "project",
        userId: null,
        projectId: ids.App!,
        taskId: null,
        amountMinor: 7000,
        currency: "USD",
        effectiveFrom: jan,
      },
      {
        level: "project",
        userId: null,
        projectId: ids.App!,
        taskId: null,
        amountMinor: null,
        currency: "USD",
        effectiveFrom: MANILA_MAR_9,
      },
      {
        level: "project_member",
        userId: ids.ana!,
        projectId: ids.Web!,
        taskId: null,
        amountMinor: 9000,
        currency: "USD",
        effectiveFrom: jan,
      },
      {
        level: "task",
        userId: null,
        projectId: ids.Web!,
        taskId: ids.design!,
        amountMinor: 12345,
        currency: "USD",
        effectiveFrom: jan,
      },
      // In the future: never applies to these entries.
      {
        level: "project",
        userId: null,
        projectId: ids.Ops!,
        taskId: null,
        amountMinor: 99999,
        currency: "USD",
        effectiveFrom: new Date("2027-01-01T00:00:00Z"),
      },
    ];
    await db
      .insert(rate)
      .values(
        rows.map((r) => ({ id: randomUUID(), workspaceId: wsId, kind: "billable" as const, ...r })),
      );

    // 36 entries: two people, three projects (with and without the task), no project,
    // either side of Manila's midnight on Mar 9, one still running.
    const starts = [
      "2026-03-08T15:59:00Z",
      "2026-03-08T16:30:00Z",
      "2026-03-02T01:00:00Z",
      "2026-03-12T05:00:00Z",
      "2026-02-27T23:45:00Z",
      // Before any rate is in force: unrated.
      "2025-12-30T10:00:00Z",
    ];
    const combos: { userId: string; projectId: string | null; taskId: string | null }[] = [
      { userId: ids.ana!, projectId: ids.Web!, taskId: ids.design! },
      { userId: ids.ana!, projectId: ids.Web!, taskId: null },
      { userId: ids.olga!, projectId: ids.Web!, taskId: null },
      { userId: ids.ana!, projectId: ids.App!, taskId: null },
      { userId: ids.olga!, projectId: ids.Ops!, taskId: null },
      { userId: ids.olga!, projectId: null, taskId: null },
    ];
    let n = 0;
    for (const start of starts) {
      for (const c of combos) {
        const s = new Date(start);
        const running = n === 7;
        const seconds = 1800 + n * 997;
        await db.insert(timeEntry).values({
          id: randomUUID(),
          workspaceId: wsId,
          ...c,
          billable: true,
          start: s,
          end: running ? null : new Date(s.getTime() + seconds * 1000),
          durationSeconds: running ? null : seconds,
        });
        n++;
      }
    }

    await db.execute(rateEntriesSql(eq(timeEntry.workspaceId, wsId)));

    const entries = await db.select().from(timeEntry).where(eq(timeEntry.workspaceId, wsId));
    expect(entries).toHaveLength(36);
    for (const e of entries) {
      const expected = resolveRate(rows, {
        userId: e.userId,
        projectId: e.projectId,
        taskId: e.taskId,
        start: e.start,
      });
      expect({
        rate: e.billableRateMinor,
        source: e.rateSource,
        amount: e.amountMinor,
      }).toEqual({
        rate: expected?.amountMinor ?? null,
        source: expected?.level ?? null,
        amount:
          expected && e.durationSeconds !== null
            ? amountFor(expected.amountMinor, e.durationSeconds)
            : null,
      });
    }
    // The fixture reaches every level and both fall-through paths.
    expect(new Set(entries.map((e) => e.rateSource))).toEqual(
      new Set(["task", "project_member", "project", "member", "workspace", null]),
    );
  });

  it("adds a row per change and keeps the history", async () => {
    const owner = await viewer("olga");
    const now = new Date("2026-03-11T04:00:00Z");
    await setRate(
      db,
      owner,
      { level: "project", projectId: ids.Web!, amount: "80", apply: "new" },
      now,
    );
    await setRate(
      db,
      owner,
      { level: "project", projectId: ids.Web!, amount: "95.50", apply: "new" },
      now,
    );
    const history = await rateHistory(db, owner, { level: "project", projectId: ids.Web! });
    // Same effective day: the later change replaces that day's row.
    expect(history.map((h) => h.amountMinor)).toEqual([9550]);
    await setRate(
      db,
      owner,
      { level: "project", projectId: ids.Web!, amount: "", apply: "from", from: "2026-04-01" },
      now,
    );
    const later = await rateHistory(db, owner, { level: "project", projectId: ids.Web! });
    expect(later.map((h) => h.amountMinor)).toEqual([null, 9550]);
    expect(later[0]?.createdByName).toBe("Olga Owner");
  });

  it("lets a backdated or all-entries rate replace later rows at its level", async () => {
    const owner = await viewer("olga");
    const target = { level: "project" as const, projectId: ids.Web! };
    await setRate(db, owner, { ...target, amount: "100", apply: "new" }, new Date("2026-10-01T12:00:00Z"));
    // "All entries, past and future": the Oct 1 row must not keep winning after Oct 1.
    await setRate(db, owner, { ...target, amount: "150", apply: "all" }, new Date("2026-10-27T12:00:00Z"));
    expect((await currentRate(db, owner, target, new Date("2026-10-27T12:00:00Z")))?.amountMinor).toBe(15000);
    expect((await rateHistory(db, owner, target)).map((h) => h.amountMinor)).toEqual([15000]);

    // From a date before an existing later row: from then on, the new amount.
    await setRate(db, owner, { ...target, amount: "120", apply: "from", from: "2026-11-01" }, new Date("2026-10-27T12:00:00Z"));
    await setRate(db, owner, { ...target, amount: "130", apply: "from", from: "2026-09-01" }, new Date("2026-10-27T12:00:00Z"));
    expect((await rateHistory(db, owner, target)).map((h) => [h.amountMinor, h.effectiveFrom.slice(0, 10)])).toEqual([
      [13000, "2026-09-01"],
      [15000, "1970-01-01"],
    ]);
  });

  it("refuses an amount the currency cannot hold, and anyone but owners and admins", async () => {
    const owner = await viewer("olga");
    await expect(
      setRate(db, owner, { level: "workspace", amount: "12.345", apply: "new" }),
    ).rejects.toThrow(/amount/i);
    await expect(
      setRate(db, await viewer("max"), { level: "workspace", amount: "10", apply: "new" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("leaves saved entries alone for new entries only, and queues a job for a date", async () => {
    const owner = await viewer("olga");
    const start = new Date("2026-03-02T01:00:00Z");
    const before = await createManualEntry(db, owner, {
      description: "Old work",
      projectId: ids.Web!,
      taskId: null,
      tagIds: [],
      billable: true,
      start,
      end: new Date(start.getTime() + 2 * 3600_000),
    });
    const now = new Date("2026-03-11T04:00:00Z");
    await setRate(db, owner, { level: "workspace", amount: "50", apply: "all" }, now);
    await db.execute(rateEntriesSql(eq(timeEntry.id, before.id)));

    const fresh = await setRate(
      db,
      owner,
      { level: "project", projectId: ids.Web!, amount: "80", apply: "new" },
      now,
    );
    expect(fresh.jobId).toBeNull();
    const [kept] = await db.select().from(timeEntry).where(eq(timeEntry.id, before.id));
    expect(kept?.amountMinor).toBe(10000);

    const backdated = await setRate(
      db,
      owner,
      { level: "project", projectId: ids.Web!, amount: "80", apply: "from", from: "2026-03-01" },
      now,
    );
    expect(backdated.jobId).not.toBeNull();
    const [job] = await db
      .select()
      .from(rateRecalcJob)
      .where(eq(rateRecalcJob.id, backdated.jobId!));
    expect(job).toMatchObject({ status: "queued" });
  });
});
