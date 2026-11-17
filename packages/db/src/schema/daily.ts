import { date, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { workspace } from "./workspace";

/**
 * The hourly cron runs each workspace's daily jobs once per local day, at or
 * after 07:00 in its timezone: a run claims (workspace, local date) here with
 * INSERT … ON CONFLICT DO NOTHING, which also serializes a cron delivered
 * twice. A claim left unfinished for two hours may be taken again.
 */
export const dailyJobRun = pgTable(
  "daily_job_run",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.localDate] })],
).enableRLS();

export type DailyJobRun = typeof dailyJobRun.$inferSelect;
