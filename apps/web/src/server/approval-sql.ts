import type { ApprovalStatus } from "@timekeep/core";
import { sql, timeEntry } from "@timekeep/db";
import type { SQL } from "drizzle-orm";

/**
 * "This `time_entry` row is in one of its owner's requests with these
 * statuses": the entry's local date (workspace timezone) inside the period.
 * The SQL twin of `assertWritable`'s lookup, for set-based writers.
 */
export const SUBMITTED_TIME_MESSAGE = "Archive it instead: it has time in submitted periods.";

export function inSubmittedPeriodSql(statuses: readonly ApprovalStatus[]): SQL {
  return sql`exists (
    select 1
    from approval_request r
    join workspace_settings s on s.workspace_id = r.workspace_id
    where r.workspace_id = ${timeEntry.workspaceId}
      and r.user_id = ${timeEntry.userId}
      and r.status::text = any(${sql.param([...statuses])}::text[])
      and (${timeEntry.start} at time zone s.timezone)::date between r.period_start and r.period_end
  )`;
}
