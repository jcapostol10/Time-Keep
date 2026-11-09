import type { AttendanceDay, AttendanceWeek } from "./attendance";
import type { EntryType } from "./schemas";
import { formatDuration } from "./duration";
import type { ExpenseGroupKey, ExpenseTotals } from "./expenses";
import { minorToDecimal } from "./money";
import type { ViewerPrefs } from "./prefs";
import {
  type GroupKey,
  marginPercent,
  type MoneyAmount,
  type ReportGroup,
  type ReportTotals,
  type WeeklyRow,
} from "./reports";
import { formatDateInZone, formatTimeOfDay, zonedDateTimeToInstant } from "./time";

/**
 * Exports read one column record per report. CSV and Excel both come from
 * these definitions. With `money` (the viewer may see amounts), amount
 * columns follow the totals as plain decimals: one column per currency, the
 * workspace's first, since two currencies are never added (Phase 6a). Cost
 * and profit, in the workspace currency, follow for viewers who see them.
 */

/** What money an export shows; absent when the viewer may not see amounts. */
export interface ExportMoney {
  /** The workspace currency. */
  currency: string;
  /** The other currencies the rows hold (see `otherCurrencies`): a column each. */
  others?: readonly string[];
  /** The viewer may see cost and profit. */
  costs?: boolean;
}

/** The currencies, besides the workspace's, that a set of totals holds, sorted. */
export function otherCurrencies(
  totals: readonly { otherAmounts: readonly MoneyAmount[] }[],
): string[] {
  const codes = new Set<string>();
  for (const t of totals) for (const a of t.otherAmounts) codes.add(a.currency);
  return [...codes].sort();
}

const amountIn = (amounts: readonly MoneyAmount[], currency: string): number =>
  amounts.find((a) => a.currency === currency)?.amountMinor ?? 0;

/** The amount columns of a row of totals: the workspace currency, then each other one. */
function amountColumns<T>(
  money: ExportMoney,
  of: (row: T) => { amountMinor: number; otherAmounts: readonly MoneyAmount[] },
): ExportColumn<T>[] {
  return [
    {
      key: "amount",
      header: `Amount (${money.currency})`,
      value: (r) => minorToDecimal(of(r).amountMinor, money.currency),
    },
    ...(money.others ?? []).map<ExportColumn<T>>((currency) => ({
      key: `amount-${currency}`,
      header: `Amount (${currency})`,
      value: (r) => minorToDecimal(amountIn(of(r).otherAmounts, currency), currency),
    })),
  ];
}

/**
 * Cost and profit of a row of totals. Profit covers the workspace currency
 * only, so a row billed entirely in another currency has none to show.
 */
function costColumns<T extends { totals: ReportTotals }>(money: ExportMoney): ExportColumn<T>[] {
  if (!money.costs) return [];
  return [
    {
      key: "cost",
      header: `Cost (${money.currency})`,
      value: (r) => minorToDecimal(r.totals.costMinor, money.currency),
    },
    {
      key: "profit",
      header: `Profit (${money.currency})`,
      value: (r) =>
        hasProfit(r.totals) ? minorToDecimal(r.totals.profitMinor, money.currency) : null,
    },
  ];
}

/** False when every entry of the totals is billed in another currency: no profit to state. */
export function hasProfit(t: Pick<ReportTotals, "entryCount" | "profitExcludedCount">): boolean {
  return t.profitExcludedCount === 0 || t.profitExcludedCount < t.entryCount;
}
export interface ExportColumn<T> {
  key: string;
  header: string;
  value: (row: T) => string | number | null;
}

/** An entry as the Detailed report lists it; the server fills it, the exports read it. */
export interface DetailedEntry {
  id: string;
  description: string;
  projectName: string | null;
  clientName: string | null;
  taskName: string | null;
  userName: string;
  tags: string[];
  billable: boolean;
  /** work or break */
  type: EntryType;
  start: string;
  end: string;
  durationSeconds: number;
  /** The rate the entry was saved with (minor units per hour); null without one or hidden. */
  rateMinor: number | null;
  /** Its amount when billable and rated; null otherwise. */
  amountMinor: number | null;
  /** The currency the entry is billed in (its project's client's, else the workspace's); null when amounts are hidden. */
  currency: string | null;
  /** What the entry cost, in the workspace currency; null without a cost rate or hidden. */
  costMinor: number | null;
  /** Amount less cost; null for an entry billed in another currency, or hidden. */
  profitMinor: number | null;
}

const GROUP_HEADERS: Record<GroupKey, string> = {
  project: "Project",
  client: "Client",
  user: "Person",
  task: "Task",
  tag: "Tag",
  date: "Date",
  week: "Week",
  month: "Month",
  description: "Description",
};

export interface FlatSummaryRow {
  /** One label per grouping level, outermost first. */
  labels: string[];
  totals: ReportTotals;
}

/** One row per leaf group, carrying every level's label, in the tree's order. */
export function flattenGroups(groups: ReportGroup[], keys: GroupKey[]): FlatSummaryRow[] {
  const rows: FlatSummaryRow[] = [];
  const walk = (level: ReportGroup[], labels: string[]) => {
    for (const g of level) {
      const next = [...labels, g.label];
      if (g.children.length === 0 || next.length === keys.length) {
        rows.push({ labels: next, totals: g.totals });
      } else {
        walk(g.children, next);
      }
    }
  };
  walk(groups, []);
  return rows;
}

function totalsColumns<T extends { totals: ReportTotals }>(
  prefs: Pick<ViewerPrefs, "durationFormat">,
): ExportColumn<T>[] {
  return [
    {
      key: "duration",
      header: "Duration",
      value: (r) => formatDuration(r.totals.durationSeconds, prefs.durationFormat),
    },
    {
      key: "billable",
      header: "Billable",
      value: (r) => formatDuration(r.totals.billableSeconds, prefs.durationFormat),
    },
    { key: "entries", header: "Entries", value: (r) => r.totals.entryCount },
  ];
}

export function summaryColumns(
  groupBy: GroupKey[],
  prefs: Pick<ViewerPrefs, "durationFormat">,
  money?: ExportMoney,
): ExportColumn<FlatSummaryRow>[] {
  const labels = groupBy.map<ExportColumn<FlatSummaryRow>>((key, i) => ({
    key,
    header: GROUP_HEADERS[key],
    value: (r) => r.labels[i] ?? "",
  }));
  const amount: ExportColumn<FlatSummaryRow>[] = money
    ? [...amountColumns<FlatSummaryRow>(money, (r) => r.totals), ...costColumns(money)]
    : [];
  return [...labels, ...totalsColumns<FlatSummaryRow>(prefs), ...amount];
}

/**
 * The Profit report: the Summary's columns for one grouping key, the group's expenses
 * (Phase 6c: all of them a cost, the billable ones revenue), and the margin.
 */
export function profitColumns(
  groupBy: GroupKey,
  prefs: Pick<ViewerPrefs, "durationFormat">,
  money: ExportMoney,
): ExportColumn<FlatSummaryRow>[] {
  return [
    ...summaryColumns([groupBy], prefs, { ...money, costs: true }),
    {
      key: "expenses",
      header: `Expenses (${money.currency})`,
      value: (r) => minorToDecimal(r.totals.expenseMinor, money.currency),
    },
    {
      key: "billableExpenses",
      header: `Billable expenses (${money.currency})`,
      value: (r) => minorToDecimal(r.totals.billableExpenseMinor, money.currency),
    },
    {
      key: "margin",
      header: "Margin %",
      value: (r) => (hasProfit(r.totals) ? marginPercent(r.totals) : null),
    },
  ];
}

/** One row of the Expenses report (Phase 6c): a category, project or person and its totals. */
export interface FlatExpenseRow {
  label: string;
  totals: ExpenseTotals;
}

const EXPENSE_GROUP_HEADERS: Record<ExpenseGroupKey, string> = {
  category: "Category",
  project: "Project",
  user: "Person",
};

/** The Expenses report's columns; every amount is in the workspace currency. */
export function expenseColumns(
  groupBy: ExpenseGroupKey,
  currency: string,
): ExportColumn<FlatExpenseRow>[] {
  return [
    { key: groupBy, header: EXPENSE_GROUP_HEADERS[groupBy], value: (r) => r.label },
    { key: "count", header: "Expenses", value: (r) => r.totals.count },
    {
      key: "amount",
      header: `Amount (${currency})`,
      value: (r) => minorToDecimal(r.totals.amountMinor, currency),
    },
    {
      key: "billable",
      header: `Billable (${currency})`,
      value: (r) => minorToDecimal(r.totals.billableMinor, currency),
    },
  ];
}

export function detailedColumns(
  prefs: ViewerPrefs,
  money?: ExportMoney,
): ExportColumn<DetailedEntry>[] {
  const tz = prefs.timezone;
  // An entry's rate and amount are in its own currency, named in the column beside them.
  const decimal = (minor: number | null, currency: string) =>
    minor === null ? null : minorToDecimal(minor, currency);
  const amounts: ExportColumn<DetailedEntry>[] = money
    ? [
        {
          key: "rate",
          header: "Rate",
          value: (e) => decimal(e.rateMinor, e.currency ?? money.currency),
        },
        {
          key: "amount",
          header: "Amount",
          value: (e) => decimal(e.amountMinor, e.currency ?? money.currency),
        },
        { key: "currency", header: "Currency", value: (e) => e.currency ?? money.currency },
        ...(money.costs
          ? [
              {
                key: "cost",
                header: `Cost (${money.currency})`,
                value: (e: DetailedEntry) => decimal(e.costMinor, money.currency),
              },
              {
                key: "profit",
                header: `Profit (${money.currency})`,
                value: (e: DetailedEntry) => decimal(e.profitMinor, money.currency),
              },
            ]
          : []),
      ]
    : [];
  return [
    { key: "description", header: "Description", value: (e) => e.description },
    { key: "type", header: "Type", value: (e) => (e.type === "break" ? "Break" : "Work") },
    { key: "project", header: "Project", value: (e) => e.projectName },
    { key: "client", header: "Client", value: (e) => e.clientName },
    { key: "task", header: "Task", value: (e) => e.taskName },
    { key: "user", header: "Person", value: (e) => e.userName },
    { key: "tags", header: "Tags", value: (e) => e.tags.join("; ") },
    { key: "billable", header: "Billable", value: (e) => (e.billable ? "Yes" : "No") },
    {
      key: "date",
      header: "Date",
      value: (e) => formatDateInZone(new Date(e.start), tz, prefs.dateFormat),
    },
    {
      key: "start",
      header: "Start",
      value: (e) => formatTimeOfDay(new Date(e.start), tz, prefs.timeFormat),
    },
    {
      key: "end",
      header: "End",
      value: (e) => formatTimeOfDay(new Date(e.end), tz, prefs.timeFormat),
    },
    {
      key: "duration",
      header: "Duration",
      value: (e) => formatDuration(e.durationSeconds, prefs.durationFormat),
    },
    ...amounts,
  ];
}

export function weeklyColumns(
  dayKeys: string[],
  prefs: Pick<ViewerPrefs, "timezone" | "dateFormat" | "durationFormat">,
  money?: ExportMoney,
): ExportColumn<WeeklyRow>[] {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: prefs.timezone, weekday: "short" });
  const days = dayKeys.map<ExportColumn<WeeklyRow>>((dayKey, i) => {
    const noon = zonedDateTimeToInstant({ date: dayKey, hours: 12, minutes: 0 }, prefs.timezone);
    return {
      key: dayKey,
      header: `${weekday.format(noon)} ${formatDateInZone(noon, prefs.timezone, prefs.dateFormat)}`,
      value: (r) => formatDuration(r.days[i] ?? 0, prefs.durationFormat),
    };
  });
  return [
    { key: "name", header: "Name", value: (r) => r.label },
    ...days,
    { key: "total", header: "Total", value: (r) => formatDuration(r.total, prefs.durationFormat) },
    ...(money ? amountColumns<WeeklyRow>(money, (r) => r) : []),
  ];
}

/** One line of the attendance export: a day, a person's week, or their total. */
export interface AttendanceExportRow {
  userName: string;
  /** The person's own timezone: first in and last out are their local times. */
  timezone: string;
  label: { kind: "day"; dateKey: string } | { kind: "week"; weekStart: string } | { kind: "total" };
  firstStart: string | null;
  lastEnd: string | null;
  holiday: string | null;
  measures: Omit<AttendanceWeek, "weekStart">;
}

/** Each person's days, then each week's subtotal after its last day, then their total. */
export function flattenAttendance(
  people: readonly {
    userName: string;
    timezone: string;
    days: readonly AttendanceDay[];
    weeks: readonly AttendanceWeek[];
    totals: AttendanceWeek;
  }[],
): AttendanceExportRow[] {
  const rows: AttendanceExportRow[] = [];
  for (const p of people) {
    const base = { userName: p.userName, timezone: p.timezone };
    p.weeks.forEach((week, i) => {
      const next = p.weeks[i + 1]?.weekStart;
      for (const d of p.days) {
        if (d.dateKey < week.weekStart || (next && d.dateKey >= next)) continue;
        rows.push({
          ...base,
          label: { kind: "day", dateKey: d.dateKey },
          firstStart: d.firstStart,
          lastEnd: d.lastEnd,
          holiday: d.holiday,
          measures: d,
        });
      }
      rows.push({
        ...base,
        label: { kind: "week", weekStart: week.weekStart },
        firstStart: null,
        lastEnd: null,
        holiday: null,
        measures: week,
      });
    });
    rows.push({
      ...base,
      label: { kind: "total" },
      firstStart: null,
      lastEnd: null,
      holiday: null,
      measures: p.totals,
    });
  }
  return rows;
}

export function attendanceColumns(
  prefs: Pick<ViewerPrefs, "dateFormat" | "timeFormat" | "durationFormat">,
): ExportColumn<AttendanceExportRow>[] {
  const date = (key: string) =>
    formatDateInZone(
      zonedDateTimeToInstant({ date: key, hours: 12, minutes: 0 }, "UTC"),
      "UTC",
      prefs.dateFormat,
    );
  const time = (iso: string | null, tz: string) =>
    iso === null ? null : formatTimeOfDay(new Date(iso), tz, prefs.timeFormat);
  const span = (key: keyof AttendanceExportRow["measures"], header: string) => ({
    key,
    header,
    value: (r: AttendanceExportRow) => formatDuration(r.measures[key], prefs.durationFormat),
  });
  return [
    { key: "person", header: "Person", value: (r) => r.userName },
    {
      key: "date",
      header: "Date",
      value: (r) =>
        r.label.kind === "day"
          ? date(r.label.dateKey)
          : r.label.kind === "week"
            ? `Week of ${date(r.label.weekStart)}`
            : "Total",
    },
    { key: "firstIn", header: "First in", value: (r) => time(r.firstStart, r.timezone) },
    { key: "lastOut", header: "Last out", value: (r) => time(r.lastEnd, r.timezone) },
    span("workSeconds", "Work"),
    span("breakSeconds", "Breaks"),
    span("timeOffSeconds", "Time off"),
    span("capacitySeconds", "Capacity"),
    span("overtimeSeconds", "Overtime"),
    span("undertimeSeconds", "Undertime"),
    { key: "holiday", header: "Holiday", value: (r) => r.holiday },
  ];
}

function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  // Text a spreadsheet would run as a formula (=, +, -, @, tab or CR first) gets a leading
  // apostrophe, so a description cannot become a live link or command in Excel.
  // A plain negative number (a loss) is a number, not a formula.
  const risky =
    typeof value === "string" && /^[=+\-@\t\r]/.test(value) && !/^-\d+(\.\d+)?$/.test(value);
  const text = risky ? `'${value}` : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC 4180 with CRLF and a UTF-8 BOM, which spreadsheet apps need to read non-ASCII text. */
export function toCsv<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
