import "server-only";

import {
  type ExportColumn,
  formatQuantity,
  minorToDecimal,
  receiptExtension,
  type ReportQuery,
  resolveReportRange,
  toCsv,
  type ViewerPrefs,
} from "@timekeep/core";
import type { Database } from "@timekeep/db";
import { zipSync, type Zippable } from "fflate";

import type { ExpenseDTO } from "@/lib/expense-types";

import type { Viewer } from "./catalog/viewer";
import { receiptKeys } from "./expense-receipts";
import { listExpenses } from "./expenses";
import { type ExportFile, exportFilename } from "./report-files";
import { getExport } from "./storage";

/**
 * "Download receipts" (Phase 6c decision 18): every receipt of the expenses
 * the viewer may see for the query, zipped with a manifest, always as an
 * export job (the files are fetched one by one from the private bucket).
 * Receipts are stored already compressed, so they go in uncompressed.
 */

type Executor = Pick<Database, "query" | "select" | "insert" | "update" | "delete" | "execute">;

export interface ReceiptsZipRequest {
  query: ReportQuery;
  prefs: ViewerPrefs;
  now?: Date;
}

const PAGE = 200;

/** A file-name piece: runs of anything but word characters, dots and dashes become one underscore. */
function safeName(text: string): string {
  return text.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
}

function receiptFileName(e: ExpenseDTO): string {
  const ext = receiptExtension(e.receipt!.mime);
  return `${e.date}-${safeName(e.userName)}-${safeName(e.categoryName)}-${e.id.slice(0, 8)}.${ext}`;
}

/** The manifest's columns: the Detailed report's shape, plus the receipt's file name. */
function manifestColumns(currency: string): ExportColumn<ExpenseDTO & { file: string }>[] {
  return [
    { key: "date", header: "Date", value: (e) => e.date },
    { key: "person", header: "Person", value: (e) => e.userName },
    { key: "project", header: "Project", value: (e) => e.projectName },
    { key: "client", header: "Client", value: (e) => e.clientName },
    { key: "category", header: "Category", value: (e) => e.categoryName },
    {
      key: "quantity",
      header: "Quantity",
      value: (e) =>
        e.quantityCenti === null
          ? null
          : `${formatQuantity(e.quantityCenti)}${e.unitName ? ` ${e.unitName}` : ""}`,
    },
    { key: "amount", header: "Amount", value: (e) => minorToDecimal(e.amountMinor, currency) },
    { key: "currency", header: "Currency", value: () => currency },
    { key: "billable", header: "Billable", value: (e) => (e.billable ? "Yes" : "No") },
    { key: "description", header: "Description", value: (e) => e.description },
    { key: "file", header: "Receipt file", value: (e) => e.file },
  ];
}

/** Every expense of the query the viewer may see, over every page. */
async function allExpenses(
  db: Executor,
  viewer: Viewer,
  req: ReceiptsZipRequest,
): Promise<{ expenses: ExpenseDTO[]; currency: string }> {
  const out: ExpenseDTO[] = [];
  let currency = "";
  let cursor: string | undefined;
  do {
    const page = await listExpenses(
      db,
      viewer,
      req.query,
      req.prefs,
      { cursor, limit: PAGE },
      req.now,
    );
    out.push(...page.expenses);
    currency = page.currency;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return { expenses: out, currency };
}

export async function buildReceiptsZip(
  db: Executor,
  viewer: Viewer,
  req: ReceiptsZipRequest,
  fetch: (key: string) => Promise<Uint8Array> = getExport,
): Promise<ExportFile> {
  const now = req.now ?? new Date();
  const range = resolveReportRange(req.query, req.prefs, now);
  const { expenses, currency } = await allExpenses(db, viewer, { ...req, now });
  const files: Zippable = {};
  const rows: (ExpenseDTO & { file: string })[] = [];
  let count = 0;
  for (const e of expenses) {
    if (!e.receipt) {
      rows.push({ ...e, file: "" });
      continue;
    }
    const name = receiptFileName(e);
    files[name] = [await fetch(receiptKeys(viewer.workspaceId, e.id).file), { level: 0 }];
    rows.push({ ...e, file: name });
    count++;
  }
  files["expenses.csv"] = new TextEncoder().encode(toCsv(rows, manifestColumns(currency)));
  return {
    filename: exportFilename("receipts", range, req.prefs.timezone, "zip"),
    contentType: "application/zip",
    body: zipSync(files),
    rowCount: count,
  };
}
