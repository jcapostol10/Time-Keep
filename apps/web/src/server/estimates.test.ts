import { randomUUID } from "node:crypto";

import { type Estimate, NO_ESTIMATE } from "@timekeep/core";
import { client, eq, rate, timeEntry, workspaceSettings } from "@timekeep/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb, createTestUser, createTestWorkspace, truncateAll } from "../../test/db";
import { loadViewer } from "./authz";
import { createProject } from "./catalog/projects";
import type { Viewer } from "./catalog/viewer";
import { progressFor } from "./estimates";
import { createManualEntry, deleteEntries, startTimer } from "./time-entries";

// Phase 6b, decisions 10 and 11: progress is one aggregate over raw, stopped
// work entries of the estimate's period, never rounded, never scoped.

const handle = connectTestDb();
const db = handle.db;

let wsId: string;
let owner: Viewer;

const TZ = "Asia/Manila";
const NOW = new Date("2026-11-08T04:00:00Z");
const HOUR = 3_600_000;

const time = (seconds: number, reset: Estimate["reset"] = "NONE"): Estimate => ({
  kind: "TIME",
  seconds,
  minor: null,
  reset,
  alerts: true,
});
const money = (minor: number, reset: Estimate["reset"] = "NONE"): Estimate => ({
  kind: "MONEY",
  seconds: null,
  minor,
  reset,
  alerts: true,
});

async function entry(
  projectId: string | null,
  start: Date,
  hours: number,
  over: Partial<Parameters<typeof createManualEntry>[2]> = {},
) {
  return createManualEntry(db, owner, {
    description: "work",
    projectId,
    taskId: null,
    tagIds: [],
    billable: true,
    start,
    end: new Date(start.getTime() + hours * HOUR),
    ...over,
  });
}

describe("progressFor", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    wsId = ws.id;
    await db
      .update(workspaceSettings)
      .set({ timezone: TZ, currency: "USD", allowBreaks: true })
      .where(eq(workspaceSettings.workspaceId, ws.id));
    owner = await loadViewer(db, ws.id, olga.id);
  });

  it("time progress counts all stopped work on the project, raw", async () => {
    const p = await createProject(db, owner, { name: "Site" });
    const at = new Date("2026-11-07T02:00:00Z");
    await entry(p.id, at, 1);
    await entry(p.id, new Date(at.getTime() + 2 * HOUR), 0.5, { billable: false });
    const gone = await entry(p.id, new Date(at.getTime() + 4 * HOUR), 3);
    await deleteEntries(db, owner, [gone.id]);
    // A break on the project's day, and a running timer: neither counts.
    await entry(null, new Date(at.getTime() + 8 * HOUR), 0.25, { type: "break" });
    await startTimer(
      db,
      owner,
      { description: "live", projectId: p.id, taskId: null, tagIds: [], billable: true },
      NOW,
    );

    const progress = await progressFor(
      db,
      wsId,
      [{ id: p.id, estimate: time(36_000), currency: "USD" }],
      NOW,
      TZ,
    );
    expect(progress.get(p.id)).toMatchObject({
      kind: "TIME",
      used: 5_400,
      estimate: 36_000,
      percent: 15,
      currency: null,
      period: { key: "all", from: null, to: null, label: null },
    });
  });

  it("a monthly estimate counts the current month in the workspace timezone", async () => {
    const p = await createProject(db, owner, { name: "Site" });
    // 23:30 on Nov 30 in Manila: last month. 00:30 on Dec 1: this month.
    await entry(p.id, new Date("2026-11-30T15:30:00Z"), 0.5);
    await entry(p.id, new Date("2026-11-30T16:30:00Z"), 2);
    const now = new Date("2026-11-30T17:00:00Z");
    const progress = await progressFor(
      db,
      wsId,
      [{ id: p.id, estimate: time(36_000, "MONTHLY"), currency: "USD" }],
      now,
      TZ,
    );
    expect(progress.get(p.id)).toMatchObject({
      used: 7_200,
      percent: 20,
      period: { key: "2026-12", label: "December 2026" },
    });
  });

  it("money progress sums billable amounts in the project's currency only", async () => {
    const clientId = randomUUID();
    await db
      .insert(client)
      .values({ id: clientId, workspaceId: wsId, name: "Globex", currency: "EUR" });
    const p = await createProject(db, owner, { name: "Eu", clientId });
    await db.insert(rate).values({
      id: randomUUID(),
      workspaceId: wsId,
      level: "project",
      projectId: p.id,
      currency: "EUR",
      amountMinor: 5_000,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });
    const at = new Date("2026-11-07T02:00:00Z");
    const inEur = await entry(p.id, at, 1);
    const stale = await entry(p.id, new Date(at.getTime() + 2 * HOUR), 1);
    await entry(p.id, new Date(at.getTime() + 4 * HOUR), 1, { billable: false });
    const [rated] = await db.select().from(timeEntry).where(eq(timeEntry.id, inEur.id));
    expect(rated).toMatchObject({ rateCurrency: "EUR", amountMinor: 5_000 });
    // An amount left in another currency (rated before the client chose EUR): left out.
    await db
      .update(timeEntry)
      .set({ rateCurrency: "USD", billableRateMinor: 9_900, amountMinor: 9_900 })
      .where(eq(timeEntry.id, stale.id));

    const progress = await progressFor(
      db,
      wsId,
      [{ id: p.id, estimate: money(20_000), currency: "EUR" }],
      NOW,
      TZ,
    );
    expect(progress.get(p.id)).toMatchObject({
      kind: "MONEY",
      used: 5_000,
      estimate: 20_000,
      percent: 25,
      currency: "EUR",
    });
  });

  it("projects without an estimate are skipped", async () => {
    const p = await createProject(db, owner, { name: "Site" });
    const q = await createProject(db, owner, { name: "Other" });
    await entry(p.id, new Date("2026-11-07T02:00:00Z"), 1);
    const progress = await progressFor(
      db,
      wsId,
      [
        { id: p.id, estimate: NO_ESTIMATE, currency: "USD" },
        { id: q.id, estimate: time(3_600), currency: "USD" },
      ],
      NOW,
      TZ,
    );
    expect(progress.has(p.id)).toBe(false);
    expect(progress.get(q.id)?.used).toBe(0);
    expect((await progressFor(db, wsId, [], NOW, TZ)).size).toBe(0);
  });
});
