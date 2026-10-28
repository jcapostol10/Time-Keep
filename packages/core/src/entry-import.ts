import { parseDuration } from "./duration";
import type { DateFormat } from "./schemas";
import { addDaysInZone, parseTimeOfDay, zonedDateTimeToInstant } from "./time";

/**
 * Importing time entries from a CSV (Phase 4b): the column mapping (matched
 * by header name) and the per-row parsing into instants, in the importer's
 * chosen timezone and date format. Pure: the server resolves names and
 * permissions.
 */

export const IMPORT_COLUMNS = [
  "date",
  "start",
  "end",
  "duration",
  "description",
  "project",
  "client",
  "task",
  "tags",
  "billable",
  "email",
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const MAX_IMPORT_ROWS = 10_000;
/** The request body limit: a bigger file never reaches the parser. */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/** Column index per field; a field left out of the mapping is not imported. */
export type ColumnMapping = Partial<Record<ImportColumn, number>>;

const ALIASES: Record<ImportColumn, string[]> = {
  date: ["date", "day"],
  start: ["start", "start time", "from", "started"],
  end: ["end", "end time", "to", "ended"],
  duration: ["duration", "hours", "time", "length"],
  description: ["description", "note", "notes", "what", "activity"],
  project: ["project", "project name"],
  client: ["client", "client name", "customer"],
  task: ["task", "task name"],
  tags: ["tags", "tag", "labels"],
  billable: ["billable", "billable?", "is billable"],
  email: ["email", "user email", "user", "person", "member"],
};

function normalise(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Maps each field to the first header matching one of its names; a header serves one field. */
export function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  const names = headers.map(normalise);
  for (const column of IMPORT_COLUMNS) {
    const index = names.findIndex((h, i) => !used.has(i) && ALIASES[column].includes(h));
    if (index >= 0) {
      mapping[column] = index;
      used.add(index);
    }
  }
  return mapping;
}

export interface ParsedImportRow {
  /** 1-based line in the file (the header is line 1). */
  line: number;
  start: Date | null;
  end: Date | null;
  description: string;
  project: string | null;
  client: string | null;
  task: string | null;
  tags: string[];
  billable: boolean;
  email: string | null;
  /** "Line 4: invalid date", or null when the row parsed. */
  error: string | null;
}

const DATE_PATTERNS: Record<DateFormat, { re: RegExp; order: ("y" | "m" | "d")[] }> = {
  "yyyy-MM-dd": { re: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, order: ["y", "m", "d"] },
  "MM/dd/yyyy": { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ["m", "d", "y"] },
  "dd/MM/yyyy": { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ["d", "m", "y"] },
  "dd.MM.yyyy": { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: ["d", "m", "y"] },
};

/** A calendar date as "YYYY-MM-DD": ISO always, or the chosen format. */
export function parseImportDate(text: string, dateFormat: DateFormat): string | null {
  const value = text.trim();
  for (const format of [...new Set<DateFormat>(["yyyy-MM-dd", dateFormat])]) {
    const { re, order } = DATE_PATTERNS[format];
    const m = re.exec(value);
    if (!m) continue;
    const parts = { y: 0, m: 0, d: 0 };
    order.forEach((key, i) => {
      parts[key] = Number(m[i + 1]);
    });
    const probe = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
    if (
      probe.getUTCFullYear() !== parts.y ||
      probe.getUTCMonth() !== parts.m - 1 ||
      probe.getUTCDate() !== parts.d
    ) {
      return null;
    }
    return `${String(parts.y).padStart(4, "0")}-${String(parts.m).padStart(2, "0")}-${String(parts.d).padStart(2, "0")}`;
  }
  return null;
}

const YES = /^(yes|y|true|1|x)$/i;

function cell(row: string[], mapping: ColumnMapping, column: ImportColumn): string {
  const index = mapping[column];
  return index === undefined ? "" : (row[index] ?? "").trim();
}

/**
 * Parses the data rows (the header excluded) into instants. The end is the
 * end-time column when given (an end before the start is the next day), else
 * the start plus the duration; an error names the line and the field.
 */
export function parseImportRows(
  rows: string[][],
  mapping: ColumnMapping,
  options: { timezone: string; dateFormat: DateFormat },
): ParsedImportRow[] {
  return rows.map((row, i) => {
    const line = i + 2;
    const out: ParsedImportRow = {
      line,
      start: null,
      end: null,
      description: cell(row, mapping, "description"),
      project: cell(row, mapping, "project") || null,
      client: cell(row, mapping, "client") || null,
      task: cell(row, mapping, "task") || null,
      tags: [
        ...new Set(
          cell(row, mapping, "tags")
            .split(/[;,]/)
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      ],
      billable: YES.test(cell(row, mapping, "billable")),
      email: cell(row, mapping, "email").toLowerCase() || null,
      error: null,
    };
    const fail = (message: string) => {
      out.error = `Line ${line}: ${message}`;
      return out;
    };
    const date = parseImportDate(cell(row, mapping, "date"), options.dateFormat);
    if (!date) return fail(cell(row, mapping, "date") ? "invalid date" : "missing date");
    const startText = cell(row, mapping, "start");
    const startTime = parseTimeOfDay(startText);
    if (!startTime) return fail(startText ? "invalid start time" : "missing start time");
    const start = zonedDateTimeToInstant({ date, ...startTime }, options.timezone);
    const endText = cell(row, mapping, "end");
    const durationText = cell(row, mapping, "duration");
    let end: Date;
    if (endText) {
      const endTime = parseTimeOfDay(endText);
      if (!endTime) return fail("invalid end time");
      end = zonedDateTimeToInstant({ date, ...endTime }, options.timezone);
      if (end.getTime() <= start.getTime()) end = addDaysInZone(end, 1, options.timezone);
    } else if (durationText) {
      const seconds = parseDuration(durationText);
      if (!seconds || seconds <= 0) return fail("invalid duration");
      end = new Date(start.getTime() + seconds * 1000);
    } else {
      return fail("missing end time or duration");
    }
    out.start = start;
    out.end = end;
    return out;
  });
}
