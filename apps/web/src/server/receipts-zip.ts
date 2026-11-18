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
import { Zip, ZipPassThrough } from "fflate";

import type { ExpenseDTO } from "@/lib/expense-types";

import type { Viewer } from "./catalog/viewer";
import { listExpenses, receiptKeysOf } from "./expenses";
import { exportFilename, type StreamedExportFile } from "./report-files";
import { getExport } from "./storage";

/**
 * "Download receipts" (Phase 6c decision 18): every receipt of the expenses
 * the viewer may see for the query, zipped with a manifest, always as an
 * export job. It is never held whole: the receipts are fetched one page of
 * expenses at a time, one file at a time, and the zip leaves in chunks as it
 * is written. Receipts are stored already compressed, so they go in as they
 * are. A receipt whose object is missing is named in the manifest and skipped.
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

/** The expenses of the query the viewer may see, a page at a time, each with its receipt's key. */
async function* expensePages(
  db: Executor,
  viewer: Viewer,
  req: ReceiptsZipRequest,
): AsyncGenerator<{ expenses: ExpenseDTO[]; keys: Map<string, string>; currency: string }> {
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
    const keys = await receiptKeysOf(
      db,
      viewer.workspaceId,
      page.expenses.filter((e) => e.receipt).map((e) => e.id),
    );
    yield { expenses: page.expenses, keys, currency: page.currency };
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
}

/** The limits of a zip without ZIP64, with room for the manifest. */
const MAX_ENTRIES = 65_000;
const MAX_BYTES = 4_000_000_000;

/** S3's "no such object", as the SDK reports it. */
function isMissingObject(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}

/** What the manifest says in place of a file name when the receipt's object is gone. */
export const MISSING_RECEIPT = "(missing)";

export function buildReceiptsZip(
  db: Executor,
  viewer: Viewer,
  req: ReceiptsZipRequest,
  fetch: (key: string) => Promise<Uint8Array> = getExport,
): StreamedExportFile {
  const now = req.now ?? new Date();
  const range = resolveReportRange(req.query, req.prefs, now);
  let count = 0;

  async function* chunks(): AsyncGenerator<Uint8Array> {
    // fflate hands each piece of the archive to this callback as soon as it is
    // written; pass-through entries are written synchronously, so the queue is
    // drained after every file.
    let queue: Uint8Array[] = [];
    let failure: Error | null = null;
    const zip = new Zip((error, chunk) => {
      if (error) failure = error;
      else queue.push(chunk);
    });
    const add = (name: string, data: Uint8Array) => {
      const entry = new ZipPassThrough(name);
      zip.add(entry);
      entry.push(data, true);
    };
    function* drain(): Generator<Uint8Array> {
      if (failure) throw failure;
      const out = queue;
      queue = [];
      yield* out;
    }

    const rows: (ExpenseDTO & { file: string })[] = [];
    let currency = "";
    let bytes = 0;
    for await (const page of expensePages(db, viewer, { ...req, now })) {
      currency = page.currency;
      for (const e of page.expenses) {
        const key = page.keys.get(e.id);
        if (!e.receipt || !key) {
          rows.push({ ...e, file: "" });
          continue;
        }
        let data: Uint8Array;
        try {
          data = await fetch(key);
        } catch (error) {
          // One lost object does not cost the person every other receipt. Anything
          // else (a timeout, throttling, credentials) fails the job: a zip that calls
          // receipts missing when they are only unreachable would read as complete.
          if (!isMissingObject(error)) throw error;
          console.error("[receipts] missing object", key, error);
          rows.push({ ...e, file: MISSING_RECEIPT });
          continue;
        }
        // This writer has no ZIP64: past these the archive would be corrupt, silently.
        bytes += data.byteLength;
        if (count + 1 > MAX_ENTRIES || bytes > MAX_BYTES) {
          throw new Error("Too many receipts for one zip: narrow the date range.");
        }
        const name = receiptFileName(e);
        add(name, data);
        rows.push({ ...e, file: name });
        count++;
        yield* drain();
      }
    }
    add("expenses.csv", new TextEncoder().encode(toCsv(rows, manifestColumns(currency))));
    zip.end();
    yield* drain();
  }

  return {
    filename: exportFilename("receipts", range, req.prefs.timezone, "zip"),
    contentType: "application/zip",
    chunks: chunks(),
    rowCount: () => count,
  };
}
