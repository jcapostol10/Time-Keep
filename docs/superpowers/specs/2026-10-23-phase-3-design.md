# Phase 3 — Reports, dashboard and exports: design

Prompt: "Phase 3 — Reports, dashboard and exports" in `Clockify Clone — Phased Claude Code Prompt Pack.md`. Checklist: `docs/PROGRESS.md` § Phase 3. Builds on the Phase 2 catalog and entry service; completes the free-tier MVP (PRD).

## Goal

A manager answers "who worked on what, for how long" for any date range, from three report views that always agree with each other and with the tracker, and turns the answer into a CSV, an Excel file, a PDF or a link anyone can open without signing in. Every member sees the same for their own time. A dashboard shows a person their own recent picture and, for those who run the team, who is tracking right now.

Amounts (money) stay out of Phase 3. The engine's row shape, grouping and export columns are designed so Phase 4 adds `amount`, `cost` and `profit` as columns, not as a rewrite: every total is a record of named measures, and every export reads the same record.

## Decisions for the owner

1. **Large exports without a worker host.** The prompt says exports over 10,000 rows "run as a pg-boss job and email a download link", but only `apps/web` is deployed; the worker runs locally and cannot import the web app's server modules (storage, mail, env are `server-only`). Recommendation: large exports run inside a Vercel Function after the response (`after()`, within the 300 s default budget), write the file to a private bucket (decision 6), record an `export_job` row, email the link, and also appear under Reports → Exports with a download button, so the email is not the only way to the file (production cannot email most people until the Resend domain is verified). Phase 3 does not touch `apps/worker`: moving the export function behind pg-boss when a worker host exists is a backlog item, and the function is written as one call (`runExportJob(db, jobId)`) so that move is a matter of where it is invoked. The alternative, deploying the worker now (Railway/Fly/Render, with the database, S3 and SMTP secrets, and the server modules extracted into a package), is real infrastructure and a restructuring before anything needs them.
2. **PDF rendering.** Recommendation: headless Chromium (`puppeteer-core` + `@sparticuz/chromium` on Vercel, the local Chrome from Playwright in development) printing static HTML the server renders for the report: the share page's components rendered to static markup with the theme's light CSS inlined and the charts at fixed sizes, loaded with `page.setContent`, so the browser never navigates to the deployment (which sits behind deployment protection) and no token or session is involved. The PDF shows the same charts and tables the person saw, from one set of components. Cost: ~55 MB in the function bundle (well under Vercel's 5 GB limit now) and a 2–4 s cold start on the first PDF. The alternative, `@react-pdf/renderer`, is pure JS but every chart would be drawn a second time with its own primitives, and tables and fonts never quite match the screen.
3. **Who sees the team's time.** Recommendation: owners, admins and managers see everyone's entries in reports and the Team dashboard tab; members see their own time only. Phase 4 narrows a manager to the projects and people they manage; until then the role is read as "runs the team". The alternative is owner/admin only, which makes the manager role pointless until Phase 4.
4. **Share links.** Recommendation: a link has no expiry unless the sharer sets one (7, 30 or 90 days), can be revoked from a "Shared" list under Reports, shows exactly the report its creator saw (names included: they chose to share it), and keeps a relative range relative: a link to "this week" shows the current week whenever it is opened, a link to a custom range stays fixed. The token is 32 random bytes in the URL; the database stores only its hash, so a database read cannot reproduce a link.
5. **Inline edit in the Detailed report.** Recommendation: a person edits their own entries there with the tracker's rules and components; other people's entries are read-only until Phase 4's "add time for others" (a Basic-tier capability in the PRD). The alternative, admins editing anyone's entries now, pre-empts the Phase 4 permission matrix.
6. **A private bucket for export files.** The production bucket (Supabase Storage through its S3 endpoint) is public, and Supabase has no per-prefix split, so an export written next to avatars would be readable by anyone with the key. Recommendation: a second, private bucket — `timekeep-exports` on Supabase (you create it, private), `S3_EXPORT_BUCKET` in Vercel's production and preview env; locally `pnpm storage:init` creates it on RustFS — with downloads through short-lived presigned URLs (15 minutes), which the S3 endpoint supports. Small exports (under 4 MB, the function response limit) stream straight back and never touch a bucket. The alternative, streaming every stored file through the app, hits that 4 MB limit on exactly the exports that are large enough to be stored.

## Calls made by the builder (not from the prompt)

- **Grouping keys are fixed vocabulary**: `project`, `client`, `user`, `task`, `tag`, `date`, `week`, `month`, `description`. Grouping by `tag` counts an entry under each of its tags (and once under "No tag" when it has none), so tag totals can exceed the overall total; the UI says so under the table. Every other key partitions the entries.
- **"Without project" and "without task"** are filter values (`projectIds` may contain the sentinel `none`), not separate switches, so the URL stays one shape.
- **Date keys are computed in the viewer's timezone in SQL** (`(start AT TIME ZONE tz)::date`); an entry that crosses midnight counts under its start date, as the tracker and timesheet already do. The prompt's "entries crossing midnight split by date" is read as that rule, tested explicitly, not as splitting one entry into two rows: the views must agree with the tracker, which never splits.
- **The time-series bucket follows the range**: by day up to 31 days, by week up to a year (the viewer's week start), by month beyond. Chosen by the engine from the range, overridable in the URL.
- **Pagination of the Detailed report is keyset** (`start, id` descending), 50 rows a page, so page 200 costs the same as page 1.
- **The free tier's "1-month range" is not enforced** in Phase 3; plans arrive in Phase 8. The range is capped at a year by `dateRangeSchema` as before.
- **Recharts** draws the charts; colours come from the theme tokens, so dark mode needs no second palette. Charts render from the same grouped rows as the table, never from a second query.
- **Exports contain what the view shows**: the Summary export is the grouped table; the Detailed export is the entry list (all pages); the Weekly export is the grid. A small export (≤ 10,000 rows) streams back as a download; a large one becomes an `export_job` (decision 1).
- **The Project Status tab** (Phase 2) gains the CSV export and a link to the Detailed report filtered to the project and range; its numbers come from the report engine now, so the tab and the reports cannot drift.
- **The Team tab polls every 30 s** through react-query (`refetchInterval`) and refetches on focus; SSE adds a long-lived connection for no gain at this size.
- **A perf seed** (`pnpm db:seed:perf`, local only, refuses a non-local URL) creates a separate `perf` workspace with 1,000,000 entries over three years for 25 users (`@perf.test`, a domain the e2e seed and cleanup rules never touch), for the EXPLAIN plans and the one-second check. It never touches the demo tenant.
- **A share link snapshots its creator's view**: the row stores the effective query (a member's forced `userIds` included) and the creator's resolved preferences (timezone, week start, time, date and duration formats) at creation, so the page renders the same whoever opens it and however the creator's profile changes later. A link whose creator is no longer an active member reads as revoked. A shared report large enough for an export job is refused the export (its viewer has no account to own a job); CSV under the streaming limit still works.
- **The report pages' queries live under the tracker's `entries` key prefix** (`["tracker", slug, "entries", "report", …]`), as the timesheet and calendar ranges do, so an inline edit in the Detailed report, or any entry write elsewhere, refetches them; the Detailed page's keyset pages refetch from the first page.
- **The views agree without a running timer**: reports count stopped entries only (the running one has no duration yet); the acceptance test comparing the tracker's week total with the Summary runs with no timer, since the tracker adds live seconds.

## Data model

New tables (Drizzle, RLS enabled, migration `0007_phase3_reports`):

- `report_share_link`: `id`, `workspace_id`, `created_by` → user, `token_hash` (sha256, unique), `kind` (`summary` | `detailed` | `weekly`), `query` (jsonb: the effective report query, including a relative preset when one was used), `prefs` (jsonb: the creator's resolved timezone, week start, time, date and duration formats at creation), `title`, `expires_at?`, `revoked_at?`, `last_opened_at?`, `open_count`, timestamps. Index on `(workspace_id, created_at desc)`.
- `export_job`: `id`, `workspace_id`, `user_id`, `kind` (`csv` | `xlsx` | `pdf`), `report` (`summary` | `detailed` | `weekly` | `project-status`), `query` (jsonb), `status` (`queued` | `running` | `done` | `failed`), `row_count?`, `object_key?` (in the private export bucket), `error?`, `created_at`, `finished_at?`, `expires_at` (files are deleted after 7 days by a cleanup that runs with the next export). Index on `(workspace_id, user_id, created_at desc)`.

Indexes on `time_entry` for the engine: `time_entry_workspace_start_idx` on `(workspace_id, start)` `WHERE deleted_at IS NULL AND "end" IS NOT NULL`, which serves every team-wide range scan (the existing `(workspace_id, user_id, start)` index serves a member's own). `time_entry_tag` already has `tag_id` indexed for the tag filter's `EXISTS`. The EXPLAIN plans for the perf seed go into `docs/DATA_MODEL.md`.

No change to `time_entry` rows. `workspace_settings` gains nothing: the "members may see team reports" setting belongs to Phase 4's permission matrix.

## Access rules

- Reports and the dashboard are workspace pages (`requireWorkspacePage`, member). The engine takes a `Viewer`; for a `member` it forces `userIds = [viewer.userId]` whatever the filter says (a member's filter bar does not offer the Users filter). Owners, admins and managers may filter any users (decision 3).
- Private projects: a member sees entries on a private project only when they are their own (they are); an admin sees all. The project filter's options come from `listPickerProjects` with the same visibility as the tracker.
- A share link is read with no session. The public page builds the viewer from the link: the workspace from the row, the role `admin`-equivalent for reading what the link's query names, but the query is the stored one (a link cannot be edited into a different report by changing the URL). Revoked or expired links render "This link is no longer available." with the same 404 status whether the token never existed or was revoked.
- Exports are created by the signed-in person for their own view; the download of a stored file requires the same session and workspace and is a 15-minute presigned URL on the private export bucket (decision 6). Objects use unguessable keys (`exports/<workspace>/<job uuid>.<ext>`).
- Every query is scoped by `workspace_id`; the engine's SQL is parameterised; grouping keys and sort columns come from fixed vocabularies, never from strings in the URL.

## Part 1 — Report engine

`packages/core/src/reports.ts` (pure): the query schema (`reportQuerySchema`: `range` as a preset or `from`/`to`, `userIds`, `clientIds`, `projectIds` with `none`, `taskIds` with `none`, `tagIds` with `tagMode: and | or`, `billable: all | yes | no`, `description`, `groupBy: [key, key?, key?]`, `bucket?`), the range presets resolved in a timezone and week start (`resolveReportRange`), the time-series bucket rule, the grouped-tree builder (`groupRows`: flat SQL rows → nested groups with per-level totals), and the Weekly grid builder. Unit-tested with a fixed fixture: grouping at one to three levels, every filter, timezone boundaries (Manila and New York, spring forward and fall back), a midnight-crossing entry under its start date, the tag-grouping overlap, and preset resolution across a year boundary.

`apps/web/src/server/reports.ts` (server): one SQL builder on top of Drizzle for the three shapes the pages need: `summary` (grouped totals with `duration`, `billableDuration`, `entryCount` per group, plus the time series), `detailed` (keyset page of entries with their names), `weekly` (rows × days). Aggregation runs in Postgres; the server shapes rows into the DTOs with the core builders. The permission rule above is applied inside the builder. `EXPLAIN (ANALYZE)` output for the summary over one year of the perf seed is checked in under `docs/`.

Route handlers under `/api/w/[slug]/reports/{summary,detailed,weekly}` read the query from the URL (zod), return JSON, `no-store`; the pages SSR the first result into react-query like the tracker does.

## Part 2 — Report pages

`/w/[slug]/reports` redirects to `/reports/summary`. The three pages share `ReportShell`: a filter bar (date preset menu with Today, Yesterday, This/Last week, This/Last month, This/Last year, Custom with two date inputs; Users for team readers; Clients; Projects (with "Without project"); Tasks; Tags with an AND/OR switch; Billable; Description contains) whose state is the URL (`useSearchParams` → `reportQuerySchema`), tabs Summary / Detailed / Weekly that keep the filters, and the Export / Share buttons.

- **Summary**: a bar chart of total time per bucket (stacked billable / non-billable), a donut by the first grouping, and the grouped table with up to three levels, each row collapsible, totals per group and overall, a "Group by" control with three slots. Rows link to the Detailed report filtered to that group.
- **Detailed**: a table of entries (description, project › task, client, user, tags, billable, start, end, duration), sortable by start or duration, a column chooser remembered per browser, 50 a page with "Load more"; own entries editable inline with the tracker's row components and rules; others' read-only (decision 5). Bulk select with Delete for own entries.
- **Weekly**: users (team readers) or projects × the seven days of the range's week, with row, day and grand totals; the range preset menu offers weeks only; cells link to the Detailed report for that person/project and day.

Every total shown is `formatDuration` with the viewer's duration format. The pages work at 375 px: the filter bar collapses into a sheet, tables scroll horizontally, charts stack.

## Part 3 — Exports and sharing

- **Export** menu on every report: CSV, Excel, PDF. CSV and Excel (`exceljs`) are built from the same row records in `packages/core/src/report-export.ts` (column definitions per report, one place Phase 4 adds amount columns); a snapshot test pins the CSV. PDF prints the share-style page (decision 2): title, range, a one-line filters summary, the charts and the table, in A4 portrait, with the theme's light palette.
- Small exports (≤ 10,000 rows and under 4 MB) stream from a route handler with a `Content-Disposition` download. Larger ones create an `export_job` and run after the response (decision 1): the job writes the file under `exports/<workspace>/<job>.<ext>` in the private export bucket, marks the row done and emails "Your export is ready" with a link to Reports → Exports, where the person downloads it (presigned URL, 15 minutes; the file stays 7 days). A failed job says why in the list, with Retry. `EXPORT_JOB_THRESHOLD` (rows) is an env var so the queued path can be exercised locally and in e2e with a small number.
- **Share**: a dialog on each report creates a link (title defaults to the report name and range; optional expiry 7/30/90 days) and shows it with a copy button. `/share/[token]` renders the report read-only without the app shell, with the workspace name, title and range, the same charts and table, an "Open in TimeKeep" footer, and Export (CSV/PDF) for the viewer. A "Shared" list under Reports shows every link of the workspace (team readers) or one's own (members) with opens, expiry and Revoke.

## Part 4 — Dashboard

`/w/[slug]/dashboard` with the range preset menu (default: this week) and tabs:

- **Me**: total time, billable share, top project and top client for the range, a bar chart by day (or week), and "Most tracked" — the top ten descriptions with project and total — each a link to the Detailed report. The running timer counts in today's bar.
- **Team** (team readers, decision 3): one row per active member with their total for the range, their latest entry (description, project, when) and a live dot when a timer is running (polling every 30 s, refetch on focus). A member who has nothing shows "No time yet". Sorted by total.

## Part 5 — Project Status tab

The Phase 2 tab keeps its shape (by task, by member, billable split, date range) but reads from the report engine (`summary` grouped by task and by user for the project), adds Export CSV and "Open in reports", and a small bar chart by week when the range exceeds a month.

## Other changes

- The sidebar's Dashboard and Reports items lose their "coming soon" pages. The tracker's week total and the Summary for the same week must agree: the acceptance check compares them in an e2e test.
- `apps/worker` is untouched; the backlog records "run export jobs in the worker once a worker host exists" (decision 1).
- `pnpm storage:init` creates the private export bucket locally; `.env.example` documents `S3_EXPORT_BUCKET` and `EXPORT_JOB_THRESHOLD`.
- `docs/DATA_MODEL.md` (two tables, the index, the EXPLAIN plans), `docs/PROGRESS.md`, `docs/E2E_COVERAGE.md` (new sections: Reports, Sharing and exports, Dashboard), `CLAUDE.md` (report engine conventions: fixed vocabularies, keyset pages, exports from one row record, share tokens hashed, the private export bucket).

## Tests

- Core: `reports.test.ts` (query schema, presets in two zones across DST and a year boundary, bucket rule, grouping tree with totals at every level, tag overlap, weekly grid), `report-export.test.ts` (CSV snapshot, Excel columns).
- Web integration: `reports.test.ts` against the test database (a fixed fixture of ~40 entries across three users, two clients, three projects, tasks, tags, a midnight-crossing entry, a running entry excluded): every filter, three-level grouping, the member rule, the private-project rule, keyset pagination, weekly totals equal summary totals equal the tracker's `listEntriesInRange` total; `share-links.test.ts` (hashing, expiry, revoke, 404 shapes); `export-jobs.test.ts` (threshold, file written to the local bucket, email captured).
- Perf: `scripts/report-perf.ts` runs the one-year summary against the perf seed and fails when it exceeds one second; run by hand, output recorded in `docs/DATA_MODEL.md`.
- E2E (test-first, lines in `docs/E2E_COVERAGE.md` first): filter by project and tag, group by client › project, switch presets, the three views agree with the tracker's week total, inline edit in Detailed, column chooser, weekly grid, export CSV (download content checked), share link opened in a fresh context shows the same totals, revoke makes it 404, dashboard Me totals and top project, Team tab shows a running member within 30 s (clock-controlled), project status export. A 375 px layout check for the filter sheet.

## Out of scope (later phases)

Amounts, cost and profit columns (Phase 4); editing others' entries (Phase 4); the "members see team reports" setting and manager scopes (Phase 4); plan limits on range and PDF (Phase 8); scheduled report emails; user groups (the filter keeps a placeholder slot in the schema, hidden in the UI).

## Risks

- **One second over 1M entries**: a timezone-converted `date_trunc` over a year of rows may exceed it. Mitigations in order: the partial index above, `work_mem` for the hash aggregate, Postgres parallel aggregation (the perf script reports the plan), and, only if still over, a day-level rollup table maintained by the entry service.
- **Chromium on Vercel**: bundle size and cold start; the PDF route is isolated so a failure there never touches the reports. Fallback if it proves unworkable in the preview: `@react-pdf/renderer` for the table with the charts omitted (decision 2 names the trade).
- **Public share pages**: no session, so the route is rate-limited by token lookups (a miss costs one indexed read) and never reveals whether a token existed.
- **Exports after the response**: a function that is killed before finishing leaves a `queued`/`running` job; the Exports list offers Retry, and the cleanup marks jobs older than 15 minutes in `running` as failed.
