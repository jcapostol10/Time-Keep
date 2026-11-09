import "server-only";

import {
  addDaysInZone,
  addTotals,
  bucketFor,
  bucketKeyOfDay,
  bucketKeys,
  buildWeekly,
  can,
  EMPTY_TOTALS,
  type GroupKey,
  groupRows,
  hideCosts,
  type Progress,
  type ReportGroup,
  localDateKey,
  NONE_ID,
  profitGroupKey,
  type ReportQuery,
  type ReportRow,
  type ReportTotals,
  resolveReportRange,
  type RoundingRule,
  roundingRuleOf,
  type ViewerPrefs,
  weekBounds,
} from "@timekeep/core";
import {
  and,
  asc,
  client,
  type Database,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  kioskPhoto,
  isNotNull,
  isNull,
  lt,
  membership,
  or,
  project,
  roundedAmountSql,
  roundedCostSql,
  roundedSecondsSql,
  sql,
  tag,
  task,
  timeEntry,
  timeEntryTag,
  user,
  userGroup,
  userGroupMember,
  workspaceSettings,
} from "@timekeep/db";
import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type {
  DetailedCursor,
  DetailedEntryDTO,
  DetailedPage,
  DetailedSort,
  ReportFilterOptions,
  ReportMoney,
  SeriesPoint,
  SummaryReport,
  WeeklyReport,
} from "@/lib/report-types";

import { assertCan, scopeFilter } from "./authz";
import { listClientOptions } from "./catalog/clients";
import { listPickerProjects } from "./catalog/projects";
import { listTagOptions } from "./catalog/tags";
import type { Viewer } from "./catalog/viewer";
import { progressForProjects } from "./estimates";
import { type ExpenseGroupTotals, expenseTotalsBy } from "./expense-report";
import { listMembers } from "./queries/team";
import { WorkspaceAccessError } from "./access-error";

/**
 * The report engine: one scoped aggregation over stopped, live entries.
 * Grouping keys and sort columns come from fixed vocabularies and reach SQL
 * as ordinals or columns, never as text from a URL. Members only ever see
 * their own time; team readers (owner, admin, manager) choose whose.
 *
 * Every query joins project, client, task and user the same way (spelled
 * out per select: a generic helper would erase Drizzle's row types); the
 * tag join is added only when tags are a grouping key, since it multiplies
 * rows.
 */

type Executor = Pick<Database, "query" | "select" | "insert" | "update" | "delete" | "execute">;

/**
 * The query the engine runs: a member's is pinned to their own entries. A
 * manager's filters stay as given; `scopeFilter` then narrows the rows, so a
 * person or group outside the scope matches nothing instead of widening it.
 */
export function effectiveQuery(query: ReportQuery, viewer: Viewer): ReportQuery {
  return canReadTeam(viewer) ? query : { ...query, userIds: [viewer.userId], groupIds: [] };
}

function canReadTeam(viewer: Viewer): boolean {
  return can(viewer.actor, "report.readTeam", { kind: "none" });
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** `ids` may carry NONE_ID, meaning rows where the column is null. */
function idFilter(column: AnyPgColumn, ids: string[]): SQL {
  const real = ids.filter((id) => id !== NONE_ID);
  const parts: SQL[] = [];
  if (real.length > 0) parts.push(inArray(column, real));
  if (ids.includes(NONE_ID)) parts.push(isNull(column));
  return parts.length === 1 ? parts[0]! : or(...parts)!;
}

function tagFilter(ids: string[], mode: "and" | "or"): SQL {
  const real = ids.filter((id) => id !== NONE_ID);
  const none = sql`not exists (select 1 from ${timeEntryTag} where ${timeEntryTag.timeEntryId} = ${timeEntry.id})`;
  if (real.length === 0) return none;
  const main =
    mode === "and"
      ? sql`(select count(distinct ${timeEntryTag.tagId}) from ${timeEntryTag} where ${timeEntryTag.timeEntryId} = ${timeEntry.id} and ${inArray(timeEntryTag.tagId, real)}) = ${real.length}`
      : sql`exists (select 1 from ${timeEntryTag} where ${timeEntryTag.timeEntryId} = ${timeEntry.id} and ${inArray(timeEntryTag.tagId, real)})`;
  return ids.includes(NONE_ID) ? or(main, none)! : main;
}

/** The Audit tab's criteria, combined with OR (decision: any one makes a problem entry). */
function auditConditions(eff: ReportQuery): SQL | undefined {
  const parts: SQL[] = [];
  for (const criterion of eff.audit ?? []) {
    switch (criterion) {
      case "noProject":
        parts.push(isNull(timeEntry.projectId));
        break;
      case "noTask":
        // Only where the project has active tasks to pick from.
        parts.push(
          and(
            isNull(timeEntry.taskId),
            isNotNull(timeEntry.projectId),
            sql`exists (select 1 from ${task} t where t."project_id" = ${timeEntry.projectId} and t."status" = 'ACTIVE')`,
          )!,
        );
        break;
      case "short":
        parts.push(lt(timeEntry.durationSeconds, eff.shortMinutes * 60));
        break;
      case "long":
        parts.push(gt(timeEntry.durationSeconds, eff.longHours * 3600));
        break;
    }
  }
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : or(...parts);
}

function baseConditions(
  viewer: Viewer,
  query: ReportQuery,
  range: { from: Date; to: Date },
): SQL[] {
  const eff = effectiveQuery(query, viewer);
  const conds: SQL[] = [
    eq(timeEntry.workspaceId, viewer.workspaceId),
    isNull(timeEntry.deletedAt),
    isNotNull(timeEntry.end),
    gte(timeEntry.start, range.from),
    lt(timeEntry.start, range.to),
  ];
  const scope = scopeFilter(viewer.actor);
  if (scope) conds.push(scope);
  if (eff.userIds.length > 0) conds.push(inArray(timeEntry.userId, eff.userIds));
  if (eff.groupIds.length > 0) {
    conds.push(
      inArray(
        timeEntry.userId,
        sql`(select ${userGroupMember.userId} from ${userGroupMember} inner join ${userGroup} on ${userGroup.id} = ${userGroupMember.groupId} where ${userGroup.workspaceId} = ${viewer.workspaceId} and ${inArray(userGroupMember.groupId, eff.groupIds)})`,
      ),
    );
  }
  if (eff.clientIds.length > 0) conds.push(idFilter(project.clientId, eff.clientIds));
  if (eff.projectIds.length > 0) conds.push(idFilter(timeEntry.projectId, eff.projectIds));
  if (eff.taskIds.length > 0) conds.push(idFilter(timeEntry.taskId, eff.taskIds));
  if (eff.tagIds.length > 0) conds.push(tagFilter(eff.tagIds, eff.tagMode));
  if (eff.billable !== "all") conds.push(eq(timeEntry.billable, eff.billable === "yes"));
  if (eff.type !== "all") conds.push(eq(timeEntry.type, eff.type));
  const audit = auditConditions(eff);
  if (audit) conds.push(audit);
  const text = eff.description.trim();
  if (text) conds.push(ilike(timeEntry.description, `%${escapeLike(text)}%`));
  return conds;
}

// Sums are bigint: a 32-bit int overflows at 2^31 seconds (68 years of time, one year of a
// 300-person company). node-postgres returns bigint as text, so mapWith(Number).
const COUNT = sql<number>`count(*)::int`;
const UNRATED = sql<number>`(count(*) filter (where ${timeEntry.billable} and ${timeEntry.amountMinor} is null))::int`;
/** Work without a cost rate: it counts as zero cost, and is counted (Phase 6a). */
const UNCOSTED = sql<number>`(count(*) filter (where ${timeEntry.type} = 'work' and ${timeEntry.costAmountMinor} is null))::int`;
/**
 * The hidden grouping key every aggregate carries: the entry's currency
 * (null = the workspace's). A rated entry's is the one its amount was
 * computed in (`rate_currency`), so a number is never shown under another
 * code, whatever its client says today; an entry without an amount follows
 * its project's client. Money in two currencies is never added, so each
 * currency is summed on its own row and folded here.
 */
const CURRENCY = sql<string | null>`coalesce(${timeEntry.rateCurrency}, ${client.currency})`;

/** A bigint/int column or expression that may be null: node-postgres returns it as text. */
const nullableNumber = (v: unknown): number | null => (v === null ? null : Number(v));

interface Measures {
  duration: SQL<number>;
  billable: SQL<number>;
  nonBillable: SQL<number>;
  amount: SQL<number>;
  cost: SQL<number>;
}

/** One aggregated row of one currency, as SQL returns it. */
interface MeasureRow {
  currency: unknown;
  durationSeconds: unknown;
  billableSeconds: unknown;
  entryCount: unknown;
  amountMinor: unknown;
  unratedCount: unknown;
  costMinor: unknown;
  uncostedCount: unknown;
}

/**
 * A row's totals. Its amount is in its own currency: the workspace's goes to
 * `amountMinor`, any other to `otherAmounts`. Cost is always the workspace's.
 * Profit is amount less cost where both are in the workspace currency; a row
 * billed in another currency is left out and its entries counted (decision 7).
 */
function totalsOfRow(row: MeasureRow, workspaceCurrency: string): ReportTotals {
  const currency =
    row.currency === null || row.currency === undefined ? workspaceCurrency : String(row.currency);
  const own = currency === workspaceCurrency;
  const amount = Number(row.amountMinor);
  const cost = Number(row.costMinor);
  const entryCount = Number(row.entryCount);
  return {
    durationSeconds: Number(row.durationSeconds),
    billableSeconds: Number(row.billableSeconds),
    entryCount,
    amountMinor: own ? amount : 0,
    otherAmounts: own || amount === 0 ? [] : [{ currency, amountMinor: amount }],
    unratedCount: Number(row.unratedCount),
    costMinor: cost,
    uncostedCount: Number(row.uncostedCount),
    profitMinor: own ? amount - cost : 0,
    profitExcludedCount: own ? 0 : entryCount,
    // Expenses join only in the Profit tab (Phase 6c), from their own aggregate.
    expenseMinor: 0,
    billableExpenseMinor: 0,
  };
}

/**
 * The sums, over raw durations or, with a rounding rule (decision 13), over
 * each entry's rounded duration and the amount recomputed from it with the
 * entry's stored rate. Amounts count billable entries only; an unrated
 * billable entry has a null amount.
 */
function measures(rule: RoundingRule | null): Measures {
  const s = rule ? roundedSecondsSql(rule) : sql`${timeEntry.durationSeconds}`;
  const a = rule ? roundedAmountSql(rule) : sql`${timeEntry.amountMinor}`;
  // Cost counts every work entry, billable or not; a break has none.
  const c = rule ? roundedCostSql(rule) : sql`${timeEntry.costAmountMinor}`;
  return {
    cost: sql`coalesce(sum(${c}), 0)::bigint`.mapWith(Number),
    duration: sql`coalesce(sum(${s}), 0)::bigint`.mapWith(Number),
    billable:
      sql`coalesce(sum(case when ${timeEntry.billable} then ${s} else 0 end), 0)::bigint`.mapWith(
        Number,
      ),
    nonBillable:
      sql`coalesce(sum(case when ${timeEntry.billable} then 0 else ${s} end), 0)::bigint`.mapWith(
        Number,
      ),
    amount:
      sql`coalesce(sum(case when ${timeEntry.billable} then ${a} else 0 end), 0)::bigint`.mapWith(
        Number,
      ),
  };
}

interface ReportSettings {
  currency: string;
  rounding: RoundingRule | null;
}

/** The workspace's currency and rounding rule: one primary-key read per report. */
async function reportSettings(db: Executor, workspaceId: string): Promise<ReportSettings> {
  const row = await db.query.workspaceSettings.findFirst({
    where: eq(workspaceSettings.workspaceId, workspaceId),
    columns: { currency: true, roundingMode: true, roundingMinutes: true },
  });
  return { currency: row?.currency ?? "USD", rounding: row ? roundingRuleOf(row) : null };
}

/** The rule this query applies: the workspace's, unless the URL asks for raw time. */
function ruleFor(query: ReportQuery, settings: ReportSettings): RoundingRule | null {
  return query.rounding === "on" ? settings.rounding : null;
}

/**
 * The workspace currency when the viewer may see amounts, else null (and
 * amounts read 0); `costs` when they may also see cost and profit.
 */
function moneyOf(viewer: Viewer, settings: ReportSettings): ReportMoney {
  if (viewer.hideAmounts || !can(viewer.actor, "report.viewAmounts", { kind: "none" })) return null;
  return {
    currency: settings.currency,
    costs: !viewer.hideCosts && can(viewer.actor, "report.viewCosts", { kind: "none" }),
  };
}

/** Totals as the viewer may see them: hidden money reads 0, on the server. */
function maskTotals(t: ReportTotals, money: ReportMoney): ReportTotals {
  if (!money) return hideCosts({ ...t, amountMinor: 0, otherAmounts: [], unratedCount: 0 });
  return money.costs ? t : hideCosts(t);
}

function maskGroups(groups: ReportGroup[], money: ReportMoney): ReportGroup[] {
  if (money?.costs) return groups;
  return groups.map((g) => ({
    ...g,
    totals: maskTotals(g.totals, money),
    children: maskGroups(g.children, money),
  }));
}

function localStart(tz: string): SQL {
  return sql`(${timeEntry.start} at time zone ${tz})`;
}

function dayDateExpr(tz: string): SQL {
  return sql`(${localStart(tz)})::date`;
}

function weekDateExpr(tz: string, weekStart: number): SQL {
  // The date of the week's first day, by the viewer's week start (0 = Sunday, as Postgres' dow).
  return sql`((${localStart(tz)})::date - ((((extract(dow from ${localStart(tz)}))::int - ${weekStart}) % 7 + 7) % 7))`;
}

function monthDateExpr(tz: string): SQL {
  return sql`(date_trunc('month', ${localStart(tz)}))::date`;
}

function dateKeyExpr(tz: string): SQL<string> {
  return sql<string>`to_char(${dayDateExpr(tz)}, 'YYYY-MM-DD')`;
}

function weekKeyExpr(tz: string, weekStart: number): SQL<string> {
  return sql<string>`to_char(${weekDateExpr(tz, weekStart)}, 'YYYY-MM-DD')`;
}

function monthKeyExpr(tz: string): SQL<string> {
  return sql<string>`to_char(${monthDateExpr(tz)}, 'YYYY-MM')`;
}

/** The id and label expressions of a grouping key. */
function groupExprs(key: GroupKey, prefs: ViewerPrefs): { id: SQL; label: SQL } {
  const tz = prefs.timezone;
  switch (key) {
    case "project":
      return {
        id: sql`${timeEntry.projectId}`,
        label: sql`coalesce(${project.name}, 'No project')`,
      };
    case "client":
      return { id: sql`${project.clientId}`, label: sql`coalesce(${client.name}, 'No client')` };
    case "user":
      return { id: sql`${timeEntry.userId}`, label: sql`${user.name}` };
    case "task":
      return { id: sql`${timeEntry.taskId}`, label: sql`coalesce(${task.name}, 'No task')` };
    case "tag":
      return { id: sql`${tag.id}`, label: sql`coalesce(${tag.name}, 'No tag')` };
    case "date": {
      const k = dateKeyExpr(tz);
      return { id: k, label: k };
    }
    case "week": {
      const k = weekKeyExpr(tz, prefs.weekStart);
      return { id: k, label: k };
    }
    case "month": {
      const k = monthKeyExpr(tz);
      return { id: k, label: k };
    }
    case "description":
      return {
        id: sql`${timeEntry.description}`,
        label: sql`case when ${timeEntry.description} = '' then 'No description' else ${timeEntry.description} end`,
      };
  }
}

/** The currency key and the sums, in the order every aggregate selects them. */
const measureFields = (m: Measures) => ({
  currency: CURRENCY,
  durationSeconds: m.duration,
  billableSeconds: m.billable,
  entryCount: COUNT,
  amountMinor: m.amount,
  unratedCount: UNRATED,
  costMinor: m.cost,
  uncostedCount: UNCOSTED,
});

async function aggregateTotals(
  db: Executor,
  where: SQL,
  m: Measures,
  workspaceCurrency: string,
): Promise<ReportTotals> {
  const rows = await db
    .select(measureFields(m))
    .from(timeEntry)
    .leftJoin(project, eq(project.id, timeEntry.projectId))
    .leftJoin(client, eq(client.id, project.clientId))
    .leftJoin(task, eq(task.id, timeEntry.taskId))
    .innerJoin(user, eq(user.id, timeEntry.userId))
    .where(where)
    .groupBy(sql.raw("1"));
  return rows.reduce<ReportTotals>(
    (sum, row) => addTotals(sum, totalsOfRow(row, workspaceCurrency)),
    EMPTY_TOTALS,
  );
}

/**
 * One row per group and currency: `groupRows` adds the rows of a group, so a
 * group billed in two currencies comes out as one, with both amounts.
 */
async function groupedRows(
  db: Executor,
  where: SQL,
  keys: GroupKey[],
  prefs: ViewerPrefs,
  m: Measures,
  workspaceCurrency: string,
): Promise<ReportRow[]> {
  const fields: Record<string, SQL> = {};
  keys.forEach((key, i) => {
    const { id, label } = groupExprs(key, prefs);
    fields[`id${i}`] = id;
    fields[`label${i}`] = label;
  });
  // Group by ordinal position: the same expression carries a different parameter
  // index in SELECT and GROUP BY, which Postgres would not match.
  // The currency key follows the grouping keys.
  const ordinals = [
    ...keys.flatMap((_, i) => [sql.raw(String(2 * i + 1)), sql.raw(String(2 * i + 2))]),
    sql.raw(String(2 * keys.length + 1)),
  ];
  const base = db
    .select({ ...fields, ...measureFields(m) })
    .from(timeEntry)
    .leftJoin(project, eq(project.id, timeEntry.projectId))
    .leftJoin(client, eq(client.id, project.clientId))
    .leftJoin(task, eq(task.id, timeEntry.taskId))
    .innerJoin(user, eq(user.id, timeEntry.userId))
    .$dynamic();
  const query = keys.includes("tag")
    ? base
        .leftJoin(timeEntryTag, eq(timeEntryTag.timeEntryId, timeEntry.id))
        .leftJoin(tag, eq(tag.id, timeEntryTag.tagId))
    : base;
  const rows: Record<string, unknown>[] = await query.where(where).groupBy(...ordinals);
  return rows.map((rec) => {
    const out: ReportRow = {
      keys: {},
      totals: totalsOfRow(rec as unknown as MeasureRow, workspaceCurrency),
    };
    keys.forEach((key, i) => {
      const id = rec[`id${i}`];
      out.keys[key] = {
        id: id === null || id === undefined ? null : String(id),
        label: String(rec[`label${i}`] ?? ""),
      };
    });
    return out;
  });
}

async function seriesRows(
  db: Executor,
  where: SQL,
  bucket: SummaryReport["bucket"],
  prefs: ViewerPrefs,
  range: { from: Date; to: Date },
  m: Measures,
  workspaceCurrency: string,
): Promise<{ series: SeriesPoint[]; totals: ReportTotals }> {
  // Sum by local day, the cheapest key per row (one time zone conversion), then roll the few
  // hundred days up into weeks or months here. Formatting per row, or a week expression,
  // cost a single-worker scan of a year of entries twice as long.
  const grouped = db
    .select({
      d: sql`${dayDateExpr(prefs.timezone)}`.as("d"),
      cur: CURRENCY.as("cur"),
      b: m.billable.as("b"),
      nb: m.nonBillable.as("nb"),
      n: COUNT.as("n"),
      a: m.amount.as("a"),
      u: UNRATED.as("u"),
      c: m.cost.as("c"),
      uc: UNCOSTED.as("uc"),
    })
    .from(timeEntry)
    .leftJoin(project, eq(project.id, timeEntry.projectId))
    .leftJoin(client, eq(client.id, project.clientId))
    .leftJoin(task, eq(task.id, timeEntry.taskId))
    .innerJoin(user, eq(user.id, timeEntry.userId))
    .where(where)
    .groupBy(sql.raw("1"), sql.raw("2"))
    .as("series");
  const days = await db
    .select({
      day: sql<string>`to_char(${grouped.d}, 'YYYY-MM-DD')`,
      currency: sql<string | null>`${grouped.cur}`,
      billableSeconds: sql`${grouped.b}`.mapWith(Number),
      nonBillableSeconds: sql`${grouped.nb}`.mapWith(Number),
      entryCount: sql`${grouped.n}`.mapWith(Number),
      amountMinor: sql`${grouped.a}`.mapWith(Number),
      unratedCount: sql`${grouped.u}`.mapWith(Number),
      costMinor: sql`${grouped.c}`.mapWith(Number),
      uncostedCount: sql`${grouped.uc}`.mapWith(Number),
    })
    .from(grouped);
  const rows = new Map<string, { billableSeconds: number; nonBillableSeconds: number }>();
  for (const d of days) {
    const key = bucketKeyOfDay(d.day, bucket, prefs.weekStart);
    const acc = rows.get(key) ?? { billableSeconds: 0, nonBillableSeconds: 0 };
    acc.billableSeconds += d.billableSeconds;
    acc.nonBillableSeconds += d.nonBillableSeconds;
    rows.set(key, acc);
  }
  // Every entry lands in exactly one bucket (no tag join here), so the buckets add up to the
  // report's totals and the summary needs no third scan.
  const totals = days.reduce<ReportTotals>(
    (acc, r) =>
      addTotals(
        acc,
        totalsOfRow(
          { ...r, durationSeconds: r.billableSeconds + r.nonBillableSeconds },
          workspaceCurrency,
        ),
      ),
    EMPTY_TOTALS,
  );
  const series = bucketKeys(range.from, range.to, bucket, prefs).map(({ key, label }) => ({
    key,
    label,
    billableSeconds: rows.get(key)?.billableSeconds ?? 0,
    nonBillableSeconds: rows.get(key)?.nonBillableSeconds ?? 0,
  }));
  return { series, totals };
}

export async function summaryReport(
  db: Executor,
  viewer: Viewer,
  query: ReportQuery,
  prefs: ViewerPrefs,
  now: Date = new Date(),
): Promise<SummaryReport> {
  const eff = effectiveQuery(query, viewer);
  const range = resolveReportRange(eff, prefs, now);
  const where = and(...baseConditions(viewer, eff, range))!;
  const bucket = bucketFor(range.from, range.to, prefs.timezone, eff.bucket);
  // Independent scans of the same range, side by side (one connection each).
  // Below a tag level the join repeats a multi-tag entry, so the levels above it are
  // grouped again without the join.
  const tagAt = eff.groupBy.indexOf("tag");
  const settings = await reportSettings(db, viewer.workspaceId);
  const m = measures(ruleFor(eff, settings));
  const money = moneyOf(viewer, settings);
  const cur = settings.currency;
  const [rows, { series, totals }, prefixRows] = await Promise.all([
    groupedRows(db, where, eff.groupBy, prefs, m, cur),
    seriesRows(db, where, bucket, prefs, range, m, cur),
    tagAt > 0 ? groupedRows(db, where, eff.groupBy.slice(0, tagAt), prefs, m, cur) : undefined,
  ]);
  const { groups } = groupRows(rows, eff.groupBy, totals, prefixRows);
  return {
    money,
    range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
    bucket,
    series,
    groupBy: eff.groupBy,
    groups: maskGroups(groups, money),
    totals: maskTotals(totals, money),
    progress: await progressOfGroups(db, viewer, eff.groupBy, groups, now),
  };
}

/** The ids under the `project` level of the grouping tree. */
function projectIdsIn(groups: ReportGroup[], depth: number): string[] {
  if (depth === 0) return groups.flatMap((g) => (g.id === null ? [] : [g.id]));
  return groups.flatMap((g) => projectIdsIn(g.children, depth - 1));
}

/**
 * Budget progress for the Summary rows grouped by project (Phase 6b): never
 * on a share link or the dashboard (`hideCosts`), and only the bars the
 * viewer may see.
 */
async function progressOfGroups(
  db: Executor,
  viewer: Viewer,
  keys: GroupKey[],
  groups: ReportGroup[],
  now: Date,
): Promise<Record<string, Progress> | null> {
  const depth = keys.indexOf("project");
  if (depth < 0 || viewer.hideCosts) return null;
  const ids = [...new Set(projectIdsIn(groups, depth))];
  const progress = await progressForProjects(db, viewer, ids, now);
  return progress.size > 0 ? Object.fromEntries(progress) : null;
}

/** A group's totals with its expenses folded in (Phase 6c decision 19). */
function withExpenses(t: ReportTotals, spent: ExpenseGroupTotals["totals"]): ReportTotals {
  return {
    ...t,
    expenseMinor: spent.amountMinor,
    billableExpenseMinor: spent.billableMinor,
    // Billable expenses are revenue, every expense a cost; the workspace currency only.
    profitMinor: t.profitMinor + spent.billableMinor - spent.amountMinor,
  };
}

/**
 * The Profit tab (Phase 6a): the Summary engine over one grouping key
 * (project, client or person), its groups sorted by profit. Only for viewers
 * who may see cost; a share link never is one. Expenses join each group
 * (Phase 6c) unless the query filters by task, tag or description, which an
 * expense has none of; a group with expenses and no time is appended.
 */
export async function profitReport(
  db: Executor,
  viewer: Viewer,
  query: ReportQuery,
  prefs: ViewerPrefs,
  now: Date = new Date(),
): Promise<SummaryReport> {
  assertCan(viewer.actor, "report.viewCosts", { kind: "none" });
  if (viewer.hideCosts || viewer.hideAmounts) {
    throw new WorkspaceAccessError(403, "You don't have permission to do that.");
  }
  const key = profitGroupKey(query);
  const timeOnly =
    query.taskIds.length > 0 || query.tagIds.length > 0 || query.description.trim() !== "";
  const [report, spent] = await Promise.all([
    summaryReport(db, viewer, { ...query, groupBy: [key] }, prefs, now),
    timeOnly
      ? new Map<string | null, ExpenseGroupTotals>()
      : expenseTotalsBy(db, viewer, key, query, prefs, now),
  ]);
  const groups = report.groups.map((g) => {
    const s = spent.get(g.id);
    if (!s) return g;
    spent.delete(g.id);
    return { ...g, totals: withExpenses(g.totals, s.totals) };
  });
  for (const [id, s] of spent) {
    groups.push({
      key,
      id,
      label: s.label,
      totals: withExpenses(EMPTY_TOTALS, s.totals),
      children: [],
    });
  }
  return {
    ...report,
    groups: groups.sort(
      (a, b) => b.totals.profitMinor - a.totals.profitMinor || a.label.localeCompare(b.label),
    ),
    totals: groups.reduce((sum, g) => addTotals(sum, g.totals), EMPTY_TOTALS),
  };
}

export async function detailedReport(
  db: Executor,
  viewer: Viewer,
  query: ReportQuery,
  prefs: ViewerPrefs,
  page: { cursor?: DetailedCursor; sort: DetailedSort; dir: "asc" | "desc"; limit?: number },
  now: Date = new Date(),
): Promise<DetailedPage> {
  const eff = effectiveQuery(query, viewer);
  const range = resolveReportRange(eff, prefs, now);
  const base = baseConditions(viewer, eff, range);
  const limit = Math.min(Math.max(page.limit ?? 50, 1), 200);
  const sortColumn = page.sort === "duration" ? timeEntry.durationSeconds : timeEntry.start;
  const conds = [...base];
  if (page.cursor) {
    const value =
      page.sort === "duration" ? Number(page.cursor.value) : new Date(page.cursor.value);
    conds.push(
      page.dir === "desc"
        ? sql`(${sortColumn}, ${timeEntry.id}) < (${value}, ${page.cursor.id})`
        : sql`(${sortColumn}, ${timeEntry.id}) > (${value}, ${page.cursor.id})`,
    );
  }
  const order = page.dir === "desc" ? desc : asc;
  const settings = await reportSettings(db, viewer.workspaceId);
  const rule = ruleFor(eff, settings);
  const rows = await db
    .select({
      id: timeEntry.id,
      description: timeEntry.description,
      userId: timeEntry.userId,
      userName: user.name,
      projectId: timeEntry.projectId,
      projectName: project.name,
      projectColor: project.color,
      clientName: client.name,
      taskId: timeEntry.taskId,
      taskName: task.name,
      billable: timeEntry.billable,
      type: timeEntry.type,
      start: timeEntry.start,
      end: timeEntry.end,
      durationSeconds: sql`${rule ? roundedSecondsSql(rule) : timeEntry.durationSeconds}`.mapWith(
        nullableNumber,
      ),
      // The keyset cursor follows the sort column, which is the raw duration.
      rawDurationSeconds: timeEntry.durationSeconds,
      ownerStatus: membership.status,
      rateMinor: timeEntry.billableRateMinor,
      amountMinor: sql`${rule ? roundedAmountSql(rule) : timeEntry.amountMinor}`.mapWith(
        nullableNumber,
      ),
      rateCurrency: timeEntry.rateCurrency,
      clientCurrency: client.currency,
      costMinor: sql`${rule ? roundedCostSql(rule) : timeEntry.costAmountMinor}`.mapWith(
        nullableNumber,
      ),
    })
    .from(timeEntry)
    .leftJoin(project, eq(project.id, timeEntry.projectId))
    .leftJoin(client, eq(client.id, project.clientId))
    .leftJoin(task, eq(task.id, timeEntry.taskId))
    .innerJoin(user, eq(user.id, timeEntry.userId))
    .leftJoin(
      membership,
      and(
        eq(membership.workspaceId, timeEntry.workspaceId),
        eq(membership.userId, timeEntry.userId),
      ),
    )
    .where(and(...conds))
    .orderBy(order(sortColumn), order(timeEntry.id))
    .limit(limit + 1);
  const pageRows = rows.slice(0, limit);
  const money = moneyOf(viewer, settings);
  const ids = pageRows.map((r) => r.id);
  const tagRows =
    ids.length > 0
      ? await db
          .select({ entryId: timeEntryTag.timeEntryId, id: tag.id, name: tag.name })
          .from(timeEntryTag)
          .innerJoin(tag, eq(tag.id, timeEntryTag.tagId))
          .where(inArray(timeEntryTag.timeEntryId, ids))
      : [];
  const withPhoto = new Set(
    ids.length > 0 && can(viewer.actor, "kiosk.manage", { kind: "none" })
      ? (
          await db
            .select({ entryId: kioskPhoto.entryId })
            .from(kioskPhoto)
            .where(inArray(kioskPhoto.entryId, ids))
        ).map((p) => p.entryId)
      : [],
  );
  const tagsByEntry = new Map<string, { id: string; name: string }[]>();
  for (const t of tagRows) {
    const list = tagsByEntry.get(t.entryId) ?? [];
    list.push({ id: t.id, name: t.name });
    tagsByEntry.set(t.entryId, list);
  }
  const entries: DetailedEntryDTO[] = pageRows.map((r) => {
    const tags = tagsByEntry.get(r.id) ?? [];
    const editable =
      r.ownerStatus === "ACTIVE" &&
      can(viewer.actor, "entry.write", { kind: "entry", userId: r.userId, projectId: r.projectId });
    // The currency its amount was rated in; unrated, its project's client's, else the workspace's.
    const currency = money ? (r.rateCurrency ?? r.clientCurrency ?? money.currency) : null;
    const amountMinor = money && r.billable ? (r.amountMinor ?? null) : null;
    const costs = money?.costs ?? false;
    return {
      id: r.id,
      description: r.description,
      projectName: r.projectName ?? null,
      clientName: r.clientName ?? null,
      taskName: r.taskName ?? null,
      userName: r.userName,
      tags: tags.map((t) => t.name),
      billable: r.billable,
      type: r.type,
      start: r.start.toISOString(),
      end: (r.end ?? r.start).toISOString(),
      durationSeconds: r.durationSeconds ?? 0,
      rateMinor: money ? (r.rateMinor ?? null) : null,
      amountMinor,
      currency,
      costMinor: costs ? (r.costMinor ?? null) : null,
      // Amount less cost, only where both are in the workspace currency.
      profitMinor:
        costs && currency === money?.currency ? (amountMinor ?? 0) - (r.costMinor ?? 0) : null,
      userId: r.userId,
      projectId: r.projectId,
      projectColor: r.projectColor ?? null,
      taskId: r.taskId,
      tagIds: tags.map((t) => t.id),
      // A deactivated or removed owner has no scope to write in (`scopeForUser`
      // answers 404), so their rows stay read-only rather than failing on save.
      editable,
      timesEditable:
        editable &&
        can(viewer.actor, "entry.writeTimes", {
          kind: "entry",
          userId: r.userId,
          projectId: r.projectId,
        }),
      photo: withPhoto.has(r.id),
    };
  });
  const last = pageRows[pageRows.length - 1];
  const nextCursor: DetailedCursor | null =
    rows.length > limit && last
      ? {
          value:
            page.sort === "duration"
              ? String(last.rawDurationSeconds ?? 0)
              : last.start.toISOString(),
          id: last.id,
        }
      : null;
  // The range's totals are the first page's; later pages (an export's loop, Load more) skip them.
  const totals = page.cursor
    ? null
    : await aggregateTotals(db, and(...base)!, measures(rule), settings.currency);
  return {
    money,
    range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
    entries,
    nextCursor,
    totals: totals && maskTotals(totals, money),
  };
}

export async function weeklyReport(
  db: Executor,
  viewer: Viewer,
  query: ReportQuery,
  prefs: ViewerPrefs,
  now: Date = new Date(),
): Promise<WeeklyReport> {
  const eff = effectiveQuery(query, viewer);
  const by = eff.weeklyBy;
  const range = resolveReportRange(eff, prefs, now);
  const tz = prefs.timezone;
  const week = weekBounds(range.from, tz, prefs.weekStart);
  const where = and(...baseConditions(viewer, eff, { from: week.weekStart, to: week.weekEnd }))!;
  const settings = await reportSettings(db, viewer.workspaceId);
  const m = measures(ruleFor(eff, settings));
  const idExpr =
    by === "user" ? sql<string>`${timeEntry.userId}` : sql<string | null>`${timeEntry.projectId}`;
  const labelExpr =
    by === "user"
      ? sql<string>`${user.name}`
      : sql<string>`coalesce(${project.name}, 'No project')`;
  const rows = await db
    .select({
      id: idExpr,
      label: labelExpr,
      dateKey: dateKeyExpr(tz),
      currency: CURRENCY,
      seconds: m.duration,
      amountMinor: m.amount,
    })
    .from(timeEntry)
    .leftJoin(project, eq(project.id, timeEntry.projectId))
    .leftJoin(client, eq(client.id, project.clientId))
    .leftJoin(task, eq(task.id, timeEntry.taskId))
    .innerJoin(user, eq(user.id, timeEntry.userId))
    .where(where)
    .groupBy(sql.raw("1"), sql.raw("2"), sql.raw("3"), sql.raw("4"));
  const dayKeys = Array.from({ length: 7 }, (_, i) =>
    localDateKey(addDaysInZone(week.weekStart, i, tz), tz),
  );
  const grid = buildWeekly(
    rows.map((r) => {
      // One row per currency: the workspace's is the row's amount, the rest are listed.
      const amount = Number(r.amountMinor);
      const currency = r.currency ?? settings.currency;
      const own = currency === settings.currency;
      return {
        id: r.id === null || r.id === undefined ? null : String(r.id),
        label: String(r.label),
        dateKey: String(r.dateKey),
        seconds: Number(r.seconds),
        amountMinor: own ? amount : 0,
        otherAmounts: own || amount === 0 ? [] : [{ currency, amountMinor: amount }],
      };
    }),
    dayKeys,
  );
  const money = moneyOf(viewer, settings);
  return {
    money,
    weekStart: week.weekStart.toISOString(),
    dayKeys,
    by,
    ...grid,
    rows: money ? grid.rows : grid.rows.map((r) => ({ ...r, amountMinor: 0, otherAmounts: [] })),
    amountMinor: money ? grid.amountMinor : 0,
    otherAmounts: money ? grid.otherAmounts : [],
  };
}

/** The filter bar's options, by role: members get no Users filter. */
/**
 * People with time in the workspace who are not active members (deactivated,
 * or their membership is gone): team reports still count their entries, so
 * the Users filter must offer them. A loose index scan over
 * time_entry_workspace_user_start_idx: one probe per person, not one row
 * per entry.
 */
async function formerMembers(
  db: Executor,
  workspaceId: string,
  activeIds: Set<string>,
): Promise<{ id: string; name: string }[]> {
  const result = await db.execute<{ id: string; name: string }>(sql`
    with recursive people(user_id) as (
      (select user_id from time_entry where workspace_id = ${workspaceId} order by user_id limit 1)
      union all
      select (
        select te.user_id from time_entry te
        where te.workspace_id = ${workspaceId} and te.user_id > people.user_id
        order by te.user_id limit 1
      )
      from people where people.user_id is not null
    )
    select u.id, u.name from people join "user" u on u.id = people.user_id order by u.name, u.id
  `);
  return result.rows
    .filter((r) => !activeIds.has(r.id))
    .map((r) => ({ id: r.id, name: `${r.name} (former member)` }));
}

/**
 * The people a scoped reader may filter by: themselves, the people they
 * manage and anyone with time on a project they manage. null = everyone.
 */
async function inScopeUserIds(db: Executor, viewer: Viewer): Promise<Set<string> | null> {
  if (!scopeFilter(viewer.actor)) return null;
  const ids = new Set([viewer.userId, ...viewer.actor.managedUserIds]);
  if (viewer.actor.managedProjectIds.size > 0) {
    const rows = await db
      .select({ userId: timeEntry.userId })
      .from(timeEntry)
      .where(
        and(
          eq(timeEntry.workspaceId, viewer.workspaceId),
          isNull(timeEntry.deletedAt),
          inArray(timeEntry.projectId, [...viewer.actor.managedProjectIds]),
        ),
      )
      .groupBy(timeEntry.userId);
    for (const r of rows) ids.add(r.userId);
  }
  return ids;
}

export async function reportFilterOptions(
  db: Executor,
  viewer: Viewer,
): Promise<ReportFilterOptions> {
  const team = canReadTeam(viewer);
  const [members, clients, projects, tags, groups, scope] = await Promise.all([
    team ? listMembers(db as Database, viewer.workspaceId) : Promise.resolve(null),
    listClientOptions(db, viewer.workspaceId),
    listPickerProjects(db, viewer),
    listTagOptions(db, viewer.workspaceId),
    team
      ? db
          .select({ id: userGroup.id, name: userGroup.name })
          .from(userGroup)
          .where(eq(userGroup.workspaceId, viewer.workspaceId))
          .orderBy(asc(userGroup.name))
      : Promise.resolve(null),
    team ? inScopeUserIds(db, viewer) : Promise.resolve(null),
  ]);
  const inScope = (id: string) => !scope || scope.has(id);
  const { rounding } = await reportSettings(db, viewer.workspaceId);
  const active = members?.filter((m) => m.status === "ACTIVE") ?? null;
  const former = active
    ? await formerMembers(db, viewer.workspaceId, new Set(active.map((m) => m.userId)))
    : [];
  return {
    users: active
      ? [
          ...active.filter((m) => inScope(m.userId)).map((m) => ({ id: m.userId, name: m.name })),
          ...former.filter((m) => inScope(m.id)),
        ]
      : null,
    groups,
    clients: clients.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name })),
    projects,
    tasks: projects.flatMap((p) =>
      p.tasks.map((t) => ({ id: t.id, name: t.name, projectId: p.id })),
    ),
    tags,
    rounding,
  };
}
