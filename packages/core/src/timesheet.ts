import { addDaysInZone, localDateKey, zonedDateTimeToInstant } from "./time";

/**
 * The weekly timesheet grid: rows are (project, task, description), columns
 * are the seven days of the week in the viewer's timezone, cells sum the
 * entries that start on that day. Pure: the UI supplies entries and executes
 * the plans this module returns.
 */

export interface TimesheetRowKey {
  projectId: string | null;
  taskId: string | null;
  description: string;
}

export function rowKeyString(k: TimesheetRowKey): string {
  return `${k.projectId ?? ""}|${k.taskId ?? ""}|${k.description}`;
}

export interface TimesheetEntry extends TimesheetRowKey {
  id: string;
  /** ISO instants */
  start: string;
  end: string;
  durationSeconds: number;
}

export interface TimesheetCell {
  seconds: number;
  entryIds: string[];
}

export interface TimesheetRow extends TimesheetRowKey {
  key: string;
  /** Keyed by day (YYYY-MM-DD); every day of the week is present. */
  cells: Record<string, TimesheetCell>;
  totalSeconds: number;
}

export interface Timesheet {
  days: string[];
  rows: TimesheetRow[];
  dayTotals: Record<string, number>;
  totalSeconds: number;
}

function byStart(a: { start: string; id?: string }, b: { start: string; id?: string }): number {
  return a.start.localeCompare(b.start) || (a.id ?? "").localeCompare(b.id ?? "");
}

/**
 * Rows appear in first-seen order of their entries, then `extraRows` the user
 * added (skipped when already present). An entry counts under the day it
 * starts, in `tz`; entries outside the week are ignored.
 */
export function buildTimesheet(args: {
  entries: TimesheetEntry[];
  weekStart: Date;
  tz: string;
  extraRows?: TimesheetRowKey[];
}): Timesheet {
  const days = Array.from({ length: 7 }, (_, i) =>
    localDateKey(addDaysInZone(args.weekStart, i, args.tz), args.tz),
  );
  const daySet = new Set(days);
  const rows = new Map<string, TimesheetRow>();
  const emptyCells = () =>
    Object.fromEntries(days.map((d) => [d, { seconds: 0, entryIds: [] }])) as Record<
      string,
      TimesheetCell
    >;
  const rowFor = (k: TimesheetRowKey): TimesheetRow => {
    const key = rowKeyString(k);
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        projectId: k.projectId,
        taskId: k.taskId,
        description: k.description,
        cells: emptyCells(),
        totalSeconds: 0,
      };
      rows.set(key, row);
    }
    return row;
  };

  for (const e of [...args.entries].sort(byStart)) {
    const day = localDateKey(new Date(e.start), args.tz);
    if (!daySet.has(day)) continue;
    const row = rowFor(e);
    const cell = row.cells[day]!;
    cell.seconds += e.durationSeconds;
    cell.entryIds.push(e.id);
    row.totalSeconds += e.durationSeconds;
  }
  for (const k of args.extraRows ?? []) rowFor(k);

  const dayTotals = Object.fromEntries(days.map((d) => [d, 0])) as Record<string, number>;
  let totalSeconds = 0;
  for (const row of rows.values()) {
    for (const d of days) {
      dayTotals[d] = (dayTotals[d] ?? 0) + row.cells[d]!.seconds;
    }
    totalSeconds += row.totalSeconds;
  }
  return { days, rows: [...rows.values()], dayTotals, totalSeconds };
}

export const TIMESHEET_DEFAULT_START = { hours: 9, minutes: 0 } as const;
/** A cell is one day; more than this is a typo (80 for 8.0), not a day's work. */
export const MAX_TIMESHEET_CELL_SECONDS = 24 * 3600;

export type CellPlan =
  | { kind: "noop" }
  | { kind: "create"; start: Date; end: Date }
  | { kind: "update"; entryId: string; end: Date }
  | { kind: "delete"; entryIds: string[] }
  | { kind: "choose"; entries: TimesheetEntry[] }
  | { kind: "reject"; message: string };

/**
 * What typing a new total into a cell means:
 * - a total over 24 hours is rejected (a day cell cannot hold more);
 * - an empty cell creates one entry at 09:00 local, or after the day's last
 *   entry when that still ends on the day;
 * - zero deletes the cell's entries;
 * - one entry gets its end moved;
 * - several: the last one (latest start) grows or shrinks, is deleted when it
 *   shrinks to nothing, and when the new total is below what the others add
 *   up to the caller must ask which entry to change.
 */
export function planCellChange(args: {
  cellEntries: TimesheetEntry[];
  /** Every entry of the user that day (any row), for "after the last entry". */
  dayEntries: { start: string; end: string }[];
  newSeconds: number;
  dayKey: string;
  tz: string;
}): CellPlan {
  const entries = [...args.cellEntries].sort(byStart);
  const sum = entries.reduce((n, e) => n + e.durationSeconds, 0);
  const target = Math.max(0, Math.floor(args.newSeconds));
  if (target === sum) return { kind: "noop" };
  if (target > MAX_TIMESHEET_CELL_SECONDS) {
    return { kind: "reject", message: "A day holds at most 24 hours." };
  }

  if (entries.length === 0) {
    const onDay = args.dayEntries.filter(
      (e) => localDateKey(new Date(e.start), args.tz) === args.dayKey,
    );
    const latestEnd = onDay.reduce<Date | null>((latest, e) => {
      const end = new Date(e.end);
      return !latest || end > latest ? end : latest;
    }, null);
    // After the day's last entry, unless that already ends on the next day.
    const start =
      latestEnd && localDateKey(latestEnd, args.tz) === args.dayKey
        ? latestEnd
        : zonedDateTimeToInstant({ date: args.dayKey, ...TIMESHEET_DEFAULT_START }, args.tz);
    return { kind: "create", start, end: new Date(start.getTime() + target * 1000) };
  }

  if (target === 0) return { kind: "delete", entryIds: entries.map((e) => e.id) };

  const last = entries[entries.length - 1]!;
  if (entries.length === 1) {
    return {
      kind: "update",
      entryId: last.id,
      end: new Date(new Date(last.start).getTime() + target * 1000),
    };
  }

  const diff = target - sum;
  if (diff > 0 || -diff < last.durationSeconds) {
    return {
      kind: "update",
      entryId: last.id,
      end: new Date(new Date(last.end).getTime() + diff * 1000),
    };
  }
  if (-diff === last.durationSeconds) return { kind: "delete", entryIds: [last.id] };
  return { kind: "choose", entries };
}

/** Moves entries by whole days keeping wall-clock start and duration (DST-safe). */
export function shiftEntriesByDays<T extends { start: string; end: string }>(
  entries: T[],
  days: number,
  tz: string,
): T[] {
  return entries.map((e) => {
    const start = new Date(e.start);
    const duration = new Date(e.end).getTime() - start.getTime();
    const shifted = addDaysInZone(start, days, tz);
    return {
      ...e,
      start: shifted.toISOString(),
      end: new Date(shifted.getTime() + duration).toISOString(),
    };
  });
}
