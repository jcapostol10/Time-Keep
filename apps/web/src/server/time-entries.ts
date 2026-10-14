import "server-only";

import { randomUUID } from "node:crypto";

import {
  computeDurationSeconds,
  type EntryDetails,
  MAX_ENTRY_SECONDS,
  pickColor,
  TIMER_STOP_FUTURE_GRACE_MS,
  validateEntryRange,
  weekBounds,
  type WeekStartDay,
} from "@timekeep/core";
import {
  and,
  asc,
  type Database,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  type Project,
  project,
  sql,
  type Tag,
  tag,
  type TimeEntry,
  timeEntry,
  timeEntryTag,
} from "@timekeep/db";

import type {
  EntriesPage,
  EntryProject,
  EntryTag,
  RecentDescription,
  TimeEntryDTO,
} from "@/lib/tracker-types";

/**
 * The single write path for time entries. Server actions and route handlers
 * call these db-injected functions after `requireWorkspaceAccess`; later
 * phases hook rate snapshots (4), locks and approvals (5) in here, so nothing
 * else may insert or update `time_entry` rows.
 *
 * Every function is scoped to one (workspace, user): members only ever see
 * and edit their own entries in Phase 1.
 */

export interface EntryScope {
  workspaceId: string;
  userId: string;
}

export class TimeEntryError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "INVALID" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "TimeEntryError";
  }
}

type Executor = Pick<Database, "query" | "select" | "insert" | "update" | "delete" | "execute">;

type EntryRow = TimeEntry & { project: Project | null; tags: { tag: Tag }[] };

const withRelations = { project: true, tags: { with: { tag: true } } } as const;

function scopeWhere(scope: EntryScope) {
  return and(
    eq(timeEntry.workspaceId, scope.workspaceId),
    eq(timeEntry.userId, scope.userId),
    isNull(timeEntry.deletedAt),
  );
}

function toProject(p: Project | null): EntryProject | null {
  return p ? { id: p.id, name: p.name, color: p.color } : null;
}

function toDTO(row: EntryRow): TimeEntryDTO {
  const tags = row.tags
    .map((t): EntryTag => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    id: row.id,
    description: row.description,
    projectId: row.projectId,
    project: toProject(row.project),
    taskId: row.taskId,
    tags,
    tagIds: tags.map((t) => t.id),
    billable: row.billable,
    start: row.start.toISOString(),
    end: row.end ? row.end.toISOString() : null,
    durationSeconds: row.durationSeconds,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadDTO(db: Executor, scope: EntryScope, id: string): Promise<TimeEntryDTO> {
  const row = await db.query.timeEntry.findFirst({
    where: and(eq(timeEntry.id, id), scopeWhere(scope)),
    with: withRelations,
  });
  if (!row) throw new TimeEntryError("NOT_FOUND", "Time entry not found.");
  return toDTO(row);
}

async function findOwned(db: Executor, scope: EntryScope, id: string): Promise<EntryRow> {
  const row = await db.query.timeEntry.findFirst({
    where: and(eq(timeEntry.id, id), scopeWhere(scope)),
    with: withRelations,
  });
  if (!row) throw new TimeEntryError("NOT_FOUND", "Time entry not found.");
  return row;
}

/**
 * Locks an owned row for the rest of the transaction so a concurrent stop or
 * edit cannot interleave between our read and our write.
 */
async function lockOwned(db: Executor, scope: EntryScope, id: string): Promise<void> {
  const [row] = await db
    .select({ id: timeEntry.id })
    .from(timeEntry)
    .where(and(eq(timeEntry.id, id), scopeWhere(scope)))
    .for("update");
  if (!row) throw new TimeEntryError("NOT_FOUND", "Time entry not found.");
}

/** Project and tags must belong to the workspace; anything else is INVALID (never leaks). */
async function assertDetailsBelongToWorkspace(
  db: Executor,
  workspaceId: string,
  details: { projectId?: string | null; tagIds?: string[] },
): Promise<void> {
  if (details.projectId) {
    const found = await db.query.project.findFirst({
      where: and(eq(project.id, details.projectId), eq(project.workspaceId, workspaceId)),
      columns: { id: true },
    });
    if (!found) throw new TimeEntryError("INVALID", "Project not found.");
  }
  const tagIds = [...new Set(details.tagIds ?? [])];
  if (tagIds.length > 0) {
    const found = await db.query.tag.findMany({
      where: and(inArray(tag.id, tagIds), eq(tag.workspaceId, workspaceId)),
      columns: { id: true },
    });
    if (found.length !== tagIds.length) throw new TimeEntryError("INVALID", "Tag not found.");
  }
}

async function replaceTags(db: Executor, entryId: string, tagIds: string[]): Promise<void> {
  await db.delete(timeEntryTag).where(eq(timeEntryTag.timeEntryId, entryId));
  const unique = [...new Set(tagIds)];
  if (unique.length > 0) {
    await db.insert(timeEntryTag).values(unique.map((tagId) => ({ timeEntryId: entryId, tagId })));
  }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  if (typeof cause !== "object" || cause === null) return false;
  const pg = cause as { code?: string; constraint?: string };
  return pg.code === "23505" && pg.constraint === constraint;
}

/** Where a running entry ends when it is stopped implicitly: never before start+1s, never past 999h. */
function implicitStopEnd(start: Date, now: Date): Date {
  const earliest = start.getTime() + 1000;
  const latest = start.getTime() + MAX_ENTRY_SECONDS * 1000;
  return new Date(Math.min(Math.max(now.getTime(), earliest), latest));
}

// --- Reads -----------------------------------------------------------------------

export async function getRunningEntry(
  db: Executor,
  scope: EntryScope,
): Promise<TimeEntryDTO | null> {
  const row = await db.query.timeEntry.findFirst({
    where: and(scopeWhere(scope), isNull(timeEntry.end)),
    with: withRelations,
  });
  return row ? toDTO(row) : null;
}

/**
 * One week of stopped entries in the viewer's timezone. With no `before`, the
 * week containing `now` plus anything dated later; otherwise the week of the newest entry older than
 * `before` (so empty weeks are skipped). The running entry is never included.
 */
export async function listEntriesPage(
  db: Executor,
  scope: EntryScope,
  opts: { before?: Date; tz: string; weekStart: WeekStartDay; now?: Date },
): Promise<EntriesPage> {
  const now = opts.now ?? new Date();
  const stoppedWhere = and(scopeWhere(scope), isNotNull(timeEntry.end));

  let anchor = now;
  if (opts.before) {
    const latest = await db.query.timeEntry.findFirst({
      where: and(stoppedWhere, lt(timeEntry.start, opts.before)),
      orderBy: desc(timeEntry.start),
      columns: { start: true },
    });
    if (!latest) {
      const empty = weekBounds(new Date(opts.before.getTime() - 1), opts.tz, opts.weekStart);
      return {
        weekStart: empty.weekStart.toISOString(),
        weekEnd: empty.weekEnd.toISOString(),
        entries: [],
        nextCursor: null,
      };
    }
    anchor = latest.start;
  }

  const { weekStart, weekEnd } = weekBounds(anchor, opts.tz, opts.weekStart);
  const rows = await db.query.timeEntry.findMany({
    // The first page is open-ended so manual entries dated after this week stay
    // visible (the list shows them as "Upcoming"); older pages are one week each.
    where: and(
      stoppedWhere,
      gte(timeEntry.start, weekStart),
      opts.before ? lt(timeEntry.start, weekEnd) : undefined,
    ),
    orderBy: [desc(timeEntry.start), desc(timeEntry.id)],
    with: withRelations,
  });
  const older = await db.query.timeEntry.findFirst({
    where: and(stoppedWhere, lt(timeEntry.start, weekStart)),
    columns: { id: true },
  });

  return {
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    entries: rows.map(toDTO),
    nextCursor: older ? weekStart.toISOString() : null,
  };
}

/** Distinct recent descriptions with the details of their latest use, newest first. */
export async function listRecentDescriptions(
  db: Executor,
  scope: EntryScope,
  limit = 50,
): Promise<RecentDescription[]> {
  const rows = await db.query.timeEntry.findMany({
    where: and(scopeWhere(scope), isNotNull(timeEntry.end), ne(timeEntry.description, "")),
    orderBy: [desc(timeEntry.start), desc(timeEntry.id)],
    limit: 300,
    with: { tags: { columns: { tagId: true } } },
  });
  const seen = new Set<string>();
  const result: RecentDescription[] = [];
  for (const row of rows) {
    if (seen.has(row.description)) continue;
    seen.add(row.description);
    result.push({
      description: row.description,
      projectId: row.projectId,
      taskId: row.taskId,
      tagIds: row.tags.map((t) => t.tagId).sort(),
      billable: row.billable,
      lastUsedAt: row.start.toISOString(),
    });
    if (result.length >= limit) break;
  }
  return result;
}

// --- Writes ----------------------------------------------------------------------

/**
 * Starts a timer, stopping any running one in the same transaction. The
 * per-user advisory lock serialises concurrent starts; the partial unique
 * index `time_entry_one_running_uq` is the backstop (surfaced as CONFLICT).
 */
export async function startTimer(
  db: Database,
  scope: EntryScope,
  input: EntryDetails,
  now: Date = new Date(),
): Promise<{ started: TimeEntryDTO; stopped: TimeEntryDTO | null }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${scope.workspaceId}:${scope.userId}`}))`,
    );
    await assertDetailsBelongToWorkspace(tx, scope.workspaceId, input);

    const running = await tx.query.timeEntry.findFirst({
      where: and(scopeWhere(scope), isNull(timeEntry.end)),
    });
    let stopped: TimeEntryDTO | null = null;
    if (running) {
      const end = implicitStopEnd(running.start, now);
      await tx
        .update(timeEntry)
        .set({ end, durationSeconds: computeDurationSeconds(running.start, end) })
        .where(eq(timeEntry.id, running.id));
      stopped = await loadDTO(tx, scope, running.id);
    }

    const id = randomUUID();
    try {
      await tx.insert(timeEntry).values({
        id,
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        description: input.description.trim(),
        projectId: input.projectId,
        taskId: input.taskId,
        billable: input.billable,
        start: now,
        end: null,
        durationSeconds: null,
      });
    } catch (error) {
      if (isUniqueViolation(error, "time_entry_one_running_uq")) {
        throw new TimeEntryError("CONFLICT", "A timer is already running.");
      }
      throw error;
    }
    if (input.tagIds.length > 0) await replaceTags(tx, id, input.tagIds);

    return { started: await loadDTO(tx, scope, id), stopped };
  });
}

/** Stops a running entry at `end` (default now). Idempotent for stopped entries. */
export async function stopTimer(
  db: Database,
  scope: EntryScope,
  input: { entryId: string; end?: Date },
  now: Date = new Date(),
): Promise<TimeEntryDTO> {
  return db.transaction(async (tx) => {
    await lockOwned(tx, scope, input.entryId);
    const row = await findOwned(tx, scope, input.entryId);
    if (row.end) return toDTO(row);

    let end = input.end ?? now;
    const max = row.start.getTime() + MAX_ENTRY_SECONDS * 1000;
    if (end.getTime() > max) end = new Date(max); // a forgotten timer must still stop

    const check = validateEntryRange({ start: row.start, end, now, mode: "timer-stop" });
    if (!check.ok) throw new TimeEntryError("INVALID", check.error);

    await tx
      .update(timeEntry)
      .set({ end, durationSeconds: computeDurationSeconds(row.start, end) })
      .where(and(eq(timeEntry.id, row.id), isNull(timeEntry.end)));
    return loadDTO(tx, scope, row.id);
  });
}

export async function createManualEntry(
  db: Database,
  scope: EntryScope,
  input: EntryDetails & { start: Date; end: Date },
  _now: Date = new Date(),
): Promise<TimeEntryDTO> {
  const check = validateEntryRange({
    start: input.start,
    end: input.end,
    now: _now,
    mode: "manual",
  });
  if (!check.ok) throw new TimeEntryError("INVALID", check.error);

  return db.transaction(async (tx) => {
    await assertDetailsBelongToWorkspace(tx, scope.workspaceId, input);
    const id = randomUUID();
    await tx.insert(timeEntry).values({
      id,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      description: input.description.trim(),
      projectId: input.projectId,
      taskId: input.taskId,
      billable: input.billable,
      start: input.start,
      end: input.end,
      durationSeconds: computeDurationSeconds(input.start, input.end),
    });
    if (input.tagIds.length > 0) await replaceTags(tx, id, input.tagIds);
    return loadDTO(tx, scope, id);
  });
}

/**
 * Patches an entry. Setting `end` on a running entry stops it; a running
 * entry's `start` may be moved earlier but not into the future.
 */
export async function updateEntry(
  db: Database,
  scope: EntryScope,
  entryId: string,
  patch: Partial<EntryDetails & { start: Date; end: Date }>,
  now: Date = new Date(),
): Promise<TimeEntryDTO> {
  return db.transaction(async (tx) => {
    await lockOwned(tx, scope, entryId);
    const row = await findOwned(tx, scope, entryId);
    await assertDetailsBelongToWorkspace(tx, scope.workspaceId, patch);

    // Only touch the times when the patch does, so a details edit never
    // rewrites (or un-stops) times changed elsewhere.
    const touchesTimes = patch.start !== undefined || patch.end !== undefined;
    let times: { start: Date; end: Date | null; durationSeconds: number | null } | null = null;
    if (touchesTimes) {
      const start = patch.start ?? row.start;
      const end = patch.end !== undefined ? patch.end : row.end;
      if (end) {
        const check = validateEntryRange({ start, end, now, mode: "manual" });
        if (!check.ok) throw new TimeEntryError("INVALID", check.error);
        times = { start, end, durationSeconds: computeDurationSeconds(start, end) };
      } else {
        if (start.getTime() > now.getTime() + TIMER_STOP_FUTURE_GRACE_MS) {
          throw new TimeEntryError("INVALID", "A running timer cannot start in the future.");
        }
        times = { start, end: null, durationSeconds: null };
      }
    }

    await tx
      .update(timeEntry)
      .set({
        ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
        ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
        ...(patch.taskId !== undefined ? { taskId: patch.taskId } : {}),
        ...(patch.billable !== undefined ? { billable: patch.billable } : {}),
        ...(times ?? {}),
      })
      .where(eq(timeEntry.id, row.id));
    if (patch.tagIds !== undefined) await replaceTags(tx, row.id, patch.tagIds);

    return loadDTO(tx, scope, row.id);
  });
}

/** Soft-deletes stopped entries in scope; ids that don't match are ignored. */
export async function deleteEntries(
  db: Executor,
  scope: EntryScope,
  ids: string[],
): Promise<{ deleted: string[] }> {
  if (ids.length === 0) return { deleted: [] };
  const rows = await db
    .update(timeEntry)
    .set({ deletedAt: new Date() })
    .where(and(inArray(timeEntry.id, ids), scopeWhere(scope), isNotNull(timeEntry.end)))
    .returning({ id: timeEntry.id });
  return { deleted: rows.map((r) => r.id) };
}

export async function restoreEntries(
  db: Executor,
  scope: EntryScope,
  ids: string[],
): Promise<{ restored: string[] }> {
  if (ids.length === 0) return { restored: [] };
  const rows = await db
    .update(timeEntry)
    .set({ deletedAt: null })
    .where(
      and(
        inArray(timeEntry.id, ids),
        eq(timeEntry.workspaceId, scope.workspaceId),
        eq(timeEntry.userId, scope.userId),
        isNotNull(timeEntry.deletedAt),
      ),
    )
    .returning({ id: timeEntry.id });
  return { restored: rows.map((r) => r.id) };
}

/** Copies a stopped entry (same times and details) under a new id. */
export async function duplicateEntry(
  db: Database,
  scope: EntryScope,
  entryId: string,
): Promise<TimeEntryDTO> {
  return db.transaction(async (tx) => {
    const row = await findOwned(tx, scope, entryId);
    if (!row.end) throw new TimeEntryError("INVALID", "Stop the timer before duplicating it.");
    const id = randomUUID();
    await tx.insert(timeEntry).values({
      id,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      description: row.description,
      projectId: row.projectId,
      taskId: row.taskId,
      billable: row.billable,
      start: row.start,
      end: row.end,
      durationSeconds: row.durationSeconds,
    });
    const tagIds = row.tags.map((t) => t.tag.id);
    if (tagIds.length > 0) await replaceTags(tx, id, tagIds);
    return loadDTO(tx, scope, id);
  });
}

/** "Continue": start a new timer with the entry's description, project, task, tags and billable flag. */
export async function continueEntry(
  db: Database,
  scope: EntryScope,
  entryId: string,
  now: Date = new Date(),
): Promise<{ started: TimeEntryDTO; stopped: TimeEntryDTO | null }> {
  const row = await findOwned(db, scope, entryId);
  return startTimer(
    db,
    scope,
    {
      description: row.description,
      projectId: row.projectId,
      taskId: row.taskId,
      tagIds: row.tags.map((t) => t.tag.id),
      billable: row.billable,
    },
    now,
  );
}

// --- Project / tag stubs (Phase 2 replaces these) ----------------------------------

export async function listProjects(db: Executor, workspaceId: string): Promise<EntryProject[]> {
  return db
    .select({ id: project.id, name: project.name, color: project.color })
    .from(project)
    .where(eq(project.workspaceId, workspaceId))
    .orderBy(asc(project.name));
}

/** Find-or-create by name (unique per workspace). */
export async function createProject(
  db: Executor,
  workspaceId: string,
  input: { name: string; color?: string },
): Promise<EntryProject> {
  const name = input.name.trim();
  await db
    .insert(project)
    .values({ id: randomUUID(), workspaceId, name, color: input.color ?? pickColor(name) })
    .onConflictDoNothing({ target: [project.workspaceId, project.name] });
  const row = await db.query.project.findFirst({
    where: and(eq(project.workspaceId, workspaceId), eq(project.name, name)),
  });
  if (!row) throw new Error("Project could not be created");
  return { id: row.id, name: row.name, color: row.color };
}

export async function listTags(db: Executor, workspaceId: string): Promise<EntryTag[]> {
  return db
    .select({ id: tag.id, name: tag.name, color: tag.color })
    .from(tag)
    .where(eq(tag.workspaceId, workspaceId))
    .orderBy(asc(tag.name));
}

export async function createTag(
  db: Executor,
  workspaceId: string,
  input: { name: string; color?: string },
): Promise<EntryTag> {
  const name = input.name.trim();
  await db
    .insert(tag)
    .values({ id: randomUUID(), workspaceId, name, color: input.color ?? pickColor(name) })
    .onConflictDoNothing({ target: [tag.workspaceId, tag.name] });
  const row = await db.query.tag.findFirst({
    where: and(eq(tag.workspaceId, workspaceId), eq(tag.name, name)),
  });
  if (!row) throw new Error("Tag could not be created");
  return { id: row.id, name: row.name, color: row.color };
}
