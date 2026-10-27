import { eq, type SQL, sql } from "drizzle-orm";

import type { Database } from "./client";
import { timeEntry } from "./schema";

/**
 * Rating time entries in SQL: the one place the entry service, the
 * "apply to past entries" job and the seed resolve rates, so they cannot
 * drift. Its rule is core's `resolveRate` (packages/core/src/rates.ts; an
 * integration test checks they agree): at each level, most specific first,
 * the latest billable row in force at the entry's start; a null row falls
 * through. The amount is round_half_up(rate × seconds / 3600) in numeric,
 * null while the entry runs or without a rate.
 *
 * A row-valued correlated subquery, because Postgres rejects a LATERAL that
 * references the UPDATE's target table. No row found sets all four to null.
 */

type Executor = Pick<Database, "execute">;

const level = (name: string, priority: number, match: SQL) => sql`(
  select r."amount_minor", r."currency", r."level", ${sql.raw(String(priority))} as priority
  from "rate" r
  where r."workspace_id" = "time_entry"."workspace_id"
    and r."kind" = 'billable'
    and r."level" = ${sql.raw(`'${name}'`)}
    and ${match}
    and r."effective_from" <= "time_entry"."start"
  order by r."effective_from" desc
  limit 1
)`;

const RESOLVED = sql`(
  select l."amount_minor", l."currency", l."level",
    case when "time_entry"."duration_seconds" is null then null
      else round(l."amount_minor"::numeric * "time_entry"."duration_seconds" / 3600)::bigint
    end
  from (
    ${level("task", 1, sql`r."task_id" = "time_entry"."task_id" and r."project_id" = "time_entry"."project_id"`)}
    union all
    ${level("project_member", 2, sql`r."project_id" = "time_entry"."project_id" and r."user_id" = "time_entry"."user_id"`)}
    union all
    ${level("project", 3, sql`r."project_id" = "time_entry"."project_id"`)}
    union all
    ${level("member", 4, sql`r."user_id" = "time_entry"."user_id"`)}
    union all
    ${level("workspace", 5, sql`true`)}
  ) l
  where l."amount_minor" is not null
  order by l.priority
  limit 1
)`;

/** Re-rates every entry `where` selects (rate, currency, source and amount). */
export function rateEntriesSql(where: SQL): SQL {
  return sql`update "time_entry"
    set ("billable_rate_minor", "rate_currency", "rate_source", "amount_minor") = ${RESOLVED}
    where ${where}`;
}

/** Rates one entry with the rates in force at its start. */
export async function rateEntry(db: Executor, entryId: string): Promise<void> {
  await db.execute(rateEntriesSql(eq(timeEntry.id, entryId)));
}

/** Keeps the entry's rate and recomputes its amount (a new duration, a stop). */
export async function recomputeAmount(db: Executor, entryId: string): Promise<void> {
  await db.execute(sql`update "time_entry"
    set "amount_minor" = case
      when "billable_rate_minor" is null or "duration_seconds" is null then null
      else round("billable_rate_minor"::numeric * "duration_seconds" / 3600)::bigint
    end
    where ${eq(timeEntry.id, entryId)}`);
}
