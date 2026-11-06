import { randomUUID } from "node:crypto";

import { amountFor, can, type RateRow, resolveRate } from "@timekeep/core";
import {
  client,
  eq,
  project,
  rate,
  rateEntriesSql,
  rateRecalcJob,
  task,
  timeEntry,
  workspaceSettings,
} from "@timekeep/db";
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
import { currentRate, currentRatesAt, rateHistory, type RateTargetInput, setRate } from "./rates";
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
        kind: "billable",
        level: "workspace",
        userId: null,
        projectId: null,
        taskId: null,
        amountMinor: 5000,
        currency: "USD",
        effectiveFrom: jan,
      },
      {
        kind: "billable",
        level: "workspace",
        userId: null,
        projectId: null,
        taskId: null,
        amountMinor: 5500,
        currency: "USD",
        effectiveFrom: MANILA_MAR_9,
      },
      {
        kind: "billable",
        level: "member",
        userId: ids.ana!,
        projectId: null,
        taskId: null,
        amountMinor: 6000,
        currency: "USD",
        effectiveFrom: jan,
      },
      {
        kind: "billable",
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
        kind: "billable",
        level: "project",
        userId: null,
        projectId: ids.App!,
        taskId: null,
        amountMinor: 7000,
        currency: "USD",
        effectiveFrom: jan,
      },
      {
        kind: "billable",
        level: "project",
        userId: null,
        projectId: ids.App!,
        taskId: null,
        amountMinor: null,
        currency: "USD",
        effectiveFrom: MANILA_MAR_9,
      },
      {
        kind: "billable",
        level: "project_member",
        userId: ids.ana!,
        projectId: ids.Web!,
        taskId: null,
        amountMinor: 9000,
        currency: "USD",
        effectiveFrom: jan,
      },
      {
        kind: "billable",
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
        kind: "billable",
        level: "project",
        userId: null,
        projectId: ids.Ops!,
        taskId: null,
        amountMinor: 99999,
        currency: "USD",
        effectiveFrom: new Date("2027-01-01T00:00:00Z"),
      },
    ];
    await db.insert(rate).values(rows.map((r) => ({ id: randomUUID(), workspaceId: wsId, ...r })));

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
        currency: "USD",
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
    await setRate(
      db,
      owner,
      { ...target, amount: "100", apply: "new" },
      new Date("2026-10-01T12:00:00Z"),
    );
    // "All entries, past and future": the Oct 1 row must not keep winning after Oct 1.
    await setRate(
      db,
      owner,
      { ...target, amount: "150", apply: "all" },
      new Date("2026-10-27T12:00:00Z"),
    );
    expect(
      (await currentRate(db, owner, target, new Date("2026-10-27T12:00:00Z")))?.amountMinor,
    ).toBe(15000);
    expect((await rateHistory(db, owner, target)).map((h) => h.amountMinor)).toEqual([15000]);

    // From a date before an existing later row: from then on, the new amount.
    await setRate(
      db,
      owner,
      { ...target, amount: "120", apply: "from", from: "2026-11-01" },
      new Date("2026-10-27T12:00:00Z"),
    );
    await setRate(
      db,
      owner,
      { ...target, amount: "130", apply: "from", from: "2026-09-01" },
      new Date("2026-10-27T12:00:00Z"),
    );
    expect(
      (await rateHistory(db, owner, target)).map((h) => [
        h.amountMinor,
        h.effectiveFrom.slice(0, 10),
      ]),
    ).toEqual([
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

  // Phase 6a: cost rates share the table (kind = 'cost'), and a rate is in the
  // currency of what it prices: the workspace's, or the project's client's.
  describe("cost rates and currencies", () => {
    const now = new Date("2026-03-11T04:00:00Z");
    const setCurrency = (currency: string) =>
      db.update(workspaceSettings).set({ currency }).where(eq(workspaceSettings.workspaceId, wsId));

    beforeEach(async () => {
      await setCurrency("PHP");
      // Ops is billed in USD; Web and App have no client.
      const acme = randomUUID();
      await db
        .insert(client)
        .values({ id: acme, workspaceId: wsId, name: "Acme", currency: "USD" });
      await db.update(project).set({ clientId: acme }).where(eq(project.id, ids.Ops!));
    });

    it("a cost rate is stored in the workspace currency at member and project-member levels only", async () => {
      const owner = await viewer("olga");
      const member = await setRate(
        db,
        owner,
        { kind: "cost", level: "member", userId: ids.ana!, amount: "600", apply: "new" },
        now,
      );
      expect(member.rate).toMatchObject({
        kind: "cost",
        level: "member",
        amountMinor: 60_000,
        currency: "PHP",
      });
      // On a project billed in USD the cost is still what the company pays, in PHP.
      const onOps = await setRate(
        db,
        owner,
        {
          kind: "cost",
          level: "project_member",
          userId: ids.ana!,
          projectId: ids.Ops!,
          amount: "750",
          apply: "new",
        },
        now,
      );
      expect(onOps.rate).toMatchObject({ kind: "cost", amountMinor: 75_000, currency: "PHP" });

      const refused = [
        { level: "workspace" as const },
        { level: "project" as const, projectId: ids.Web! },
        { level: "task" as const, taskId: ids.design! },
      ];
      for (const target of refused) {
        await expect(
          setRate(db, owner, { kind: "cost", ...target, amount: "10", apply: "new" }, now),
        ).rejects.toThrow("Cost rates are per member or per project member.");
      }
      const rows = await db.select().from(rate).where(eq(rate.workspaceId, wsId));
      expect(rows.map((r) => [r.kind, r.level, r.currency]).sort()).toEqual([
        ["cost", "member", "PHP"],
        ["cost", "project_member", "PHP"],
      ]);
    });

    it("a project rate takes the client's currency", async () => {
      const owner = await viewer("olga");
      const set = async (input: RateTargetInput, amount: string) =>
        (await setRate(db, owner, { ...input, amount, apply: "new" }, now)).rate;

      expect(await set({ level: "project", projectId: ids.Ops! }, "40")).toMatchObject({
        currency: "USD",
        amountMinor: 4000,
      });
      expect(
        await set({ level: "project_member", projectId: ids.Ops!, userId: ids.ana! }, "45.5"),
      ).toMatchObject({ currency: "USD", amountMinor: 4550 });
      // A project without a client, its task, a member and the workspace: the workspace's.
      expect(await set({ level: "project", projectId: ids.Web! }, "2000")).toMatchObject({
        currency: "PHP",
      });
      expect(await set({ level: "task", taskId: ids.design! }, "2100")).toMatchObject({
        currency: "PHP",
      });
      expect(await set({ level: "member", userId: ids.ana! }, "2500")).toMatchObject({
        currency: "PHP",
      });
      expect(await set({ level: "workspace" }, "1500")).toMatchObject({ currency: "PHP" });

      // The typed amount is read in the rate's own currency: yen has no decimals, dollars two.
      await setCurrency("JPY");
      await expect(set({ level: "member", userId: ids.ana! }, "2500.50")).rejects.toThrow(
        /amount in JPY/,
      );
      expect(await set({ level: "project", projectId: ids.Ops! }, "42.50")).toMatchObject({
        currency: "USD",
        amountMinor: 4250,
      });
    });

    it("cost history and the current cost rate read by kind", async () => {
      const owner = await viewer("olga");
      const ana = ids.ana!;
      await setRate(db, owner, { level: "member", userId: ana, amount: "2500", apply: "new" }, now);
      await setRate(
        db,
        owner,
        { level: "member", userId: ana, amount: "2600", apply: "from", from: "2026-05-01" },
        now,
      );
      await setRate(
        db,
        owner,
        { kind: "cost", level: "member", userId: ana, amount: "600", apply: "new" },
        now,
      );
      // A backdated cost row replaces later cost rows only: the May billable row stays.
      await setRate(
        db,
        owner,
        {
          kind: "cost",
          level: "member",
          userId: ana,
          amount: "700",
          apply: "from",
          from: "2026-04-01",
        },
        now,
      );

      const cost = await rateHistory(db, owner, { kind: "cost", level: "member", userId: ana });
      expect(cost.map((h) => [h.kind, h.amountMinor])).toEqual([
        ["cost", 70_000],
        ["cost", 60_000],
      ]);
      const billable = await rateHistory(db, owner, { level: "member", userId: ana });
      expect(billable.map((h) => [h.kind, h.amountMinor])).toEqual([
        ["billable", 260_000],
        ["billable", 250_000],
      ]);

      const cur = (kind?: "cost") =>
        currentRate(db, owner, { ...(kind ? { kind } : {}), level: "member", userId: ana }, now);
      expect((await cur("cost"))?.amountMinor).toBe(60_000);
      expect((await cur())?.amountMinor).toBe(250_000);
      expect(await currentRatesAt(db, owner, "member", { kind: "cost", now })).toEqual(
        new Map([[ana, 60_000]]),
      );
      expect(await currentRatesAt(db, owner, "member", { now })).toEqual(new Map([[ana, 250_000]]));
    });

    it("a manager cannot read cost rate rows", async () => {
      const cost = { kind: "cost" as const, level: "member" as const, userId: ids.ana! };
      await setRate(db, await viewer("olga"), { ...cost, amount: "600", apply: "new" }, now);
      // Seeing cost in reports (the workspace setting) is not seeing what people are paid.
      await db
        .update(workspaceSettings)
        .set({ managersSeeCosts: true })
        .where(eq(workspaceSettings.workspaceId, wsId));
      const max = await viewer("max");
      expect(can(max.actor, "report.viewCosts", { kind: "none" })).toBe(true);
      expect(can((await viewer("ana")).actor, "report.viewCosts", { kind: "none" })).toBe(false);

      await expect(rateHistory(db, max, cost)).rejects.toMatchObject({ status: 403 });
      await expect(currentRatesAt(db, max, "member", { kind: "cost" })).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        setRate(db, max, { ...cost, amount: "1", apply: "new" }, now),
      ).rejects.toMatchObject({ status: 403 });
    });

    it("a manager sees cost in reports only while the workspace says so", async () => {
      expect(can((await viewer("max")).actor, "report.viewCosts", { kind: "none" })).toBe(false);
      expect(can((await viewer("olga")).actor, "report.viewCosts", { kind: "none" })).toBe(true);
    });
  });
});
