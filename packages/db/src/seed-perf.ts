/**
 * A large tenant for report performance work: workspace "perf", 25
 * @perf.test people, 12 projects, 1,000,000 stopped entries over three
 * years (about a third tagged). Local databases only; the e2e seed and
 * cleanup never touch @perf.test. Rebuilds from scratch each run.
 *
 *   pnpm db:seed:perf            then   pnpm --filter @timekeep/web report:perf
 */
import { sql } from "drizzle-orm";

import { createDb } from "./client";

const ENTRIES = Number(process.env.PERF_ENTRIES ?? 1_000_000);
const USERS = 25;

function assertLocal(url: string) {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`Refusing to seed perf data into a non-local database (${host})`);
  }
}

async function main() {
  const url = process.env.DATABASE_URL_SESSION ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  assertLocal(url);
  const handle = createDb(url, { max: 1 });
  const db = handle.db;
  const started = Date.now();
  try {
    await db.execute(sql`delete from workspace where slug = 'perf'`);
    await db.execute(sql`delete from "user" where email like '%@perf.test'`);

    await db.execute(sql`
      insert into "user" (id, name, email, email_verified, timezone)
      select 'perf-user-' || g, 'Perf Person ' || g, 'perf' || g || '@perf.test', true, 'Asia/Manila'
      from generate_series(1, ${USERS}) g`);
    await db.execute(
      sql`insert into workspace (id, name, slug) values ('perf-ws', 'Perf', 'perf')`,
    );
    await db.execute(
      sql`insert into workspace_settings (workspace_id, timezone) values ('perf-ws', 'Asia/Manila')`,
    );
    await db.execute(sql`
      insert into membership (id, workspace_id, user_id, role, status)
      select 'perf-m-' || g, 'perf-ws', 'perf-user-' || g,
             (case when g = 1 then 'owner' else 'member' end)::workspace_role, 'ACTIVE'
      from generate_series(1, ${USERS}) g`);
    await db.execute(sql`
      insert into client (id, workspace_id, name)
      select 'perf-c-' || g, 'perf-ws', 'Client ' || g from generate_series(1, 4) g`);
    await db.execute(sql`
      insert into project (id, workspace_id, name, color, client_id, billable)
      select 'perf-p-' || g, 'perf-ws', 'Project ' || g, '#1f8a8a',
             case when g <= 8 then 'perf-c-' || (1 + g % 4) end, g <= 8
      from generate_series(1, 12) g`);
    await db.execute(sql`
      insert into tag (id, workspace_id, name, color)
      select 'perf-t-' || g, 'perf-ws', 'tag ' || g, '#7b5cc4' from generate_series(1, 6) g`);

    // Entries: start uniform over three years, 15 min – 4 h, no running timers. The random
    // values come from a per-row subselect (an uncorrelated LATERAL would run once).
    await db.execute(sql`
      insert into time_entry (id, workspace_id, user_id, description, project_id, billable, start, "end", duration_seconds)
      select 'perf-e-' || r.g, 'perf-ws', 'perf-user-' || (1 + r.g % ${USERS}),
             (array['Design', 'Development', 'Review', 'Meetings', 'Support', 'Planning'])[1 + r.g % 6],
             case when r.g % 10 = 0 then null else 'perf-p-' || (1 + r.g % 12) end,
             r.g % 3 <> 0,
             r.start, r.start + make_interval(secs => r.dur), r.dur
      from (
        select g,
               now() - make_interval(secs => floor(random() * 3 * 365 * 86400)::int) as start,
               (900 + floor(random() * 13500))::int as dur
        from generate_series(1, ${ENTRIES}) g
      ) r`);
    await db.execute(sql`
      insert into time_entry_tag (time_entry_id, tag_id)
      select id, 'perf-t-' || (1 + (hashtext(id) & 2147483647) % 6)
      from time_entry where workspace_id = 'perf-ws' and (hashtext(id) & 2147483647) % 3 = 0`);
    await db.execute(sql`analyze time_entry`);
    await db.execute(sql`analyze time_entry_tag`);
    console.info(
      `[perf] ${ENTRIES} entries for ${USERS} people in ${((Date.now() - started) / 1000).toFixed(1)} s (workspace /w/perf)`,
    );
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error("[perf] seed failed", error);
  process.exitCode = 1;
});
