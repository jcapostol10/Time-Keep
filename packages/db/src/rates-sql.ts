import { eq, type SQL, sql } from "drizzle-orm";

import type { Database } from "./client";
import { timeEntry } from "./schema";

/**
 * Rating time entries in SQL: the one place the entry service, the
 * "apply to past entries" job and the seed resolve rates, so they cannot
 * drift. Its rule is core's `resolveRate` (packages/core/src/rates.ts; an
 * integration test checks they agree): at each level, most specific first,
 * the latest row in force at the entry's start; a null row falls through.
 * The amount is round_half_up(rate × seconds / 3600) in numeric, null while
 * the entry runs or without a rate.
 *
 * Two snapshots (Phase 6a). Billable: five levels, and a rate applies only in
 * the entry's currency (its project's client's, else the workspace's), so no
 * number is ever read in another currency. Cost: project member, then member,
 * always in the workspace currency, on every work entry, billable or not.
 *
 * Row-valued correlated subqueries, because Postgres rejects a LATERAL that
 * references the UPDATE's target table. No row found sets the columns to null.
 */

type Executor = Pick<Database, "execute">;

/** Which snapshots a statement writes; both unless said otherwise. */
export interface RateKinds {
  billable?: boolean;
  cost?: boolean;
}

const BOTH: RateKinds = { billable: true, cost: true };

/** The entry's currency: its project's client's, else the workspace's (core `entryCurrency`). */
export const ENTRY_CURRENCY_SQL = sql`(
  select coalesce(c."currency", ws."currency") as code
  from "workspace_settings" ws
  left join "project" p on p."id" = "time_entry"."project_id"
  left join "client" c on c."id" = p."client_id"
  where ws."workspace_id" = "time_entry"."workspace_id"
)`;

const level = (kind: "billable" | "cost", name: string, priority: number, match: SQL) => sql`(
  select r."amount_minor", r."currency", r."level", ${sql.raw(String(priority))} as priority
  from "rate" r
  where r."workspace_id" = "time_entry"."workspace_id"
    and r."kind" = ${sql.raw(`'${kind}'`)}
    and r."level" = ${sql.raw(`'${name}'`)}
    and ${match}
    ${kind === "billable" ? sql`and r."currency" = cur.code` : sql``}
    and r."effective_from" <= "time_entry"."start"
  order by r."effective_from" desc
  limit 1
)`;

const amountOf = (rateColumn: SQL) => sql`case
    when "time_entry"."duration_seconds" is null then null
    else round(${rateColumn}::numeric * "time_entry"."duration_seconds" / 3600)::bigint
  end`;

const RESOLVED = sql`(
  select l."amount_minor", l."currency", l."level", ${amountOf(sql`l."amount_minor"`)}
  from ${ENTRY_CURRENCY_SQL} cur
  cross join lateral (
    ${level("billable", "task", 1, sql`r."task_id" = "time_entry"."task_id" and r."project_id" = "time_entry"."project_id"`)}
    union all
    ${level("billable", "project_member", 2, sql`r."project_id" = "time_entry"."project_id" and r."user_id" = "time_entry"."user_id"`)}
    union all
    ${level("billable", "project", 3, sql`r."project_id" = "time_entry"."project_id"`)}
    union all
    ${level("billable", "member", 4, sql`r."user_id" = "time_entry"."user_id"`)}
    union all
    ${level("billable", "workspace", 5, sql`true`)}
  ) l
  where l."amount_minor" is not null
  order by l.priority
  limit 1
)`;

const RESOLVED_COST = sql`(
  select l."amount_minor", l."level", ${amountOf(sql`l."amount_minor"`)}
  from (
    ${level("cost", "project_member", 1, sql`r."project_id" = "time_entry"."project_id" and r."user_id" = "time_entry"."user_id"`)}
    union all
    ${level("cost", "member", 2, sql`r."user_id" = "time_entry"."user_id"`)}
  ) l
  where l."amount_minor" is not null
  order by l.priority
  limit 1
)`;

/**
 * Re-rates every work entry `where` selects: the billable snapshot (rate,
 * currency, source, amount), the cost snapshot (rate, source, amount), or
 * both. Breaks stay unrated and uncosted.
 */
export function rateEntriesSql(where: SQL, kinds: RateKinds = BOTH): SQL {
  const sets: SQL[] = [];
  if (kinds.billable) {
    sets.push(
      sql`("billable_rate_minor", "rate_currency", "rate_source", "amount_minor") = ${RESOLVED}`,
    );
  }
  if (kinds.cost) {
    sets.push(sql`("cost_rate_minor", "cost_rate_source", "cost_amount_minor") = ${RESOLVED_COST}`);
  }
  if (sets.length === 0) throw new Error("rateEntriesSql: no snapshot to rate");
  return sql`update "time_entry"
    set ${sql.join(sets, sql`, `)}
    where (${where}) and "type" = 'work'`;
}

/** Rates one entry with the rates in force at its start; nothing to do when no kind is asked. */
export async function rateEntry(
  db: Executor,
  entryId: string,
  kinds: RateKinds = BOTH,
): Promise<void> {
  if (!kinds.billable && !kinds.cost) return;
  await db.execute(rateEntriesSql(eq(timeEntry.id, entryId), kinds));
}

/** Keeps the entry's rates and recomputes both amounts (a new duration, a stop). */
export async function recomputeAmount(db: Executor, entryId: string): Promise<void> {
  await db.execute(sql`update "time_entry"
    set "amount_minor" = case
      when "billable_rate_minor" is null or "duration_seconds" is null then null
      else round("billable_rate_minor"::numeric * "duration_seconds" / 3600)::bigint
    end,
    "cost_amount_minor" = case
      when "cost_rate_minor" is null or "duration_seconds" is null then null
      else round("cost_rate_minor"::numeric * "duration_seconds" / 3600)::bigint
    end
    where ${eq(timeEntry.id, entryId)} and "type" = 'work'`);
}
