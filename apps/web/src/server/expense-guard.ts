import "server-only";

import { zonedDateTimeToInstant } from "@timekeep/core";
import type { DbExecutor } from "@timekeep/db";

import {
  assertKeysWritable,
  lockedReasonsForKeys,
  writeRulesOf,
  type WriteRules,
} from "./entry-guard";
import type { EntryScope } from "./time-entries";

/**
 * The approval and lock guard over expenses (Phase 6c decision 17): the entry
 * guard's lookup, keyed by the expense's local date. An expense belongs to
 * the period that holds its date; the lock boundary compares the date's
 * midnight in the workspace timezone. Called by every writer of
 * `server/expenses.ts` (`expense-writable-coverage.test.ts`).
 */

export interface ExpenseChange {
  expenseId?: string;
  /** The expense's date before the change (absent for a new expense). */
  before?: string;
  /** The expense's date after the change (absent for a delete). */
  after?: string;
  /** `{ field: { from, to } }` for the log. */
  changes?: Record<string, { from: unknown; to: unknown }>;
}

function datesOf(change: ExpenseChange): string[] {
  return [change.before, change.after].filter((d): d is string => d !== undefined);
}

const midnight = (date: string, tz: string) =>
  zonedDateTimeToInstant({ date, hours: 0, minutes: 0 }, tz);

export async function assertExpenseWritable(
  db: Pick<DbExecutor, "select" | "insert" | "execute">,
  scope: EntryScope,
  input: ExpenseChange | ExpenseChange[],
  opts: { note?: string; now?: Date; rules?: WriteRules } = {},
): Promise<void> {
  const changes = Array.isArray(input) ? input : [input];
  if (changes.every((c) => datesOf(c).length === 0)) return;
  const rules = opts.rules ?? (await writeRulesOf(db, scope.workspaceId));
  await assertKeysWritable(
    db,
    scope,
    changes.map((change) => {
      const keys = datesOf(change);
      return {
        keys,
        instants: keys.map((k) => midnight(k, rules.timezone)),
        expenseId: change.expenseId,
        changes: change.changes,
      };
    }),
    { ...opts, rules, noun: "Expenses" },
  );
}

/** Why the scope's actor may not change each expense (the Expenses page's locked rows). */
export async function expenseLockedReasons(
  db: Pick<DbExecutor, "select">,
  scope: EntryScope,
  expenses: { id: string; date: string }[],
  now: Date = new Date(),
): Promise<Map<string, string>> {
  if (expenses.length === 0) return new Map();
  const { timezone } = await writeRulesOf(db, scope.workspaceId);
  return lockedReasonsForKeys(
    db,
    scope,
    expenses.map((e) => ({ id: e.id, key: e.date, instant: midnight(e.date, timezone) })),
    "Expenses",
    now,
  );
}
