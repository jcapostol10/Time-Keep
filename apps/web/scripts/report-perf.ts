/**
 * Times the one-year Summary over the perf tenant (pnpm db:seed:perf), for the
 * owner and for a scoped manager, and prints the plans of its queries; then
 * rates all 1,000,000 entries with the "apply to past entries" job. Fails
 * over the one-second Summary budget or the 300-second function budget.
 *
 *   pnpm --filter @timekeep/web report:perf
 *
 * Runs with --conditions=react-server so server-only modules load under tsx.
 */
import { DEFAULT_REPORT_QUERY, resolveViewerPrefs, type ReportQuery } from "@timekeep/core";
import { createDb, sql } from "@timekeep/db";

import { loadViewer } from "../src/server/authz";
import type { Viewer } from "../src/server/catalog/viewer";
import { requestRateRecalc, runRateRecalcJob } from "../src/server/rate-recalc";
import { summaryReport } from "../src/server/reports";

const BUDGET_MS = 1000;
const RECALC_BUDGET_MS = 300_000;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const handle = createDb(url, { max: 4 });
  const db = handle.db;
  try {
    const owner = await db.execute<{ id: string }>(
      sql`select user_id as id from membership where workspace_id = 'perf-ws' and role = 'owner'`,
    );
    const ownerId = owner.rows[0]?.id;
    if (!ownerId) throw new Error("No perf tenant: run pnpm db:seed:perf first");
    const viewer = await loadViewer(db, "perf-ws", ownerId);
    const prefs = resolveViewerPrefs(
      { timezone: "Asia/Manila" },
      { timezone: "Asia/Manila", timeFormat: "24h", durationFormat: "hh:mm:ss", weekStart: 1 },
    );
    const to = new Date();
    const from = new Date(to.getTime() - 365 * 86_400_000);
    const query: ReportQuery = {
      ...DEFAULT_REPORT_QUERY,
      preset: "custom",
      from: from.toISOString(),
      to: to.toISOString(),
      groupBy: ["client", "project"],
    };

    // Every entry rated first, by the job a rate change "from the beginning" runs.
    const { jobId } = await requestRateRecalc(db, "perf-ws", ownerId, new Date(0));
    const r0 = performance.now();
    await runRateRecalcJob(db, jobId);
    const recalcMs = performance.now() - r0;
    console.info(`[perf] rated every entry in ${(recalcMs / 1000).toFixed(1)} s`);

    async function time(label: string, who: Viewer): Promise<number> {
      await summaryReport(db, who, query, prefs); // warm the cache and the pool
      const runs: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        const report = await summaryReport(db, who, query, prefs);
        runs.push(performance.now() - t0);
        if (i === 0) {
          console.info(
            `[perf] ${label}: ${report.totals.entryCount} entries, ${report.series.length} buckets, amount ${report.totals.amountMinor}`,
          );
        }
      }
      runs.sort((a, b) => a - b);
      const mid = runs[2]!;
      console.info(
        `[perf] one-year Summary (${label}): median ${mid.toFixed(0)} ms (runs ${runs.map((r) => r.toFixed(0)).join(", ")})`,
      );
      return mid;
    }
    const manager = await loadViewer(db, "perf-ws", "perf-user-2");
    const median = Math.max(await time("owner", viewer), await time("manager", manager));

    const plans = [
      sql`explain (analyze, buffers, costs off)
          select project.client_id, coalesce(client.name, 'No client'), time_entry.project_id,
                 coalesce(project.name, 'No project'), sum(time_entry.duration_seconds)
          from time_entry
          left join project on project.id = time_entry.project_id
          left join client on client.id = project.client_id
          where time_entry.workspace_id = 'perf-ws' and time_entry.deleted_at is null
            and time_entry."end" is not null
            and time_entry.start >= ${from} and time_entry.start < ${to}
          group by 1, 2, 3, 4`,
      sql`explain (analyze, buffers, costs off)
          select (time_entry.start at time zone 'Asia/Manila')::date,
                 sum(time_entry.duration_seconds)
          from time_entry
          where time_entry.workspace_id = 'perf-ws' and time_entry.deleted_at is null
            and time_entry."end" is not null
            and time_entry.start >= ${from} and time_entry.start < ${to}
          group by 1`,
    ];
    for (const plan of plans) {
      const result = await db.execute<{ "QUERY PLAN": string }>(plan);
      console.info(result.rows.map((r) => r["QUERY PLAN"]).join("\n"));
      console.info("");
    }
    if (median > BUDGET_MS) {
      console.error(`[perf] over budget: ${median.toFixed(0)} ms > ${BUDGET_MS} ms`);
      process.exitCode = 1;
    }
    if (recalcMs > RECALC_BUDGET_MS) {
      console.error(`[perf] recalculation over budget: ${(recalcMs / 1000).toFixed(0)} s > 300 s`);
      process.exitCode = 1;
    }
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error("[perf] failed", error);
  process.exitCode = 1;
});
