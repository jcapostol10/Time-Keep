import "server-only";

import { type DayRules, holidayKeysFor } from "@timekeep/core";
import type { DbExecutor } from "@timekeep/db";

import { holidayRules } from "../time-off/holidays";
import type { PersonContext } from "../time-off/people";

/**
 * Each person's working days and the holidays that apply to them over
 * `[from, to]` (decision 3): where an assignment's minutes fall.
 */
export async function dayRulesFor(
  db: DbExecutor,
  workspaceId: string,
  people: readonly PersonContext[],
  from: string,
  to: string,
): Promise<Map<string, DayRules>> {
  const rules = people.length ? await holidayRules(db, workspaceId, from, to) : [];
  return new Map(
    people.map((p) => [
      p.userId,
      { workingDays: p.capacity.workingDays, holidayKeys: holidayKeysFor(rules, p, from, to) },
    ]),
  );
}
