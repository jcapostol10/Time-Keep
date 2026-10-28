import "server-only";

import { randomUUID } from "node:crypto";

import {
  type Actor,
  type BulkEntryPatch,
  can,
  computeDurationSeconds,
  type EntryDetails,
  entryRulesOf,
  MAX_ENTRY_SECONDS,
  missingRequiredField,
  needsRerate,
  type RequiredField,
  requiredFieldMessage,
  TIMER_STOP_FUTURE_GRACE_MS,
  trackingBlock,
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
  rateEntriesSql,
  rateEntry,
  recomputeAmount,
  sql,
  tag,
  type Tag,
  task,
  timeEntry,
  type TimeEntry,
  timeEntryTag,
  workspaceSettings,
} from "@timekeep/db";

import type {
  EntriesPage,
  EntryProject,
  EntryTag,
  RecentDescription,
  TimeEntryDTO,
} from "@/lib/tracker-types";

import { CatalogError } from "./catalog/errors";
import type { Viewer } from "./catalog/viewer";
import { assertCan, projectResource, scopeForUser } from "./authz";

/**
 * The single write path for time entries. Server actions and route handlers
 * call these db-injected functions after `requireWorkspaceAccess`; later
 * phases hook rate snapshots (4), locks and approvals (5) in here, so nothing
 * else may insert or update `time_entry` rows.
 *
 * Every function is scoped to one (workspace, user): members only ever see
 * and edit their own entries until Phase 4. The role decides which projects
 * the user may put time on (private projects need membership).
 */

/**
 * The person whose entries are read and written, with their role and scope.
 * `actedBy` is the admin or manager acting for them (add time for others);
 * the force-timer gate reads it, so time added for someone else is exempt.
 */
export type EntryScope = Viewer & { actedBy?: Actor };

/** New-entry details; the type defaults to work (the schemas default it too). */
export type EntryInput = Omit<EntryDetails, "type"> & { type?: EntryDetails["type"] };

export class TimeEntryError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "INVALID" | "CONFLICT",
    message: string,
    /** The required field the entry lacks, for the UI to mark. */
    public readonly field?: RequiredField,
  ) {
    super(message);
    this.name = "TimeEntryError";
  }
}

type Executor = Pick<Database, "query" | "select" | "insert" | "update" | "delete" | "execute">;

type EntryRow = TimeEntry & {
  project: (Project & { client: { name: string } | null }) | null;
  task: { id: string; name: string } | null;
  tags: { tag: Tag }[];
};

const withRelations = {
  project: { with: { client: { columns: { name: true } } } },
  task: { columns: { id: true, name: true } },
  tags: { with: { tag: true } },
} as const;

function scopeWhere(scope: EntryScope) {
  return and(
    eq(timeEntry.workspaceId, scope.workspaceId),
    eq(timeEntry.userId, scope.userId),
    isNull(timeEntry.deletedAt),
  );
}

function toProject(p: EntryRow["project"]): EntryProject | null {
  return p ? { id: p.id, name: p.name, color: p.color, clientName: p.client?.name ?? null } : null;
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
    task: row.task ? { id: row.task.id, name: row.task.name } : null,
    tags,
    tagIds: tags.map((t) => t.id),
    billable: row.billable,
    type: row.type,
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

/**
 * The details new time is recorded with must be usable: the project exists
 * in the workspace, is visible to the user (a private project they are not
 * on is "not found", never "forbidden") and is not archived; the task belongs
 * to the project and is active; the tags are not archived. For a patch, only
 * the parts that change are checked, against the entry's current details: the
 * dialogs send every field, and an unchanged project, task or tag set must not
 * be re-checked as though it were being assigned now (archived, visibility).
 */
async function assertDetailsUsable(
  db: Executor,
  scope: EntryScope,
  details: { projectId?: string | null; taskId?: string | null; tagIds?: string[] },
  current?: { projectId: string | null; taskId: string | null; tagIds: string[] },
): Promise<void> {
  const projectTouched =
    details.projectId !== undefined && (!current || details.projectId !== current.projectId);
  const taskTouched =
    details.taskId !== undefined && (!current || details.taskId !== current.taskId);
  const tagsTouched =
    details.tagIds !== undefined && (!current || !sameIdSet(details.tagIds, current.tagIds));
  if (!projectTouched && !taskTouched && !tagsTouched) return;

  const projectId = projectTouched ? details.projectId : (current?.projectId ?? null);
  const taskId = taskTouched ? details.taskId : (current?.taskId ?? null);

  let projectRow: { id: string; archived: boolean; isTemplate?: boolean } | null = null;
  if (projectId) {
    const found = await db.query.project.findFirst({
      where: and(eq(project.id, projectId), eq(project.workspaceId, scope.workspaceId)),
      columns: { id: true, archived: true, isTemplate: true },
    });
    const visible =
      found && can(scope.actor, "project.view", await projectResource(db, scope, projectId));
    if (!found) throw new TimeEntryError("INVALID", "Project not found.");
    // Visibility is a condition for assigning a project; an entry already on a
    // private project the user has since left keeps it (they can still retag it).
    if (projectTouched && !visible) throw new TimeEntryError("INVALID", "Project not found.");
    // Archived blocks only when the project itself is being (re)assigned.
    projectRow = {
      id: found.id,
      archived: projectTouched ? found.archived : false,
      isTemplate: projectTouched ? found.isTemplate : false,
    };
  }

  let taskRow: { projectId: string; status: "ACTIVE" | "DONE" } | null = null;
  if (taskId && (taskTouched || projectTouched)) {
    const found = await db.query.task.findFirst({
      where: and(eq(task.id, taskId), eq(task.workspaceId, scope.workspaceId)),
      columns: { projectId: true, status: true },
    });
    if (!found) throw new TimeEntryError("INVALID", "Task not found.");
    taskRow = found;
  }

  // Tags already on the entry may stay (an archived tag is only blocked from being added).
  let addedTags: { name: string; archived: boolean }[] = [];
  if (tagsTouched) {
    const tagIds = [...new Set(details.tagIds ?? [])];
    if (tagIds.length > 0) {
      const tagRows = await db.query.tag.findMany({
        where: and(inArray(tag.id, tagIds), eq(tag.workspaceId, scope.workspaceId)),
        columns: { id: true, name: true, archived: true },
      });
      if (tagRows.length !== tagIds.length) throw new TimeEntryError("INVALID", "Tag not found.");
      const alreadyOn = new Set(current?.tagIds ?? []);
      addedTags = tagRows.filter((t) => !alreadyOn.has(t.id));
    }
  }

  const block = trackingBlock({ project: projectRow, task: taskRow, tags: addedTags });
  if (block) throw new TimeEntryError("INVALID", block);
}

function sameIdSet(a: string[], b: string[]): boolean {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((id, i) => id === y[i]);
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

/** Who acts: the scope's own actor, or the person acting for them. */
function actorOf(scope: EntryScope): Actor {
  return scope.actedBy ?? scope.actor;
}

/** Decision 7: manual times need `entry.writeTimes` (force timer exempts admins and time for others). */
function assertCanWriteTimes(scope: EntryScope, projectId: string | null): void {
  assertCan(actorOf(scope), "entry.writeTimes", { kind: "entry", userId: scope.userId, projectId });
}

/** Decision 6: a break carries no details, and only where the workspace allows breaks. */
async function breakAware<T extends EntryInput>(
  db: Executor,
  scope: EntryScope,
  input: T,
): Promise<T & { type: EntryDetails["type"] }> {
  const type = input.type ?? "work";
  if (type === "work") return { ...input, type };
  const { allowBreaks } = await rulesOf(db, scope.workspaceId);
  if (!allowBreaks) throw new TimeEntryError("INVALID", "Breaks are not enabled.");
  return { ...input, type, projectId: null, taskId: null, tagIds: [], billable: false };
}

function wantsDetails(patch: Partial<EntryDetails>): boolean {
  return (
    (patch.projectId !== undefined && patch.projectId !== null) ||
    (patch.taskId !== undefined && patch.taskId !== null) ||
    (patch.tagIds !== undefined && patch.tagIds.length > 0) ||
    patch.billable === true
  );
}

async function rulesOf(db: Executor, workspaceId: string) {
  const [row] = await db
    .select({
      requiredFields: workspaceSettings.requiredFields,
      allowBreaks: workspaceSettings.allowBreaks,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId));
  return entryRulesOf(row ?? { requiredFields: [], allowBreaks: false });
}

/**
 * Decision 5: the workspace's required fields bind when an entry is stopped
 * or saved. A task is required only when the project has active tasks;
 * breaks are exempt. Throws with the field named, so the UI can mark it.
 */
async function assertRequiredFields(
  db: Executor,
  scope: EntryScope,
  details: {
    description: string;
    projectId: string | null;
    taskId: string | null;
    tagIds: readonly string[];
    type: EntryDetails["type"];
  },
): Promise<void> {
  const { requiredFields } = await rulesOf(db, scope.workspaceId);
  if (requiredFields.length === 0) return;
  let projectHasTasks = false;
  if (requiredFields.includes("task") && details.projectId) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(task)
      .where(and(eq(task.projectId, details.projectId), eq(task.status, "ACTIVE")));
    projectHasTasks = (row?.n ?? 0) > 0;
  }
  const missing = missingRequiredField(requiredFields, details, { projectHasTasks });
  if (missing) throw new TimeEntryError("INVALID", requiredFieldMessage(missing), missing);
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
  input: EntryInput,
  now: Date = new Date(),
): Promise<{ started: TimeEntryDTO; stopped: TimeEntryDTO | null }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${scope.workspaceId}:${scope.userId}`}))`,
    );
    const details = await breakAware(tx, scope, input);
    await assertDetailsUsable(tx, scope, details);

    const running = await tx.query.timeEntry.findFirst({
      where: and(scopeWhere(scope), isNull(timeEntry.end)),
      with: { tags: true },
    });
    let stopped: TimeEntryDTO | null = null;
    if (running) {
      // The implicit stop is a stop (decision 5): a favourite, Continue or S cannot skip the rule.
      await assertRequiredFields(tx, scope, {
        description: running.description,
        projectId: running.projectId,
        taskId: running.taskId,
        tagIds: running.tags.map((t) => t.tagId),
        type: running.type,
      });
      const end = implicitStopEnd(running.start, now);
      await tx
        .update(timeEntry)
        .set({ end, durationSeconds: computeDurationSeconds(running.start, end) })
        .where(eq(timeEntry.id, running.id));
      await recomputeAmount(tx, running.id);
      stopped = await loadDTO(tx, scope, running.id);
    }

    const id = randomUUID();
    try {
      await tx.insert(timeEntry).values({
        id,
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        description: details.description.trim(),
        projectId: details.projectId,
        taskId: details.taskId,
        billable: details.billable,
        type: details.type,
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
    if (details.tagIds.length > 0) await replaceTags(tx, id, details.tagIds);
    await rateEntry(tx, id);

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
    await assertRequiredFields(tx, scope, {
      description: row.description,
      projectId: row.projectId,
      taskId: row.taskId,
      tagIds: row.tags.map((t) => t.tag.id),
      type: row.type,
    });

    let end = input.end ?? now;
    const max = row.start.getTime() + MAX_ENTRY_SECONDS * 1000;
    if (end.getTime() > max) end = new Date(max); // a forgotten timer must still stop

    const check = validateEntryRange({ start: row.start, end, now, mode: "timer-stop" });
    if (!check.ok) throw new TimeEntryError("INVALID", check.error);

    await tx
      .update(timeEntry)
      .set({ end, durationSeconds: computeDurationSeconds(row.start, end) })
      .where(and(eq(timeEntry.id, row.id), isNull(timeEntry.end)));
    await recomputeAmount(tx, row.id);
    return loadDTO(tx, scope, row.id);
  });
}

export async function createManualEntry(
  db: Database,
  scope: EntryScope,
  input: EntryInput & { start: Date; end: Date },
  _now: Date = new Date(),
): Promise<TimeEntryDTO> {
  assertCanWriteTimes(scope, input.projectId);
  const check = validateEntryRange({
    start: input.start,
    end: input.end,
    now: _now,
    mode: "manual",
  });
  if (!check.ok) throw new TimeEntryError("INVALID", check.error);

  return db.transaction(async (tx) => {
    const details = await breakAware(tx, scope, input);
    await assertDetailsUsable(tx, scope, details);
    await assertRequiredFields(tx, scope, details);
    const id = randomUUID();
    await tx.insert(timeEntry).values({
      id,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      description: details.description.trim(),
      projectId: details.projectId,
      taskId: details.taskId,
      billable: details.billable,
      type: details.type,
      start: input.start,
      end: input.end,
      durationSeconds: computeDurationSeconds(input.start, input.end),
    });
    if (details.tagIds.length > 0) await replaceTags(tx, id, details.tagIds);
    await rateEntry(tx, id);
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
    if (patch.start !== undefined || patch.end !== undefined) {
      assertCanWriteTimes(scope, row.projectId);
    }
    if (row.type === "break" && wantsDetails(patch)) {
      throw new TimeEntryError("INVALID", "A break has no project, tags or billing.");
    }
    await assertDetailsUsable(tx, scope, patch, {
      projectId: row.projectId,
      taskId: row.taskId,
      tagIds: row.tags.map((t) => t.tag.id),
    });

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

    // The entry as it will be after the patch; a stopped entry must still meet the rules.
    const merged = {
      description: patch.description ?? row.description,
      projectId: patch.projectId !== undefined ? patch.projectId : row.projectId,
      taskId: patch.taskId !== undefined ? patch.taskId : row.taskId,
      tagIds: patch.tagIds ?? row.tags.map((t) => t.tag.id),
      type: row.type,
    };
    if (times ? times.end : row.end) await assertRequiredFields(tx, scope, merged);

    // updatedAt is always set, so a tags-only patch is still a valid UPDATE.
    await tx
      .update(timeEntry)
      .set({
        updatedAt: now,
        ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
        ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
        ...(patch.taskId !== undefined ? { taskId: patch.taskId } : {}),
        ...(patch.billable !== undefined ? { billable: patch.billable } : {}),
        ...(times ?? {}),
      })
      .where(eq(timeEntry.id, row.id));
    if (patch.tagIds !== undefined) await replaceTags(tx, row.id, patch.tagIds);

    // Decision 3 of the Phase 4 design: an edit keeps the entry's rate unless
    // it changes what decides the rate; a new duration only recomputes the amount.
    const rerate = needsRerate(
      { userId: row.userId, projectId: row.projectId, taskId: row.taskId, billable: row.billable },
      {
        userId: row.userId,
        projectId: patch.projectId !== undefined ? patch.projectId : row.projectId,
        taskId: patch.taskId !== undefined ? patch.taskId : row.taskId,
        billable: patch.billable ?? row.billable,
      },
    );
    if (rerate) await rateEntry(tx, row.id);
    else if (touchesTimes) await recomputeAmount(tx, row.id);

    return loadDTO(tx, scope, row.id);
  });
}

/**
 * Many stopped entries at once (the CSV import): the checks of
 * `createManualEntry`, once per distinct set of details, then one insert and
 * one rating pass; a failure rolls back with the caller's transaction.
 */
export async function createManualEntries(
  db: Executor,
  scope: EntryScope,
  inputs: (EntryInput & { start: Date; end: Date })[],
  now: Date = new Date(),
): Promise<{ ids: string[] }> {
  if (inputs.length === 0) return { ids: [] };
  assertCanWriteTimes(scope, null);
  const checked = new Map<string, EntryInput & { type: EntryDetails["type"] }>();
  const rows: (typeof timeEntry.$inferInsert)[] = [];
  const tagRows: { timeEntryId: string; tagId: string }[] = [];
  for (const input of inputs) {
    const range = validateEntryRange({ start: input.start, end: input.end, now, mode: "manual" });
    if (!range.ok) throw new TimeEntryError("INVALID", range.error);
    const key = JSON.stringify([
      input.projectId,
      input.taskId,
      [...new Set(input.tagIds)].sort(),
      input.billable,
      input.type ?? "work",
      input.description.trim() === "",
    ]);
    let details = checked.get(key);
    if (!details) {
      details = await breakAware(db, scope, input);
      await assertDetailsUsable(db, scope, details);
      await assertRequiredFields(db, scope, details);
      checked.set(key, details);
    }
    const id = randomUUID();
    rows.push({
      id,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      description: input.description.trim(),
      projectId: details.projectId,
      taskId: details.taskId,
      billable: details.billable,
      type: details.type,
      start: input.start,
      end: input.end,
      durationSeconds: computeDurationSeconds(input.start, input.end),
    });
    for (const tagId of new Set(details.tagIds)) tagRows.push({ timeEntryId: id, tagId });
  }
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(timeEntry).values(rows.slice(i, i + 500));
  }
  for (let i = 0; i < tagRows.length; i += 1000) {
    await db.insert(timeEntryTag).values(tagRows.slice(i, i + 1000));
  }
  const ids = rows.map((r) => r.id!);
  for (let i = 0; i < ids.length; i += 1000) {
    await db.execute(rateEntriesSql(inArray(timeEntry.id, ids.slice(i, i + 1000))));
  }
  return { ids };
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
    assertCanWriteTimes(scope, row.projectId);
    await assertDetailsUsable(tx, scope, {
      projectId: row.projectId,
      taskId: row.taskId,
      tagIds: row.tags.map((t) => t.tag.id),
    });
    const id = randomUUID();
    await tx.insert(timeEntry).values({
      id,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      description: row.description,
      projectId: row.projectId,
      taskId: row.taskId,
      billable: row.billable,
      type: row.type,
      start: row.start,
      end: row.end,
      durationSeconds: row.durationSeconds,
    });
    const tagIds = row.tags.map((t) => t.tag.id);
    if (tagIds.length > 0) await replaceTags(tx, id, tagIds);
    // A copy keeps the original's times, so it takes the rates in force at that start.
    await rateEntry(tx, id);
    return loadDTO(tx, scope, id);
  });
}

/**
 * Split: `[start, at)` stays on the entry and `[at, end)` becomes a new one
 * with the same details, tags and rate snapshot (a split is an edit of
 * times, so it keeps the rate); each part lasts at least a second.
 */
export async function splitEntry(
  db: Database,
  scope: EntryScope,
  entryId: string,
  at: Date,
  now: Date = new Date(),
): Promise<{ first: TimeEntryDTO; second: TimeEntryDTO }> {
  return db.transaction(async (tx) => {
    await lockOwned(tx, scope, entryId);
    const row = await findOwned(tx, scope, entryId);
    if (!row.end) throw new TimeEntryError("INVALID", "Stop the timer before splitting it.");
    assertCanWriteTimes(scope, row.projectId);
    if (at.getTime() < row.start.getTime() + 1000 || at.getTime() > row.end.getTime() - 1000) {
      throw new TimeEntryError("INVALID", "Pick a time inside the entry.");
    }
    await tx
      .update(timeEntry)
      .set({ end: at, durationSeconds: computeDurationSeconds(row.start, at), updatedAt: now })
      .where(eq(timeEntry.id, row.id));
    await recomputeAmount(tx, row.id);
    const id = randomUUID();
    await tx.insert(timeEntry).values({
      id,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      description: row.description,
      projectId: row.projectId,
      taskId: row.taskId,
      billable: row.billable,
      type: row.type,
      start: at,
      end: row.end,
      durationSeconds: computeDurationSeconds(at, row.end),
      billableRateMinor: row.billableRateMinor,
      rateCurrency: row.rateCurrency,
      rateSource: row.rateSource,
    });
    const tagIds = row.tags.map((t) => t.tag.id);
    if (tagIds.length > 0) await replaceTags(tx, id, tagIds);
    await recomputeAmount(tx, id);
    return { first: await loadDTO(tx, scope, row.id), second: await loadDTO(tx, scope, id) };
  });
}


/**
 * "Continue": start a new timer with the entry's description, project, task,
 * tags and billable flag. The timer is `startFor`'s (the caller's own, decision
 * 8); the entry may be someone else's the caller may write for.
 */
export async function continueEntry(
  db: Database,
  scope: EntryScope,
  entryId: string,
  now: Date = new Date(),
  startFor: EntryScope = scope,
): Promise<{ started: TimeEntryDTO; stopped: TimeEntryDTO | null }> {
  const row = await findOwned(db, scope, entryId);
  return startTimer(
    db,
    startFor,
    {
      description: row.description,
      projectId: row.projectId,
      taskId: row.taskId,
      tagIds: row.tags.map((t) => t.tag.id),
      billable: row.billable,
      type: row.type,
    },
    now,
  );
}

/**
 * The scopes for id-based writes (add time for others): the entries' owners,
 * each through `scopeForUser`, so an id of someone outside the viewer's
 * people is not found. Unknown ids are dropped, as `deleteEntries` ignores them.
 */
export async function scopesForEntries(
  db: Executor,
  viewer: Viewer,
  ids: string[],
  opts: { includeDeleted?: boolean } = {},
): Promise<{ scope: EntryScope; ids: string[] }[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: timeEntry.id, userId: timeEntry.userId })
    .from(timeEntry)
    .where(
      and(
        inArray(timeEntry.id, ids),
        eq(timeEntry.workspaceId, viewer.workspaceId),
        opts.includeDeleted ? undefined : isNull(timeEntry.deletedAt),
      ),
    );
  const byOwner = new Map<string, string[]>();
  for (const r of rows) byOwner.set(r.userId, [...(byOwner.get(r.userId) ?? []), r.id]);
  const groups: { scope: EntryScope; ids: string[] }[] = [];
  for (const [userId, owned] of byOwner) {
    groups.push({ scope: await scopeForUser(db, viewer, userId), ids: owned });
  }
  return groups;
}

function applyTagMode(current: string[], tags: NonNullable<BulkEntryPatch["tags"]>): string[] {
  switch (tags.mode) {
    case "add":
      return [...new Set([...current, ...tags.tagIds])];
    case "replace":
      return [...new Set(tags.tagIds)];
    case "remove":
      return current.filter((id) => !tags.tagIds.includes(id));
  }
}

/** One entry of a bulk edit: the same checks and rating rule as `updateEntry`, times untouched. */
async function applyBulkPatch(
  tx: Executor,
  scope: EntryScope,
  entryId: string,
  patch: BulkEntryPatch,
  now: Date,
): Promise<TimeEntryDTO> {
  await lockOwned(tx, scope, entryId);
  const row = await findOwned(tx, scope, entryId);
  const currentTags = row.tags.map((t) => t.tag.id);
  // A new project clears the task unless the patch names one.
  const details: Partial<EntryDetails> = {
    ...(patch.projectId !== undefined
      ? { projectId: patch.projectId, taskId: patch.taskId ?? null }
      : patch.taskId !== undefined
        ? { taskId: patch.taskId }
        : {}),
    ...(patch.tags ? { tagIds: applyTagMode(currentTags, patch.tags) } : {}),
    ...(patch.billable !== undefined ? { billable: patch.billable } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
  };
  if (row.type === "break" && wantsDetails(details)) {
    throw new TimeEntryError("INVALID", "A break has no project, tags or billing.");
  }
  await assertDetailsUsable(tx, scope, details, {
    projectId: row.projectId,
    taskId: row.taskId,
    tagIds: currentTags,
  });
  const merged = {
    description: details.description ?? row.description,
    projectId: details.projectId !== undefined ? details.projectId : row.projectId,
    taskId: details.taskId !== undefined ? details.taskId : row.taskId,
    tagIds: details.tagIds ?? currentTags,
    type: row.type,
  };
  if (row.end) await assertRequiredFields(tx, scope, merged);
  await tx
    .update(timeEntry)
    .set({
      updatedAt: now,
      ...(details.description !== undefined ? { description: details.description.trim() } : {}),
      ...(details.projectId !== undefined ? { projectId: details.projectId } : {}),
      ...(details.taskId !== undefined ? { taskId: details.taskId } : {}),
      ...(details.billable !== undefined ? { billable: details.billable } : {}),
    })
    .where(eq(timeEntry.id, row.id));
  if (details.tagIds !== undefined) await replaceTags(tx, row.id, details.tagIds);
  const rerate = needsRerate(
    { userId: row.userId, projectId: row.projectId, taskId: row.taskId, billable: row.billable },
    {
      userId: row.userId,
      projectId: merged.projectId,
      taskId: merged.taskId,
      billable: details.billable ?? row.billable,
    },
  );
  if (rerate) await rateEntry(tx, row.id);
  return loadDTO(tx, scope, row.id);
}

/**
 * Bulk edit: every selected entry (grouped by owner through `scopesForEntries`)
 * is checked and patched in one transaction; one failure rolls everything
 * back, and the error says how many failed and why the first did.
 */
export async function bulkUpdateEntries(
  db: Database,
  groups: { scope: EntryScope; ids: string[] }[],
  patch: BulkEntryPatch,
  now: Date = new Date(),
): Promise<{ updated: TimeEntryDTO[] }> {
  const total = groups.reduce((n, g) => n + g.ids.length, 0);
  return db.transaction(async (tx) => {
    const failures: string[] = [];
    const updated: TimeEntryDTO[] = [];
    for (const { scope, ids } of groups) {
      for (const id of ids) {
        try {
          updated.push(await applyBulkPatch(tx, scope, id, patch, now));
        } catch (error) {
          if (!(error instanceof TimeEntryError)) throw error;
          failures.push(error.message);
        }
      }
    }
    if (failures.length > 0) {
      throw new TimeEntryError(
        "INVALID",
        `${failures.length} of ${total} entries could not be updated: ${failures[0]}`,
      );
    }
    return { updated };
  });
}

// --- Range reads and project-wide operations ----------------------------------------

/** The caller's stopped entries starting in `[from, to)`, oldest first. */
export async function listEntriesInRange(
  db: Executor,
  scope: EntryScope,
  range: { from: Date; to: Date },
): Promise<TimeEntryDTO[]> {
  const rows = await db.query.timeEntry.findMany({
    where: and(
      scopeWhere(scope),
      isNotNull(timeEntry.end),
      gte(timeEntry.start, range.from),
      lt(timeEntry.start, range.to),
    ),
    orderBy: [asc(timeEntry.start), asc(timeEntry.id)],
    with: withRelations,
  });
  return rows.map(toDTO);
}

function projectEntriesWhere(workspaceId: string, projectId: string) {
  return and(
    eq(timeEntry.workspaceId, workspaceId),
    eq(timeEntry.projectId, projectId),
    isNull(timeEntry.deletedAt),
  );
}

/** Live entries (any user) on a project; the delete-project dialog shows it. */
export async function countProjectEntries(
  db: Executor,
  workspaceId: string,
  projectId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(timeEntry)
    .where(projectEntriesWhere(workspaceId, projectId));
  return row?.n ?? 0;
}

/**
 * Moves every live entry on `fromProjectId` (any user) to `toProjectId` or
 * to no project. Tasks belong to a project, so they are cleared. Admin-only;
 * the caller checks the role and that the target is usable.
 */
export async function reassignProjectEntries(
  db: Executor,
  workspaceId: string,
  fromProjectId: string,
  toProjectId: string | null,
): Promise<number> {
  const rows = await db
    .update(timeEntry)
    .set({ projectId: toProjectId, taskId: null })
    .where(projectEntriesWhere(workspaceId, fromProjectId))
    .returning({ id: timeEntry.id });
  // A new project decides a new rate.
  if (rows.length > 0) {
    await db.execute(
      rateEntriesSql(
        inArray(
          timeEntry.id,
          rows.map((r) => r.id),
        ),
      ),
    );
  }
  return rows.length;
}

/** Soft-deletes every live entry on a project (any user). Admin-only; no undo. */
export async function softDeleteProjectEntries(
  db: Executor,
  workspaceId: string,
  projectId: string,
): Promise<number> {
  const rows = await db
    .update(timeEntry)
    .set({ deletedAt: new Date() })
    .where(projectEntriesWhere(workspaceId, projectId))
    .returning({ id: timeEntry.id });
  return rows.length;
}

export { CatalogError };
