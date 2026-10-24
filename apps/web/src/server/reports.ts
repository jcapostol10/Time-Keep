import "server-only";

import {
  addDaysInZone,
  bucketFor,
  bucketKeys,
  buildWeekly,
  canReadTeam,
  EMPTY_TOTALS,
  type GroupKey,
  groupRows,
  localDateKey,
  NONE_ID,
  type ReportQuery,
  type ReportRow,
  type ReportTotals,
  resolveReportRange,
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
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  project,
  sql,
  tag,
  task,
  timeEntry,
  timeEntryTag,
  user,
} from "@timekeep/db";
import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type {
  DetailedCursor,
  DetailedEntryDTO,
  DetailedPage,
  DetailedSort,
  ReportFilterOptions,
  SeriesPoint,
  SummaryReport,
  WeeklyBy,
  WeeklyReport,
} from "@/lib/report-types";

import { listClientOptions } from "./catalog/clients";
import { listPickerProjects } from "./catalog/projects";
import { listTagOptions } from "./catalog/tags";
import type { Viewer } from "./catalog/viewer";
import { listMembers } from "./queries/team";

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

/** The query the engine runs: a member's is pinned to their own entries. */
export function effectiveQuery(query: ReportQuery, viewer: Viewer): ReportQuery {
  return canReadTeam(viewer.role) ? query : { ...query, userIds: [viewer.userId] };
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
  if (eff.userIds.length > 0) conds.push(inArray(timeEntry.userId, eff.userIds));
  if (eff.clientIds.length > 0) conds.push(idFilter(project.clientId, eff.clientIds));
  if (eff.projectIds.length > 0) conds.push(idFilter(timeEntry.projectId, eff.projectIds));
  if (eff.taskIds.length > 0) conds.push(idFilter(timeEntry.taskId, eff.taskIds));
  if (eff.tagIds.length > 0) conds.push(tagFilter(eff.tagIds, eff.tagMode));
  if (eff.billable !== "all") conds.push(eq(timeEntry.billable, eff.billable === "yes"));
  const text = eff.description.trim();
  if (text) conds.push(ilike(timeEntry.description, `%${escapeLike(text)}%`));
  return conds;
}

const DURATION = sql<number>`coalesce(sum(${timeEntry.durationSeconds}), 0)::int`;
const BILLABLE = sql<number>`coalesce(sum(case when ${timeEntry.billable} then ${timeEntry.durationSeconds} else 0 end), 0)::int`;
const NON_BILLABLE = sql<number>`coalesce(sum(case when ${timeEntry.billable} then 0 else ${timeEntry.durationSeconds} end), 0)::int`;
const COUNT = sql<number>`count(*)::int`;

function localStart(tz: string): SQL {
  return sql`(${timeEntry.start} at time zone ${tz})`;
}

function dateKeyExpr(tz: string): SQL<string> {
  return sql<string>`to_char(${localStart(tz)}, 'YYYY-MM-DD')`;
}

function weekKeyExpr(tz: string, weekStart: number): SQL<string> {
  // The date of the week's first day, by the viewer's week start (0 = Sunday, as Postgres' dow).
  return sql<string>`to_char((${localStart(tz)})::date - ((((extract(dow from ${localStart(tz)}))::int - ${weekStart}) % 7 + 7) % 7), 'YYYY-MM-DD')`;
}

function monthKeyExpr(tz: string): SQL<string> {
  return sql<string>`to_char(${localStart(tz)}, 'YYYY-MM')`;
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

async function aggregateTotals(db: Executor, where: SQL): Promise<ReportTotals> {
  const [row] = await db
    .select({ durationSeconds: DURATION, billableSeconds: BILLABLE, entryCount: COUNT })
    .from(timeEntry)
    .leftJoin(project, eq(project.id, timeEntry.projectId))
    .leftJoin(client, eq(client.id, project.clientId))
    .leftJoin(task, eq(task.id, timeEntry.taskId))
    .innerJoin(user, eq(user.id, timeEntry.userId))
    .where(where);
  return row ?? EMPTY_TOTALS;
}

async function groupedRows(
  db: Executor,
  where: SQL,
  keys: GroupKey[],
  prefs: ViewerPrefs,
): Promise<ReportRow[]> {
  const fields: Record<string, SQL> = {};
  keys.forEach((key, i) => {
    const { id, label } = groupExprs(key, prefs);
    fields[`id${i}`] = id;
    fields[`label${i}`] = label;
  });
  // Group by ordinal position: the same expression carries a different parameter
  // index in SELECT and GROUP BY, which Postgres would not match.
  const ordinals = keys.flatMap((_, i) => [sql.raw(String(2 * i + 1)), sql.raw(String(2 * i + 2))]);
  const base = db
    .select({ ...fields, durationSeconds: DURATION, billableSeconds: BILLABLE, entryCount: COUNT })
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
      totals: {
        durationSeconds: Number(rec.durationSeconds),
        billableSeconds: Number(rec.billableSeconds),
        entryCount: Number(rec.entryCount),
      },
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
): Promise<SeriesPoint[]> {
  const keyExpr =
    bucket === "day"
      ? dateKeyExpr(prefs.timezone)
      : bucket === "week"
        ? weekKeyExpr(prefs.timezone, prefs.weekStart)
        : monthKeyExpr(prefs.timezone);
  const rows = await db
    .select({ key: keyExpr, billableSeconds: BILLABLE, nonBillableSeconds: NON_BILLABLE })
    .from(timeEntry)
    .leftJoin(project, eq(project.id, timeEntry.projectId))
    .leftJoin(client, eq(client.id, project.clientId))
    .leftJoin(task, eq(task.id, timeEntry.taskId))
    .innerJoin(user, eq(user.id, timeEntry.userId))
    .where(where)
    .groupBy(sql.raw("1"));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return bucketKeys(range.from, range.to, bucket, prefs).map(({ key, label }) => ({
    key,
    label,
    billableSeconds: byKey.get(key)?.billableSeconds ?? 0,
    nonBillableSeconds: byKey.get(key)?.nonBillableSeconds ?? 0,
  }));
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
  const totals = await aggregateTotals(db, where);
  const rows = await groupedRows(db, where, eff.groupBy, prefs);
  const { groups } = groupRows(rows, eff.groupBy, totals);
  const bucket = bucketFor(range.from, range.to, prefs.timezone, eff.bucket);
  const series = await seriesRows(db, where, bucket, prefs, range);
  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
    bucket,
    series,
    groupBy: eff.groupBy,
    groups,
    totals,
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
      start: timeEntry.start,
      end: timeEntry.end,
      durationSeconds: timeEntry.durationSeconds,
    })
    .from(timeEntry)
    .leftJoin(project, eq(project.id, timeEntry.projectId))
    .leftJoin(client, eq(client.id, project.clientId))
    .leftJoin(task, eq(task.id, timeEntry.taskId))
    .innerJoin(user, eq(user.id, timeEntry.userId))
    .where(and(...conds))
    .orderBy(order(sortColumn), order(timeEntry.id))
    .limit(limit + 1);
  const pageRows = rows.slice(0, limit);
  const ids = pageRows.map((r) => r.id);
  const tagRows =
    ids.length > 0
      ? await db
          .select({ entryId: timeEntryTag.timeEntryId, id: tag.id, name: tag.name })
          .from(timeEntryTag)
          .innerJoin(tag, eq(tag.id, timeEntryTag.tagId))
          .where(inArray(timeEntryTag.timeEntryId, ids))
      : [];
  const tagsByEntry = new Map<string, { id: string; name: string }[]>();
  for (const t of tagRows) {
    const list = tagsByEntry.get(t.entryId) ?? [];
    list.push({ id: t.id, name: t.name });
    tagsByEntry.set(t.entryId, list);
  }
  const entries: DetailedEntryDTO[] = pageRows.map((r) => {
    const tags = tagsByEntry.get(r.id) ?? [];
    return {
      id: r.id,
      description: r.description,
      projectName: r.projectName ?? null,
      clientName: r.clientName ?? null,
      taskName: r.taskName ?? null,
      userName: r.userName,
      tags: tags.map((t) => t.name),
      billable: r.billable,
      start: r.start.toISOString(),
      end: (r.end ?? r.start).toISOString(),
      durationSeconds: r.durationSeconds ?? 0,
      userId: r.userId,
      projectId: r.projectId,
      projectColor: r.projectColor ?? null,
      taskId: r.taskId,
      tagIds: tags.map((t) => t.id),
      editable: r.userId === viewer.userId,
    };
  });
  const last = pageRows[pageRows.length - 1];
  const nextCursor: DetailedCursor | null =
    rows.length > limit && last
      ? {
          value:
            page.sort === "duration" ? String(last.durationSeconds ?? 0) : last.start.toISOString(),
          id: last.id,
        }
      : null;
  const totals = await aggregateTotals(db, and(...base)!);
  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
    entries,
    nextCursor,
    totals,
  };
}

export async function weeklyReport(
  db: Executor,
  viewer: Viewer,
  query: ReportQuery,
  prefs: ViewerPrefs,
  by: WeeklyBy,
  now: Date = new Date(),
): Promise<WeeklyReport> {
  const eff = effectiveQuery(query, viewer);
  const range = resolveReportRange(eff, prefs, now);
  const tz = prefs.timezone;
  const week = weekBounds(range.from, tz, prefs.weekStart);
  const where = and(...baseConditions(viewer, eff, { from: week.weekStart, to: week.weekEnd }))!;
  const idExpr =
    by === "user" ? sql<string>`${timeEntry.userId}` : sql<string | null>`${timeEntry.projectId}`;
  const labelExpr =
    by === "user"
      ? sql<string>`${user.name}`
      : sql<string>`coalesce(${project.name}, 'No project')`;
  const rows = await db
    .select({ id: idExpr, label: labelExpr, dateKey: dateKeyExpr(tz), seconds: DURATION })
    .from(timeEntry)
    .leftJoin(project, eq(project.id, timeEntry.projectId))
    .leftJoin(client, eq(client.id, project.clientId))
    .leftJoin(task, eq(task.id, timeEntry.taskId))
    .innerJoin(user, eq(user.id, timeEntry.userId))
    .where(where)
    .groupBy(sql.raw("1"), sql.raw("2"), sql.raw("3"));
  const dayKeys = Array.from({ length: 7 }, (_, i) =>
    localDateKey(addDaysInZone(week.weekStart, i, tz), tz),
  );
  const grid = buildWeekly(
    rows.map((r) => ({
      id: r.id === null || r.id === undefined ? null : String(r.id),
      label: String(r.label),
      dateKey: String(r.dateKey),
      seconds: Number(r.seconds),
    })),
    dayKeys,
  );
  return { weekStart: week.weekStart.toISOString(), dayKeys, by, ...grid };
}

/** The filter bar's options, by role: members get no Users filter. */
export async function reportFilterOptions(
  db: Executor,
  viewer: Viewer,
): Promise<ReportFilterOptions> {
  const [members, clients, projects, tags] = await Promise.all([
    canReadTeam(viewer.role)
      ? listMembers(db as Database, viewer.workspaceId)
      : Promise.resolve(null),
    listClientOptions(db, viewer.workspaceId),
    listPickerProjects(db, viewer),
    listTagOptions(db, viewer.workspaceId),
  ]);
  return {
    users: members
      ? members.filter((m) => m.status === "ACTIVE").map((m) => ({ id: m.userId, name: m.name }))
      : null,
    clients: clients.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name })),
    projects,
    tasks: projects.flatMap((p) =>
      p.tasks.map((t) => ({ id: t.id, name: t.name, projectId: p.id })),
    ),
    tags,
  };
}
