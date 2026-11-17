import "server-only";

import { and, type DbExecutor, eq, holiday, holidayAssignee, inArray, sql } from "@timekeep/db";

/** The holidays assigned to these people or groups, before their rows go. */
export async function holidaysAssignedTo(
  db: Pick<DbExecutor, "select">,
  workspaceId: string,
  by: { userId?: string; groupId?: string },
): Promise<string[]> {
  const rows = await db
    .select({ id: holidayAssignee.holidayId })
    .from(holidayAssignee)
    .innerJoin(holiday, eq(holiday.id, holidayAssignee.holidayId))
    .where(
      and(
        eq(holiday.workspaceId, workspaceId),
        by.userId ? eq(holidayAssignee.userId, by.userId) : undefined,
        by.groupId ? eq(holidayAssignee.groupId, by.groupId) : undefined,
      ),
    );
  return [...new Set(rows.map((r) => r.id))];
}

/**
 * Deletes those of `holidayIds` left with no assignee. A holiday with no
 * people and no groups applies to everyone, so one that named only a removed
 * member (or a deleted group) must go, not quietly widen to the workspace.
 */
export async function dropOrphanedHolidays(
  db: Pick<DbExecutor, "delete">,
  holidayIds: string[],
): Promise<void> {
  if (holidayIds.length === 0) return;
  await db
    .delete(holiday)
    .where(
      and(
        inArray(holiday.id, holidayIds),
        sql`not exists (select 1 from ${holidayAssignee} where ${holidayAssignee.holidayId} = ${holiday.id})`,
      ),
    );
}
