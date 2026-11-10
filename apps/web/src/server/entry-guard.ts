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
  expense,
  gte,
  inArray,
  invoice,
  lte,
  timeEntry,
  workspaceSettings,
} from "@timekeep/db";

import type { EntryScope } from "./time-entries";
import { TimeEntryError } from "./entry-error";
import { timerLock } from "./person-lock";

/**
 * The write guard of Phase 5a (decisions 5 and 6), called by every write path
 * in `time-entries.ts` and nowhere else (`writable-coverage.test.ts`); from
 * Phase 6c `expense-guard.ts` runs the same lookup over expense dates:
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

/** What the guard protects: the wording of the lock message. */
export type GuardedNoun = "Entries" | "Expenses";

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

/** The PENDING and APPROVED requests of the person covering any of `keys`. */
async function coveringRequests(
  db: Pick<DbExecutor, "select">,
  scope: Pick<EntryScope, "workspaceId" | "userId">,
  keys: readonly string[],
) {
  const sorted = [...keys].sort();
  return db
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
}

/**
 * Why the scope's actor may not change each item, for the editor's reads
 * (rows and cells shown read-only): the lock date, or a submitted period.
 * Owners and admins may change everything (with a note), so they get none.
 * `key` is the item's local date; `instant` decides the lock boundary.
 */
export async function lockedReasonsForKeys(
  db: Pick<DbExecutor, "select">,
  scope: EntryScope,
  items: { id: string; key: string; instant: Date }[],
  noun: GuardedNoun,
  now: Date = new Date(),
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (items.length === 0) return out;
  const actor = scope.actedBy ?? scope.actor;
  if (can(actor, "approval.editLocked", { kind: "none" })) return out;
  const rules = await writeRulesOf(db, scope.workspaceId);
  const boundary = lockBoundary(rules.lock, now);
  const lockMessage = boundary
    ? `${noun} before ${formatDateKey(lockDateKey(rules.lock, now)!)} are locked.`
    : "";
  const requests = await coveringRequests(
    db,
    scope,
    items.map((i) => i.key),
  );
  for (const item of items) {
    const request = requests.find((r) => r.periodStart <= item.key && item.key <= r.periodEnd);
    if (request) {
      out.set(item.id, request.status === "PENDING" ? PENDING_MESSAGE : APPROVED_MESSAGE);
    } else if (boundary && item.instant.getTime() < boundary.getTime()) {
      out.set(item.id, lockMessage);
    }
  }
  return out;
}

/** `lockedReasonsForKeys` over entries, by their start in the workspace timezone. */
export async function lockedReasons(
  db: Pick<DbExecutor, "select">,
  scope: EntryScope,
  entries: { id: string; start: string }[],
  now: Date = new Date(),
): Promise<Map<string, string>> {
  if (entries.length === 0) return new Map();
  const actor = scope.actedBy ?? scope.actor;
  if (can(actor, "approval.editLocked", { kind: "none" })) return new Map();
  const { timezone } = await writeRulesOf(db, scope.workspaceId);
  return lockedReasonsForKeys(
    db,
    scope,
    entries.map((e) => {
      const instant = new Date(e.start);
      return { id: e.id, key: localDateKey(instant, timezone), instant };
    }),
    "Entries",
    now,
  );
}

/** One guarded item: its local date keys before and after the change, and what to log. */
export interface KeyedChange {
  /** The date keys the change touches (before and after), already in the workspace zone. */
  keys: string[];
  /** The instants of those keys, for the lock boundary. */
  instants: Date[];
  entryId?: string;
  expenseId?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
}

/** Phase 6d decision 23: what an invoiced entry or expense answers to every write. */
export function INVOICED_MESSAGE(kind: "entry" | "expense", number: string): string {
  return `This ${kind} is on invoice ${number}.`;
}

/** The lock line of an invoiced row in the editors' reads. */
export function invoicedLockedReason(number: string): string {
  return `On invoice ${number}`;
}

/**
 * Time and expenses on an invoice are read-only for everyone, a note or not
 * (decision 23): the invoice service releases them by removing the line,
 * deleting the draft or voiding the invoice.
 */
async function assertNotInvoiced(
  db: Pick<DbExecutor, "select">,
  items: KeyedChange[],
): Promise<void> {
  // The rows are locked for the rest of the caller's transaction, so an import cannot mark
  // them between this check and the write, and a write waiting here sees an import's mark.
  const numberOf = async (invoiceId: string) =>
    (await db.select({ number: invoice.number }).from(invoice).where(eq(invoice.id, invoiceId)))[0]
      ?.number ?? "";
  const entryIds = [...new Set(items.flatMap((i) => (i.entryId ? [i.entryId] : [])))].sort();
  if (entryIds.length > 0) {
    const rows = await db
      .select({ invoiceId: timeEntry.invoiceId })
      .from(timeEntry)
      .where(inArray(timeEntry.id, entryIds))
      .orderBy(timeEntry.id)
      .for("update");
    const hit = rows.find((r) => r.invoiceId !== null);
    if (hit?.invoiceId) {
      throw new TimeEntryError("INVALID", INVOICED_MESSAGE("entry", await numberOf(hit.invoiceId)));
    }
  }
  const expenseIds = [...new Set(items.flatMap((i) => (i.expenseId ? [i.expenseId] : [])))].sort();
  if (expenseIds.length > 0) {
    const rows = await db
      .select({ invoiceId: expense.invoiceId })
      .from(expense)
      .where(inArray(expense.id, expenseIds))
      .orderBy(expense.id)
      .for("update");
    const hit = rows.find((r) => r.invoiceId !== null);
    if (hit?.invoiceId) {
      throw new TimeEntryError(
        "INVALID",
        INVOICED_MESSAGE("expense", await numberOf(hit.invoiceId)),
      );
    }
  }
}

/**
 * The guard over date keys: refuses anything on an invoice for everyone, then
 * the lock and the submitted periods for members and managers; asks owners
 * and admins for a note there and logs it. Callers run inside a transaction
 * and take the person's lock here, so this write lands before a submission's
 * totals or sees the request.
 */
export async function assertKeysWritable(
  db: Pick<DbExecutor, "select" | "insert" | "execute">,
  scope: EntryScope,
  items: KeyedChange[],
  opts: { note?: string; now?: Date; rules?: WriteRules; noun: GuardedNoun },
): Promise<void> {
  const keys = items.flatMap((i) => i.keys);
  if (keys.length === 0) return;
  // The person's lock first, then the rows (as startTimer and the editors take them).
  await db.execute(timerLock(scope.workspaceId, scope.userId));
  await assertNotInvoiced(db, items);
  const now = opts.now ?? new Date();
  const rules = opts.rules ?? (await writeRulesOf(db, scope.workspaceId));
  const actor = scope.actedBy ?? scope.actor;
  const privileged = can(actor, "approval.editLocked", { kind: "none" });

  if (!privileged) {
    const boundary = lockBoundary(rules.lock, now);
    const instants = items.flatMap((i) => i.instants);
    if (boundary && instants.some((s) => s.getTime() < boundary.getTime())) {
      const key = lockDateKey(rules.lock, now)!;
      throw new TimeEntryError("INVALID", `${opts.noun} before ${formatDateKey(key)} are locked.`);
    }
  }

  const requests = await coveringRequests(db, scope, keys);
  if (requests.length === 0) return;
  const covering = (key: string) =>
    requests.find((r) => r.periodStart <= key && key <= r.periodEnd);

  const hits = items.flatMap((item) => {
    const request = item.keys.map(covering).find((r) => r !== undefined);
    return request ? [{ item, request }] : [];
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
    hits.map(({ item, request }) => ({
      id: randomUUID(),
      workspaceId: scope.workspaceId,
      requestId: request.id,
      userId: scope.userId,
      actorId: actor.userId,
      action: "ADMIN_EDIT" as const,
      note: opts.note,
      entryId: item.entryId ?? null,
      expenseId: item.expenseId ?? null,
      changes: item.changes ?? null,
    })),
  );
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
  if (changes.every((c) => startsOf(c).length === 0)) return;
  const rules = opts.rules ?? (await writeRulesOf(db, scope.workspaceId));
  await assertKeysWritable(
    db,
    scope,
    changes.map((change) => {
      const instants = startsOf(change);
      return {
        keys: instants.map((s) => localDateKey(s, rules.timezone)),
        instants,
        entryId: change.entryId,
        changes: change.changes,
      };
    }),
    { ...opts, rules, noun: "Entries" },
  );
}
