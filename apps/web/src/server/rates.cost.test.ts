import { randomUUID } from "node:crypto";

import { amountFor, type RateRow, resolveRate } from "@timekeep/core";
import {
  client,
  eq,
  project,
  rate,
  rateEntriesSql,
  rateEntry,
  recomputeAmount,
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

// Phase 6a: the rating SQL snapshots cost beside the billable rate, and a
// billable rate applies only in the entry's currency.

const handle = connectTestDb();
const db = handle.db;

let wsId: string;
let ids: Record<string, string>;

const JAN = new Date("2026-01-01T00:00:00Z");
const H = 3600;

async function insertRate(row: RateRow): Promise<void> {
  await db.insert(rate).values({ id: randomUUID(), workspaceId: wsId, ...row });
}
const rateRow = (over: Partial<RateRow>): RateRow => ({
  kind: "billable",
  level: "workspace",
  userId: null,
  projectId: null,
  taskId: null,
  amountMinor: 100_000,
  currency: "PHP",
  effectiveFrom: JAN,
  ...over,
});

async function insertEntry(over: {
  userId: string;
  projectId: string | null;
  start?: Date;
  seconds?: number | null;
  billable?: boolean;
  type?: "work" | "break";
}): Promise<string> {
  const id = randomUUID();
  const start = over.start ?? new Date("2026-03-02T01:00:00Z");
  const seconds = over.seconds === undefined ? 2 * H : over.seconds;
  await db.insert(timeEntry).values({
    id,
    workspaceId: wsId,
    userId: over.userId,
    projectId: over.projectId,
    billable: over.billable ?? true,
    type: over.type ?? "work",
    start,
    end: seconds === null ? null : new Date(start.getTime() + seconds * 1000),
    durationSeconds: seconds,
  });
  return id;
}

async function entry(id: string) {
  const [row] = await db.select().from(timeEntry).where(eq(timeEntry.id, id));
  if (!row) throw new Error("entry not found");
  return row;
}

describe("rating SQL: cost and currencies", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const ana = await createTestUser(db, "Ana Member");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    wsId = ws.id;
    await addMember(db, ws.id, ana.id, "member");
    await db
      .update(workspaceSettings)
      .set({ currency: "PHP" })
      .where(eq(workspaceSettings.workspaceId, ws.id));
    ids = { olga: olga.id, ana: ana.id };
    const owner = await loadViewer(db, ws.id, olga.id);
    for (const name of ["Web", "App"]) {
      ids[name] = (await createProject(db, owner, { name })).id;
    }
    // A client billed in USD, with one project.
    const acme = randomUUID();
    await db.insert(client).values({ id: acme, workspaceId: ws.id, name: "Acme", currency: "USD" });
    ids.Us = (await createProject(db, owner, { name: "Us" })).id;
    await db.update(project).set({ clientId: acme }).where(eq(project.id, ids.Us));
  });

  it("costs entries in SQL exactly as core resolves them", async () => {
    const rows: RateRow[] = [
      rateRow({ kind: "cost", level: "member", userId: ids.ana!, amountMinor: 60_000 }),
      rateRow({
        kind: "cost",
        level: "member",
        userId: ids.ana!,
        amountMinor: 70_000,
        effectiveFrom: new Date("2026-04-01T00:00:00Z"),
      }),
      rateRow({
        kind: "cost",
        level: "project_member",
        userId: ids.ana!,
        projectId: ids.Web!,
        amountMinor: 80_000,
      }),
      // From mid-March the project-member level says "no cost here": the member's applies.
      rateRow({
        kind: "cost",
        level: "project_member",
        userId: ids.ana!,
        projectId: ids.Web!,
        amountMinor: null,
        effectiveFrom: new Date("2026-03-15T00:00:00Z"),
      }),
      // Billable rows and cost rows at other levels never answer a cost.
      rateRow({ level: "workspace", amountMinor: 100_000 }),
      rateRow({ kind: "cost", level: "workspace", amountMinor: 1 }),
      rateRow({ kind: "cost", level: "project", projectId: ids.Web!, amountMinor: 2 }),
    ];
    for (const r of rows) await insertRate(r);

    const starts = ["2026-02-01T03:00:00Z", "2026-03-20T03:00:00Z", "2026-04-02T03:00:00Z"];
    const combos = [
      { userId: ids.ana!, projectId: ids.Web! },
      { userId: ids.ana!, projectId: ids.App! },
      { userId: ids.ana!, projectId: null },
      { userId: ids.olga!, projectId: ids.Web! },
    ];
    let n = 0;
    for (const start of [...starts, "2025-12-01T03:00:00Z"]) {
      for (const c of combos) {
        await insertEntry({
          ...c,
          start: new Date(start),
          seconds: n === 5 ? null : 1800 + n * 997,
          billable: n % 2 === 0,
        });
        n++;
      }
    }

    await db.execute(rateEntriesSql(eq(timeEntry.workspaceId, wsId)));

    const entries = await db.select().from(timeEntry).where(eq(timeEntry.workspaceId, wsId));
    expect(entries).toHaveLength(16);
    for (const e of entries) {
      const expected = resolveRate(
        rows,
        {
          userId: e.userId,
          projectId: e.projectId,
          taskId: e.taskId,
          start: e.start,
          currency: "PHP",
        },
        "cost",
      );
      expect({
        rate: e.costRateMinor,
        source: e.costRateSource,
        amount: e.costAmountMinor,
      }).toEqual({
        rate: expected?.amountMinor ?? null,
        source: expected?.level ?? null,
        amount:
          expected && e.durationSeconds !== null
            ? amountFor(expected.amountMinor, e.durationSeconds)
            : null,
      });
    }
    expect(new Set(entries.map((e) => e.costRateSource))).toEqual(
      new Set(["project_member", "member", null]),
    );
  });

  it("does not let a member rate bill a project in another currency", async () => {
    await insertRate(rateRow({ level: "member", userId: ids.ana!, amountMinor: 250_000 }));
    const local = await insertEntry({ userId: ids.ana!, projectId: ids.Web! });
    const foreign = await insertEntry({ userId: ids.ana!, projectId: ids.Us! });
    await db.execute(rateEntriesSql(eq(timeEntry.workspaceId, wsId)));

    expect(await entry(local)).toMatchObject({
      billableRateMinor: 250_000,
      rateCurrency: "PHP",
      rateSource: "member",
      amountMinor: 500_000,
    });
    // Never ₱2,500 read as $2,500: without a rate in USD the time is unrated.
    expect(await entry(foreign)).toMatchObject({
      billableRateMinor: null,
      rateCurrency: null,
      rateSource: null,
      amountMinor: null,
    });

    await insertRate(
      rateRow({ level: "project", projectId: ids.Us!, amountMinor: 4000, currency: "USD" }),
    );
    await db.execute(rateEntriesSql(eq(timeEntry.workspaceId, wsId)));
    expect(await entry(foreign)).toMatchObject({
      billableRateMinor: 4000,
      rateCurrency: "USD",
      rateSource: "project",
      amountMinor: 8000,
    });
    expect((await entry(local)).rateCurrency).toBe("PHP");
  });

  it("costs billable and non-billable work, and never a break", async () => {
    await insertRate(
      rateRow({ kind: "cost", level: "member", userId: ids.ana!, amountMinor: 60_000 }),
    );
    const billable = await insertEntry({ userId: ids.ana!, projectId: ids.Web!, billable: true });
    const internal = await insertEntry({ userId: ids.ana!, projectId: null, billable: false });
    const pause = await insertEntry({
      userId: ids.ana!,
      projectId: null,
      billable: false,
      type: "break",
    });
    // A USD project costs the same: cost is the workspace's currency, whatever is billed.
    const foreign = await insertEntry({ userId: ids.ana!, projectId: ids.Us! });
    await db.execute(rateEntriesSql(eq(timeEntry.workspaceId, wsId)));

    for (const id of [billable, internal, foreign]) {
      expect(await entry(id)).toMatchObject({
        costRateMinor: 60_000,
        costRateSource: "member",
        costAmountMinor: 120_000,
      });
    }
    expect(await entry(pause)).toMatchObject({
      costRateMinor: null,
      costRateSource: null,
      costAmountMinor: null,
      billableRateMinor: null,
    });
  });

  it("leaves the cost amount null while the entry runs and computes it on stop", async () => {
    await insertRate(
      rateRow({ kind: "cost", level: "member", userId: ids.ana!, amountMinor: 60_000 }),
    );
    await insertRate(rateRow({ level: "workspace", amountMinor: 100_000 }));
    const id = await insertEntry({ userId: ids.ana!, projectId: ids.Web!, seconds: null });
    await rateEntry(db, id);
    expect(await entry(id)).toMatchObject({
      costRateMinor: 60_000,
      costAmountMinor: null,
      billableRateMinor: 100_000,
      amountMinor: null,
    });

    const running = await entry(id);
    await db
      .update(timeEntry)
      .set({ end: new Date(running.start.getTime() + 5400_000), durationSeconds: 5400 })
      .where(eq(timeEntry.id, id));
    await recomputeAmount(db, id);
    expect(await entry(id)).toMatchObject({ costAmountMinor: 90_000, amountMinor: 150_000 });
  });

  it("rates one kind and leaves the other snapshot alone", async () => {
    const costId = randomUUID();
    const billId = randomUUID();
    await db.insert(rate).values([
      {
        id: costId,
        workspaceId: wsId,
        ...rateRow({ kind: "cost", level: "member", userId: ids.ana!, amountMinor: 60_000 }),
      },
      { id: billId, workspaceId: wsId, ...rateRow({ level: "workspace", amountMinor: 100_000 }) },
    ]);
    const id = await insertEntry({ userId: ids.ana!, projectId: ids.Web! });
    await rateEntry(db, id);
    await db.update(rate).set({ amountMinor: 75_000 }).where(eq(rate.id, costId));
    await db.update(rate).set({ amountMinor: 110_000 }).where(eq(rate.id, billId));

    await rateEntry(db, id, { billable: true });
    expect(await entry(id)).toMatchObject({ billableRateMinor: 110_000, costRateMinor: 60_000 });

    await db.update(rate).set({ amountMinor: 120_000 }).where(eq(rate.id, billId));
    await rateEntry(db, id, { cost: true });
    expect(await entry(id)).toMatchObject({
      billableRateMinor: 110_000,
      amountMinor: 220_000,
      costRateMinor: 75_000,
      costAmountMinor: 150_000,
    });
  });
});
