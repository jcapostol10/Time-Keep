import type { RoundingRule } from "@timekeep/core";
import { type SQL, sql } from "drizzle-orm";

import { timeEntry } from "./schema";

/**
 * Report rounding in SQL: the twin of core's `roundDuration` and `amountFor`
 * (packages/core/src/rounding.ts, money.ts), applied per entry by the report
 * engine when the workspace sets a rule. Integer maths throughout: Postgres
 * truncates integer division, durations are never negative, and the step is
 * a whole number of seconds, so "nearest" ties round up as in core. An
 * integration test checks the two agree over every mode, step and edge.
 */

/** `duration_seconds` rounded per the rule (0 while an entry runs). */
export function roundedSecondsSql(rule: RoundingRule): SQL {
  const s = sql`coalesce(${timeEntry.durationSeconds}, 0)`;
  const step = sql.raw(String(rule.minutes * 60));
  switch (rule.mode) {
    case "off":
      return s;
    case "up":
      return sql`((${s} + ${step} - 1) / ${step}) * ${step}`;
    case "down":
      return sql`(${s} / ${step}) * ${step}`;
    case "nearest":
      return sql`((${s} + ${sql.raw(String(rule.minutes * 30))}) / ${step}) * ${step}`;
  }
}

/**
 * The entry's amount from its stored rate and its rounded duration, half up
 * (`(rate × seconds × 2 + 3600) / 7200`), as a bigint; null without a rate.
 */
export function roundedAmountSql(rule: RoundingRule): SQL {
  return sql`case
    when ${timeEntry.billableRateMinor} is null or ${timeEntry.durationSeconds} is null then null
    else (${timeEntry.billableRateMinor} * ${roundedSecondsSql(rule)} * 2 + 3600) / 7200
  end`;
}
