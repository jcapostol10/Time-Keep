import "server-only";

import { randomUUID } from "node:crypto";

import {
  approvalRulesOf,
  can,
  formatDateKey,
  localDateKey,
  lockBoundary,
  lockDateKey,
  type LockRule,
} from "@timekeep/core";
import {
  and,
  approvalEvent,
  approvalRequest,
  type DbExecutor,
  eq,
  gte,
  inArray,
  lte,
  workspaceSettings,
} from "@timekeep/db";

import type { EntryScope } from "./time-entries";
import { TimeEntryError } from "./entry-error";
import { timerLock } from "./person-lock";

/**
 * The write guard of Phase 5a (decisions 5 and 6), called by every write path
 * in `time-entries.ts` and nowhere else (`writable-coverage.test.ts`):
 *
 * - A lock date refuses members' and managers' writes to entries starting
 *   before it, whether the start is the entry's before or after the change.
 *   Owners and admins are never locked.
 * - A PENDING or APPROVED period is read-only for its owner and managers.
 *   Owners and admins change it only with a note, logged as ADMIN_EDIT.
 *   The lookup does not read `approval_enabled`: approved periods stay
 *   read-only after approval is turned off (pending ones are withdrawn then).
 *
 * Stopping a running timer is never guarded.
 */

export interface WriteChange {
  entryId?: string;
  /** The entry's start before the change (absent for a new entry). */
  before?: Date;
  /** The entry's start after the change (absent for a delete). */
  after?: Date;
  /** `{ field: { from, to } }` for the log. */
  changes?: Record<string, { from: unknown; to: unknown }>;
}

export interface WriteRules {
  timezone: string;
  lock: LockRule;
}

export async function writeRulesOf(
  db: Pick<DbExecutor, "select">,
  workspaceId: string,
): Promise<WriteRules> {
  const [row] = await db
    .select({
      timezone: workspaceSettings.timezone,
      weekStart: workspaceSettings.weekStart,
      approvalEnabled: workspaceSettings.approvalEnabled,
      approvalPeriod: workspaceSettings.approvalPeriod,
      lockMode: workspaceSettings.lockMode,
      lockDate: workspaceSettings.lockDate,
      lockDays: workspaceSettings.lockDays,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId));
  const timezone = row?.timezone ?? "UTC";
  const rules = approvalRulesOf(
    row ?? {
      approvalEnabled: false,
      approvalPeriod: "WEEKLY",
      lockMode: "OFF",
      lockDate: null,
      lockDays: null,
    },
    { timezone, weekStart: row?.weekStart ?? 1 },
  );
  return { timezone, lock: rules.lock };
}

export const PENDING_MESSAGE = "This period is submitted for approval.";
export const APPROVED_MESSAGE = "This period is approved.";
export const NOTE_REQUIRED_MESSAGE = "Say why you are changing submitted time.";

/** The lock line the tracker, timesheet and calendar show (spec Part 2); null when none binds. */
export async function lockNoticeFor(
  db: Pick<DbExecutor, "select">,
  scope: EntryScope,
  now: Date = new Date(),
): Promise<string | null> {
  const actor = scope.actedBy ?? scope.actor;
  if (can(actor, "approval.editLocked", { kind: "none" })) return null;
  const rules = await writeRulesOf(db, scope.workspaceId);
  const key = lockDateKey(rules.lock, now);
  return key ? `Entries before ${formatDateKey(key)} are locked.` : null;
}

/**
 * Why the scope's actor may not change each entry, for the editor's reads
 * (rows and cells shown read-only): the lock date, or a submitted period.
 * Owners and admins may change everything (with a note), so they get none.
 */
export async function lockedReasons(
  db: Pick<DbExecutor, "select">,
  scope: EntryScope,
  entries: { id: string; start: string }[],
  now: Date = new Date(),
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (entries.length === 0) return out;
  const actor = scope.actedBy ?? scope.actor;
  if (can(actor, "approval.editLocked", { kind: "none" })) return out;
  const rules = await writeRulesOf(db, scope.workspaceId);
  const boundary = lockBoundary(rules.lock, now);
  const lockMessage = boundary
    ? `Entries before ${formatDateKey(lockDateKey(rules.lock, now)!)} are locked.`
    : "";
  const keys = entries.map((e) => localDateKey(new Date(e.start), rules.timezone));
  const sorted = [...keys].sort();
  const requests = await db
    .select({
      status: approvalRequest.status,
      periodStart: approvalRequest.periodStart,
      periodEnd: approvalRequest.periodEnd,
    })
    .from(approvalRequest)
    .where(
      and(
        eq(approvalRequest.workspaceId, scope.workspaceId),
        eq(approvalRequest.userId, scope.userId),
        inArray(approvalRequest.status, ["PENDING", "APPROVED"]),
        lte(approvalRequest.periodStart, sorted.at(-1)!),
        gte(approvalRequest.periodEnd, sorted[0]!),
      ),
    );
  entries.forEach((e, i) => {
    const key = keys[i]!;
    const request = requests.find((r) => r.periodStart <= key && key <= r.periodEnd);
    if (request) out.set(e.id, request.status === "PENDING" ? PENDING_MESSAGE : APPROVED_MESSAGE);
    else if (boundary && new Date(e.start).getTime() < boundary.getTime())
      out.set(e.id, lockMessage);
  });
  return out;
}

function startsOf(change: WriteChange): Date[] {
  return [change.before, change.after].filter((d): d is Date => d !== undefined);
}

export async function assertWritable(
  db: Pick<DbExecutor, "select" | "insert" | "execute">,
  scope: EntryScope,
  input: WriteChange | WriteChange[],
  opts: { note?: string; now?: Date; rules?: WriteRules } = {},
): Promise<void> {
  const changes = Array.isArray(input) ? input : [input];
  const starts = changes.flatMap(startsOf);
  if (starts.length === 0) return;
  const now = opts.now ?? new Date();
  const rules = opts.rules ?? (await writeRulesOf(db, scope.workspaceId));
  const actor = scope.actedBy ?? scope.actor;
  const privileged = can(actor, "approval.editLocked", { kind: "none" });

  if (!privileged) {
    const boundary = lockBoundary(rules.lock, now);
    if (boundary && starts.some((s) => s.getTime() < boundary.getTime())) {
      const key = lockDateKey(rules.lock, now)!;
      throw new TimeEntryError("INVALID", `Entries before ${formatDateKey(key)} are locked.`);
    }
  }

  // A submission takes the same lock: this write lands before its totals, or
  // sees the request (callers run inside a transaction, which holds the lock).
  await db.execute(timerLock(scope.workspaceId, scope.userId));
  const keys = starts.map((s) => localDateKey(s, rules.timezone));
  const sorted = [...keys].sort();
  const requests = await db
    .select({
      id: approvalRequest.id,
      status: approvalRequest.status,
      periodStart: approvalRequest.periodStart,
      periodEnd: approvalRequest.periodEnd,
    })
    .from(approvalRequest)
    .where(
      and(
        eq(approvalRequest.workspaceId, scope.workspaceId),
        eq(approvalRequest.userId, scope.userId),
        inArray(approvalRequest.status, ["PENDING", "APPROVED"]),
        lte(approvalRequest.periodStart, sorted.at(-1)!),
        gte(approvalRequest.periodEnd, sorted[0]!),
      ),
    );
  if (requests.length === 0) return;
  const covering = (key: string) =>
    requests.find((r) => r.periodStart <= key && key <= r.periodEnd);

  const hits = changes.flatMap((change) => {
    const request = startsOf(change)
      .map((s) => covering(localDateKey(s, rules.timezone)))
      .find((r) => r !== undefined);
    return request ? [{ change, request }] : [];
  });
  if (hits.length === 0) return;
  if (!privileged) {
    throw new TimeEntryError(
      "INVALID",
      hits.some((h) => h.request.status === "PENDING") ? PENDING_MESSAGE : APPROVED_MESSAGE,
    );
  }
  if (!opts.note) throw new TimeEntryError("NOTE_REQUIRED", NOTE_REQUIRED_MESSAGE);
  await db.insert(approvalEvent).values(
    hits.map(({ change, request }) => ({
      id: randomUUID(),
      workspaceId: scope.workspaceId,
      requestId: request.id,
      userId: scope.userId,
      actorId: actor.userId,
      action: "ADMIN_EDIT" as const,
      note: opts.note,
      entryId: change.entryId ?? null,
      changes: change.changes ?? null,
    })),
  );
}
