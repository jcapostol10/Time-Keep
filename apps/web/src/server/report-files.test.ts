import { DEFAULT_REPORT_QUERY, type ReportQuery, type ViewerPrefs } from "@timekeep/core";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  connectTestDb,
  createTestUser,
  createTestWorkspace,
  truncateAll,
  asViewer,
} from "../../test/db";
import { createProject } from "./catalog/projects";
import type { Viewer } from "./catalog/viewer";
import { buildExport, countExportRows } from "./report-files";
import { createManualEntry } from "./time-entries";

const handle = connectTestDb();
const db = handle.db;

const PREFS: ViewerPrefs = {
  timezone: "Asia/Manila",
  timeFormat: "24h",
  dateFormat: "yyyy-MM-dd",
  weekStart: 1,
  durationFormat: "hh:mm:ss",
};
/** Mar 9 – Mar 16 2026, Manila. */
const QUERY: ReportQuery = {
  ...DEFAULT_REPORT_QUERY,
  preset: "custom",
  from: "2026-03-08T16:00:00.000Z",
  to: "2026-03-15T16:00:00.000Z",
};
const NOW = new Date("2026-03-11T04:00:00.000Z");

let viewer: Viewer;

describe("report files", () => {
  beforeAll(async () => truncateAll(db));
  afterAll(async () => handle.close());

  beforeEach(async () => {
    await truncateAll(db);
    const alice = await createTestUser(db, "Alice A");
    const ws = await createTestWorkspace(db, "Workspace A", alice.id);
    viewer = asViewer({ workspaceId: ws.id, userId: alice.id, role: "owner" });
    const web = await createProject(db, viewer, { name: "Web" });
    const base = { taskId: null, tagIds: [], billable: false };
    await createManualEntry(db, viewer, {
      ...base,
      description: 'Site "work", phase 1',
      projectId: web.id,
      start: new Date("2026-03-09T01:00:00.000Z"),
      end: new Date("2026-03-09T02:30:00.000Z"),
    });
    await createManualEntry(db, viewer, {
      ...base,
      description: "Email",
      projectId: null,
      start: new Date("2026-03-10T01:00:00.000Z"),
      end: new Date("2026-03-10T01:30:00.000Z"),
    });
  });

  it("builds the summary CSV from the grouped rows", async () => {
    const file = await buildExport(db, viewer, {
      report: "summary",
      format: "csv",
      query: QUERY,
      prefs: PREFS,
      now: NOW,
    });
    expect(file.contentType).toBe("text/csv; charset=utf-8");
    expect(file.filename).toBe("timekeep-summary-2026-03-09-2026-03-15.csv");
    expect(file.rowCount).toBe(2);
    const text = new TextDecoder().decode(file.body);
    expect(text).toContain("Project,Duration,Billable,Entries,Amount (USD)\r\n");
    expect(text).toContain("Web,1:30:00,0:00:00,1,0.00\r\n");
    expect(text).toContain("No project,0:30:00,0:00:00,1,0.00\r\n");
  });

  it("builds the detailed CSV with every entry, quoting where needed", async () => {
    const file = await buildExport(db, viewer, {
      report: "detailed",
      format: "csv",
      query: QUERY,
      prefs: PREFS,
      now: NOW,
    });
    const text = new TextDecoder().decode(file.body);
    expect(file.rowCount).toBe(2);
    expect(text).toContain(
      '"Site ""work"", phase 1",Work,Web,,,Alice A,,No,2026-03-09,09:00,10:30,1:30:00',
    );
  });

  it("builds an Excel workbook with the same columns", async () => {
    const file = await buildExport(db, viewer, {
      report: "summary",
      format: "xlsx",
      query: QUERY,
      prefs: PREFS,
      now: NOW,
    });
    expect(file.filename.endsWith(".xlsx")).toBe(true);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(file.body) as unknown as ArrayBuffer);
    const sheet = book.worksheets[0]!;
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      "Project",
      "Duration",
      "Billable",
      "Entries",
      "Amount (USD)",
    ]);
    expect(sheet.getRow(2).getCell(1).value).toBe("Web");
    expect(sheet.getRow(2).getCell(4).value).toBe(1);
  });

  it("exports the weekly grid by people when the query lists people", async () => {
    const byPeople = { ...QUERY, weeklyBy: "user" as const };
    const file = await buildExport(db, viewer, {
      report: "weekly",
      format: "csv",
      query: byPeople,
      prefs: PREFS,
      now: NOW,
    });
    const text = new TextDecoder().decode(file.body);
    expect(text).toContain("Alice A,");
    expect(text).not.toContain("Web,");
    expect(
      await countExportRows(db, viewer, {
        report: "weekly",
        query: byPeople,
        prefs: PREFS,
        now: NOW,
      }),
    ).toBe(1);
  });

  it("counts the rows an export would have before building it", async () => {
    expect(
      await countExportRows(db, viewer, {
        report: "detailed",
        query: QUERY,
        prefs: PREFS,
        now: NOW,
      }),
    ).toBe(2);
    expect(
      await countExportRows(db, viewer, {
        report: "summary",
        query: QUERY,
        prefs: PREFS,
        now: NOW,
      }),
    ).toBe(2);
    expect(
      await countExportRows(db, viewer, { report: "weekly", query: QUERY, prefs: PREFS, now: NOW }),
    ).toBe(2);
  });
});
