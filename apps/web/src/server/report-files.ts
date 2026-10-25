import "server-only";

import {
  addDaysInZone,
  detailedColumns,
  type ExportColumn,
  type ExportFormat,
  flattenGroups,
  localDateKey,
  type ReportKind,
  type ReportQuery,
  resolveReportRange,
  summaryColumns,
  toCsv,
  type ViewerPrefs,
  weeklyColumns,
} from "@timekeep/core";
import type { Database } from "@timekeep/db";
import ExcelJS from "exceljs";

import type { DetailedCursor, DetailedEntryDTO } from "@/lib/report-types";

import type { Viewer } from "./catalog/viewer";
import { detailedReport, summaryReport, weeklyReport } from "./reports";

type Executor = Pick<Database, "query" | "select" | "insert" | "update" | "delete" | "execute">;

export interface ExportFile {
  filename: string;
  contentType: string;
  body: Uint8Array;
  rowCount: number;
}

export interface ExportRequest {
  report: ReportKind;
  query: ReportQuery;
  prefs: ViewerPrefs;
  now?: Date;
}

const CONTENT_TYPES: Record<Exclude<ExportFormat, "pdf">, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** "timekeep-summary-2026-03-09-2026-03-15.csv": the range's first and last local days. */
export function exportFilename(
  report: string,
  range: { from: Date; to: Date },
  tz: string,
  ext: string,
): string {
  const first = localDateKey(range.from, tz);
  const last = localDateKey(addDaysInZone(range.to, -1, tz), tz);
  return `timekeep-${report}-${first}-${last}.${ext}`;
}

const PAGE = 200;

/** Every entry of the Detailed report, newest first, fetched in pages. */
async function allEntries(
  db: Executor,
  viewer: Viewer,
  req: ExportRequest,
  max = Infinity,
): Promise<DetailedEntryDTO[]> {
  const out: DetailedEntryDTO[] = [];
  let cursor: DetailedCursor | undefined;
  do {
    const page = await detailedReport(
      db,
      viewer,
      req.query,
      req.prefs,
      { cursor, sort: "start", dir: "desc", limit: PAGE },
      req.now,
    );
    out.push(...page.entries);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && out.length < max);
  return out;
}

/** How many rows an export of this report would have, without building it. */
export async function countExportRows(
  db: Executor,
  viewer: Viewer,
  req: ExportRequest,
): Promise<number> {
  switch (req.report) {
    case "detailed": {
      const first = await detailedReport(
        db,
        viewer,
        req.query,
        req.prefs,
        { sort: "start", dir: "desc", limit: 1 },
        req.now,
      );
      return first.totals?.entryCount ?? 0;
    }
    case "summary": {
      const report = await summaryReport(db, viewer, req.query, req.prefs, req.now);
      return flattenGroups(report.groups, report.groupBy).length;
    }
    case "weekly": {
      const report = await weeklyReport(db, viewer, req.query, req.prefs, "project", req.now);
      return report.rows.length;
    }
  }
}

/** The rows and columns of an export: one record, every format. */
async function exportTable(
  db: Executor,
  viewer: Viewer,
  req: ExportRequest,
): Promise<{ rows: unknown[]; columns: ExportColumn<unknown>[] }> {
  switch (req.report) {
    case "summary": {
      const report = await summaryReport(db, viewer, req.query, req.prefs, req.now);
      return {
        rows: flattenGroups(report.groups, report.groupBy),
        columns: summaryColumns(report.groupBy, req.prefs) as ExportColumn<unknown>[],
      };
    }
    case "detailed":
      return {
        rows: await allEntries(db, viewer, req),
        columns: detailedColumns(req.prefs) as ExportColumn<unknown>[],
      };
    case "weekly": {
      const report = await weeklyReport(db, viewer, req.query, req.prefs, "project", req.now);
      return {
        rows: report.rows,
        columns: weeklyColumns(report.dayKeys, req.prefs) as ExportColumn<unknown>[],
      };
    }
  }
}

async function toXlsx(rows: unknown[], columns: ExportColumn<unknown>[], title: string) {
  const book = new ExcelJS.Workbook();
  book.creator = "TimeKeep";
  const sheet = book.addWorksheet(title.slice(0, 31));
  sheet.addRow(columns.map((c) => c.header));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(columns.map((c) => c.value(row)));
  columns.forEach((c, i) => {
    sheet.getColumn(i + 1).width = Math.max(10, Math.min(48, c.header.length + 4));
  });
  return new Uint8Array(await book.xlsx.writeBuffer());
}

/** A CSV or Excel file of a report as the viewer sees it (PDF is report-pdf.ts). */
export async function buildExport(
  db: Executor,
  viewer: Viewer,
  req: ExportRequest & { format: Exclude<ExportFormat, "pdf"> },
): Promise<ExportFile> {
  const range = resolveReportRange(req.query, req.prefs, req.now ?? new Date());
  const { rows, columns } = await exportTable(db, viewer, req);
  const body =
    req.format === "csv"
      ? new TextEncoder().encode(toCsv(rows, columns))
      : await toXlsx(rows, columns, `${req.report} report`);
  return {
    filename: exportFilename(req.report, range, req.prefs.timezone, req.format),
    contentType: CONTENT_TYPES[req.format],
    body,
    rowCount: rows.length,
  };
}
