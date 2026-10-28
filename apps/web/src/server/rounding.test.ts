import { randomUUID } from "node:crypto";

import {
  amountFor,
  DEFAULT_REPORT_QUERY,
  type ReportQuery,
  roundDuration,
  ROUNDING_MODES,
  ROUNDING_STEPS,
  type RoundingRule,
  type ViewerPrefs,
} from "@timekeep/core";
import {
  eq,
  rate,
  roundedAmountSql,
  roundedSecondsSql,
  sql,
  timeEntry,
  workspaceSettings,
} from "@timekeep/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectTestDb, createTestUser, createTestWorkspace, truncateAll } from "../../test/db";
import { loadViewer } from "./authz";
import { buildExport } from "./report-files";
import { detailedReport, summaryReport } from "./reports";
import { createManualEntry } from "./time-entries";

const handle = connectTestDb();
const db = handle.db;

afterAll(async () => handle.close());

const RATE = 12345;
const DURATIONS = [0, 1, 59, 60, 449, 450, 451, 899, 900, 901, 1799, 1800, 3599, 3600, 35999];

/** The SQL rounding agrees with core over every mode, step and edge (ties, exact steps). */
describe("rounding SQL", () => {
  let wsId: string;

  beforeAll(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    wsId = ws.id;
    const start = new Date("2026-03-10T01:00:00.000Z");
    await db.insert(timeEntry).values(
      DURATIONS.map((seconds) => ({
        id: randomUUID(),
        workspaceId: wsId,
        userId: olga.id,
        description: String(seconds),
        billable: true,
        start,
        end: new Date(start.getTime() + seconds * 1000),
        durationSeconds: seconds,
        billableRateMinor: RATE,
        rateCurrency: "USD",
        amountMinor: amountFor(RATE, seconds),
      })),
    );
  });
  const rules: RoundingRule[] = ROUNDING_MODES.flatMap((mode) =>
    ROUNDING_STEPS.map((minutes) => ({ mode, minutes })),
  );

  it.each(rules)("%o agrees with core on durations and half-up amounts", async (rule) => {
    const rows = await db
      .select({
        seconds: timeEntry.durationSeconds,
        rounded: sql`${roundedSecondsSql(rule)}`.mapWith(Number),
        amount: sql`${roundedAmountSql(rule)}`.mapWith(Number),
      })
      .from(timeEntry)
      .where(eq(timeEntry.workspaceId, wsId));
    expect(rows).toHaveLength(DURATIONS.length);
    for (const row of rows) {
      const expected = roundDuration(row.seconds!, rule);
      expect(row.rounded, `${row.seconds}s`).toBe(expected);
      expect(row.amount, `${row.seconds}s amount`).toBe(amountFor(RATE, expected));
    }
  });
});

const PREFS: ViewerPrefs = {
  timezone: "Asia/Manila",
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
const NOW = new Date("2026-03-11T04:00:00.000Z");
const q = (over: Partial<ReportQuery> = {}): ReportQuery => ({
  ...DEFAULT_REPORT_QUERY,
  preset: "custom",
  from: "2026-03-08T16:00:00.000Z",
  to: "2026-03-15T16:00:00.000Z",
  ...over,
});

/** Rounding is a report rule: views, exports and share links follow the URL's choice. */
describe("rounding in reports", () => {
  const START = new Date("2026-03-10T01:00:00.000Z");
  const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

  beforeAll(async () => {
    await truncateAll(db);
    const olga = await createTestUser(db, "Olga Owner");
    const ws = await createTestWorkspace(db, "Workspace", olga.id);
    const me = await loadViewer(db, ws.id, olga.id);
    await db.insert(rate).values({
      id: randomUUID(),
      workspaceId: ws.id,
      level: "workspace",
      amountMinor: 5000,
      currency: "USD",
      effectiveFrom: new Date(0),
    });
    await db
      .update(workspaceSettings)
      .set({ roundingMode: "nearest", roundingMinutes: 15 })
      .where(eq(workspaceSettings.workspaceId, ws.id));
    const bare = { taskId: null, tagIds: [], billable: true, projectId: null };
    await createManualEntry(db, me, { ...bare, description: "Seven", start: START, end: at(7) });
    await createManualEntry(db, me, { ...bare, description: "Nine", start: at(10), end: at(19) });
    rounded = { me };
  });

  let rounded: { me: Awaited<ReturnType<typeof loadViewer>> };

  it("rounds each entry's duration and amount in the Summary unless the URL asks for raw", async () => {
    const on = await summaryReport(db, rounded.me, q(), PREFS, NOW);
    expect(on.totals.durationSeconds).toBe(900);
    expect(on.totals.amountMinor).toBe(amountFor(5000, 900));
    const off = await summaryReport(db, rounded.me, q({ rounding: "off" }), PREFS, NOW);
    expect(off.totals.durationSeconds).toBe(960);
    expect(off.totals.amountMinor).toBe(amountFor(5000, 420) + amountFor(5000, 540));
  });

  it("shows rounded rows in the Detailed report", async () => {
    const page = await detailedReport(db, rounded.me, q(), PREFS, { sort: "start", dir: "asc" }, NOW);
    expect(page.entries.map((e) => e.durationSeconds)).toEqual([0, 900]);
    expect(page.entries.map((e) => e.amountMinor)).toEqual([0, amountFor(5000, 900)]);
  });

  it("pages by the raw duration under rounding, so Load more never repeats a row", async () => {
    const page = (cursor?: { value: string; id: string }) =>
      detailedReport(
        db,
        rounded.me,
        q(),
        PREFS,
        { cursor, sort: "duration", dir: "desc", limit: 1 },
        NOW,
      );
    const p1 = await page();
    expect(p1.entries.map((e) => e.description)).toEqual(["Nine"]);
    const p2 = await page(p1.nextCursor!);
    expect(p2.entries.map((e) => e.description)).toEqual(["Seven"]);
    expect(p2.nextCursor).toBeNull();
  });

  it("exports follow the URL's choice", async () => {
    const csv = async (rounding: ReportQuery["rounding"]) =>
      new TextDecoder().decode(
        (
          await buildExport(db, rounded.me, {
            report: "detailed",
            query: q({ rounding }),
            prefs: PREFS,
            format: "csv",
            now: NOW,
          })
        ).body,
      );
    const raw = await csv("off");
    expect(raw).toContain("0:07:00");
    expect(raw).toContain("0:09:00");
    const on = await csv("on");
    expect(on).toContain("0:00:00");
    expect(on).toContain("0:15:00");
    expect(on).not.toContain("0:07:00");
  });
});
