# Progress

The full phase prompts live in `Clockify Clone — Phased Claude Code Prompt Pack.md` at the repo root. Each phase is one Claude Code session: plan → build part by part (commit each) → `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` → click through acceptance checks → update docs → commit and tag `phase-N`.

## Phase 0 — Foundation

Goal: an empty but deployable app where a user signs up, creates or joins a workspace and lands on a placeholder tracker page.

- [x] 1. Repo scaffold: pnpm workspaces + Turborepo, scripts (`dev`, `build`, `lint`, `typecheck`, `test`, `e2e`, `db:migrate`, `db:seed`), `.env.example`, README, Docker Compose (Postgres, Mailpit, RustFS), GitHub Actions CI
- [x] 2. Schema: user, workspace, membership (role + status enums), invitation, workspace_settings; every tenant table has an indexed `workspace_id`
- [x] 3. Auth: sign up, sign in, sign out, forgot/reset password, email verification, magic link, Google (hidden until credentials set); personal workspace auto-created as OWNER
- [x] 4. Workspace switcher; invite by email (Mailpit); accept invite link; create workspace
- [x] 5. App shell: sidebar with all nav items (unbuilt pages show empty states), top bar with switcher, help, profile menu; responsive to 375px; light/dark
- [x] 6. `requireWorkspaceAccess(slug, minRole)` for every server action and route handler; tenant-isolation tests (`apps/web/src/server/workspace-access.test.ts`, `apps/web/e2e/tenant-isolation.spec.ts`)
- [x] 7. Profile settings: name, avatar upload to S3-compatible storage, timezone, date/time format, week start
- [x] 8. Seed: demo workspace `demo` with owner@demo.test / password123, admin, manager, two members
- [x] 9. Docs: CLAUDE.md, docs/PRD.md, docs/DATA_MODEL.md, docs/PROGRESS.md

Acceptance checks:

- [x] CI is green (lint, typecheck, unit + integration, build, seed, e2e against Postgres, Mailpit and RustFS): https://github.com/jcapostol10/Time-Keep/actions/runs/37971795190
- [x] `docker compose up` + `pnpm dev` runs locally; full gate (lint, typecheck, 29 unit/integration tests, 11 e2e) passed on the dev machine on 2026-10-12 after enabling hardware virtualization for Docker Desktop
- [x] Sign up, verify email in Mailpit, see workspace, invite a second user, accept, switch workspaces — covered by `apps/web/e2e/auth.spec.ts` and `apps/web/e2e/workspace.spec.ts`
- [x] Tenant-isolation tests pass (`workspace-access.test.ts`, `e2e/tenant-isolation.spec.ts`)

Decisions and deviations from the prompt:

- Pending invites are rows in `invitation`, not `membership` rows with status `INVITED` (the invitee may not have an account yet). The enum value is kept for later use.
- Roles are stored lowercase because Better Auth's organization plugin persists them that way.
- `cacheComponents` is off in Next 16: every page is auth-gated and dynamic.
- A minimal Team page and workspace Settings page were built in Phase 0 because invites and settings needed a UI; Phase 4 expands both.
- Emails were sent directly from the web app until Phase 5a, which put the approval emails through the outbox (`email_outbox`); auth and invitation emails are still sent in the request.
- Google OAuth verified end to end on 2026-10-12 (user + `google` account row + auto-created personal workspace). OAuth flows must start and finish on the `NEXT_PUBLIC_APP_URL` host; failures land on `/auth-error`.
- Known gap for Phase 1 (closed in Phase 1): sign-up via Google did not capture the browser timezone. The workspace layout now saves the browser timezone once when `user.timezone` is null.
- Local object storage is RustFS instead of MinIO: MinIO's community images were pulled from Docker Hub during this phase. Same S3 API and ports; bucket setup is a Node script (`pnpm storage:init`) rather than the `mc` CLI.

## Phase 1 — Time tracker

- [x] 1. TimeEntry schema with partial unique index on running entries; project/tag stubs; user_settings; entry service with atomic start (`apps/web/src/server/time-entries.ts`)
- [x] 2. Timer bar (description autocomplete, project/tag pickers with inline create, billable, live clock, manual mode, S/N/Esc, tab title, cross-tab sync)
- [x] 3. Entry list grouped by week and day with totals, consecutive-entry groups, inline edit with optimistic UI, continue/duplicate/delete + 5 s undo, bulk delete, infinite scroll
- [x] 4. Idle detection, Pomodoro, reminders (Timer section on /account); timezone gap for Google sign-ups
- [x] 5. Unit, integration (incl. concurrent start) and Playwright tests; seed data; docs

Acceptance checks:

- [x] Starting a timer, reloading, and stopping 2 minutes later produces one 0:02:xx entry under Today (checked by hand on 2026-10-14: 0:02:11 under Today; `e2e/tracker.spec.ts` covers the same flow with a 3-second timer)
- [x] Typing 1.5 in manual duration saves 1:30:00 (`e2e/tracker.spec.ts`, "add a manual entry with a decimal duration")
- [x] Two browser tabs never show two running timers (`e2e/tracker.spec.ts`, "two tabs never show two running timers"; integration test "two concurrent start requests leave exactly one running entry")

Decisions and deviations from the prompt:

- The partial unique index is `WHERE "end" IS NULL AND deleted_at IS NULL` (the prompt says `WHERE end IS NULL`) so a soft-deleted running row can never block a new timer. Starts are also serialised per user with `pg_advisory_xact_lock`.
- `time_entry.task_id` has no foreign key until Phase 2 creates `task`; there is no task picker yet.
- The running entry is shown only in the timer bar, never in the list. It joins the list when it stops.
- The list pages by week in the viewer's timezone (cursor = week start), so every page is a complete week and day/week totals are exact. Empty weeks are skipped.
- Bare numbers in duration fields are hours (`2` = 2:00:00, `1.5` = 1:30:00).
- Only stopped entries can be deleted. Delete is a soft delete and Undo restores it.
- A timer that passes 999 hours is clamped at 999 hours when stopped instead of being rejected, so a forgotten timer can always be stopped.
- Group rows (consecutive identical entries) show their shared details read-only and expand into editable rows. Editing a group as a whole is bulk edit (Phase 4).
- Idle detection uses the Idle Detection API only when the user granted it from the settings toggle; otherwise a last-input + visibility heuristic that also detects a sleeping machine. Pomodoro and reminders use browser notifications when permitted and fall back to in-app toasts. Reminders run only while TimeKeep is open and fire at most once an hour.
- The timer-bar draft survives navigation inside a workspace but not a full reload.
- The timezone-gap fix sets `user.timezone` only; it does not change any workspace's settings.
- Manual entries may be dated in the future (the prompt limits only timer stops). The first page of the list holds everything from the current week onward and shows later-dated entries under "Upcoming".
- Stops and edits lock the entry row (`SELECT ... FOR UPDATE`) and edits only write the times when the patch changes them, so concurrent tabs or devices cannot restart a stopped timer or drop each other's changes.
- Non-members now get the same 404 "Workspace not found" as an unknown slug from `resolveWorkspaceAccess` (it used to be 403), so neither the new API routes nor server actions reveal whether a workspace exists. 403 remains only for members whose role is too low.
- Duration-format labels in workspace settings now read `1:30:00` / `1:30` (hours are not zero-padded), matching the formatter.

## Deployment — Vercel + Supabase (2026-10-15)

- [x] Vercel project `time-keep` (root `apps/web`, region `sin1`), production at https://time-keep-nine.vercel.app, deployment protection on for every deployment (production domain included).
- [x] One Supabase project `timekeep` (Singapore) for production and previews; app login role `timekeep_app`; verified TLS; RLS on every table; Data API roles revoked; public `timekeep` storage bucket via the S3 endpoint.
- [x] e2e runs on every preview deployment (`.github/workflows/e2e-preview.yml`): seed the e2e tenant, 18 specs, clean up. Green on preview; Docker CI keeps lint, typecheck, unit and integration tests.
- [ ] Production email: Resend needs a verified sending domain. Until then production cannot send sign-up, invite or reset emails; the seeded demo accounts sign in without email.

Design: `docs/superpowers/specs/2026-10-15-vercel-preview-e2e-design.md`. Plan: `docs/superpowers/plans/2026-10-15-vercel-preview-e2e.md`.

## E2E suite (test-driven backfill)

- [x] Foundation: `docs/E2E_COVERAGE.md` with a CI check, `freshUser` / `demoUser` / `trackerPage` fixtures, local cleanup.
- [x] Step 1: tracker tests made independent (fresh user per test).
- [x] Step 2: timer bar (pickers, billable, autocomplete, shortcuts).
- [ ] Step 3: entry list and inline edits.
- [ ] Step 4: timer settings, idle prompt, Pomodoro and reminders (clock-controlled).
- [ ] Step 5: Phase 0 gaps (invite cancellation, role changes, avatar validation, preferences).
- [ ] Step 6: 375px layouts.

Coverage: 95 of 120 functions (2026-10-20; the Phase 0–1 gaps are the steps above). Bugs found by the backfill and fixed: concurrent same-name sign-ups returned 500 (workspace slug race); the tag picker wiped typed text and could drop a tag created just before closing; on a slow connection a project or tag created just before Start was left off the entry (found by the first Vercel preview run; Start now waits for picker creates).

## Phase 2 — Projects, clients, tasks, tags, timesheet, calendar

- [x] 1. Clients page: list with search and status, create/edit (name, address, email, notes, currency placeholder), archive, delete only when unused, project counts (`clients.spec.ts`)
- [x] 2. Projects: list with client/status/billing/access filters, search, sort, favourites, bulk archive, delete with move-or-delete entries; detail pages (Tasks, Access, Status, Settings; Budget and Rates placeholders); picker grouped by client with favourites first and tasks beneath projects (`projects.spec.ts`, `project-detail.spec.ts`, `project-picker.spec.ts`)
- [x] 3. Tasks (assignees, done/reopen, delete keeps entries on the project) and Tags page (usage counts, archive, delete) (`tags.spec.ts`)
- [x] 4. Timesheet: weekly grid, cell maths in core, add row, copy last week, templates, keyboard navigation (`timesheet.spec.ts`)
- [x] 5. Calendar: day/week, drag to create, move and resize, running timer block, overlaps side by side, extension point for external events (`calendar.spec.ts`)

Acceptance checks:

- [x] The same entry shows identically in Time Tracker, Timesheet and Calendar, and editing it in one updates the others (`entry-views.spec.ts`)
- [x] A member cannot see or pick a private project they are not on (`project-picker.spec.ts`, "a member cannot see or pick a private project they are not on"; `project-detail.spec.ts`, "make a project private and pick its members")

Design: `docs/superpowers/specs/2026-10-20-phase-2-design.md`. Plan: `docs/superpowers/plans/2026-10-20-phase-2.md`.

Decisions (the owner agreed on 2026-10-20) and deviations from the prompt:

- Clients, projects, tasks and tags are created and edited by owners and admins only; members see no "Create" in the pickers. A "members too" setting belongs with the Phase 4 admin controls.
- Project detail pages are admin-only in Phase 2; members use the pickers. Phase 4's manager role opens them up.
- Project names are unique per client (`NULLS NOT DISTINCT`, so projects without a client form one group). The old per-workspace index was dropped in the same migration; the owner accepted that the Phase 1 inline create errors during the production build.
- Timesheet rows group by project, task and description, so every entry is visible in exactly one row and the grid total always equals the entry list total. A row whose last entry is cleared stays for the visit (the review reversed the first ruling, under which it left the grid); rows added by hand last for the page visit, templates persist.
- The running timer is not in the timesheet (no duration yet); it is a growing block in the calendar. An entry crossing midnight counts under its start day in the grid and is drawn on both days in the calendar.
- A task marked done cannot receive new time, like an archived project or tag; existing entries keep it. A tag already on an entry may stay while its other tags change; only adding an archived tag is blocked.
- Deleting a project with time asks to move its entries to another project (or none) or delete them (soft delete, no undo). Deleting a task keeps its entries on the project; deleting a tag removes it from entries.
- Favourites are per user and listed in the picker's Favourites group only (not again under the client), so every option name stays unique.
- Tracked hours on the projects list are everyone's for admins and the member's own ("Your time") for members.
- Picker creates still register in `draft-writes.ts` (Phase 1), so Start waits for a project or tag created a moment before.

Bugs found by the tests and fixed in this phase: zod 4 `.partial()` keeps field defaults, so a patch built from an input schema reset untouched fields (archiving a project made it billable, public and client-less); entry rows showed "none" for an archived project or tag because they read names from the picker options; a tags-only patch produced an empty UPDATE (since Phase 1); the calendar drop read the ghost from state that pointer-move batching had not flushed.

Review (2026-10-21): a fresh reviewer read the whole branch (no Critical, 5 Important, 16 Minor findings). Fixed on the branch, each with a test that failed first: the calendar dialog sent every field, so editing an entry on an archived project failed and every save re-parsed the times at minute precision; a tags-only edit re-checked visibility of the entry's own project; the seed was not transactional and the preview job ran it against the unmigrated shared database (it now refuses pending migrations and runs in one transaction, and the **Migrate shared database** workflow applies a branch's migrations ahead of its preview); timesheet cells deleted without Undo and accepted 80 hours; a drop near midnight crossed into the next day, and an empty cell after a midnight-crossing entry filled the next day; a stale picker kept a dead project after a rejected Start; database errors reached the user as SQL. Every deferred finding is in `docs/BACKLOG.md`.

## Phase 3 — Reports, dashboard and exports

- [x] Report engine: one scoped SQL aggregation over stopped entries, every filter, grouping at up to three levels, members pinned to their own time (`reports.test.ts`, `reports.spec.ts`)
- [x] Summary / Detailed / Weekly pages, exports (CSV, Excel, PDF), share links, large exports as jobs (`reports.spec.ts`, `share.spec.ts`)
- [x] Dashboard (Me / Team), Project Status tab on the engine with CSV export (`dashboard.spec.ts`, `project-detail.spec.ts`)

Acceptance checks:

- [x] Totals match between Summary, Detailed, Weekly and the Time Tracker weekly total for the same range (`reports.spec.ts`, "the summary agrees with the tracker's week total" and "the weekly grid by project shows day and row totals that match the summary")
- [x] A shared link opens in a private window and shows the same numbers (`share.spec.ts`, "a share link opens without signing in and shows the same total")
- [x] Summary for one year over 1M seeded entries returns in under 1 second locally: median 757 ms (`pnpm db:seed:perf`, then `pnpm --filter @timekeep/web report:perf`; plans in `docs/DATA_MODEL.md`)

Design: `docs/superpowers/specs/2026-10-23-phase-3-design.md`. Plan: `docs/superpowers/plans/2026-10-23-phase-3.md`.

Decisions (the owner agreed on 2026-10-23) and deviations from the prompt:

- Large exports (over `EXPORT_JOB_THRESHOLD` rows, default 10,000, or over 4 MB) run in the web function after the response (`after()`), not in the pg-boss worker, which has no host yet. The file goes to the private `S3_EXPORT_BUCKET`, is listed under Reports → Exports with a 15-minute presigned download, expires after 7 days, and the owner is emailed. Moving `runExportJob` behind pg-boss is in `docs/BACKLOG.md`.
- PDFs are printed by headless Chromium (`@sparticuz/chromium` on Vercel, Playwright's Chrome locally) from a self-contained HTML template with inline CSS and hand-drawn SVG charts. Recharts draws nothing on the server, so the PDF charts are drawn a second time and look a little different from the screen.
- Owners, admins and managers see everyone's time; members see their own only, whatever the URL says. Phase 4 narrows managers.
- Share links: 32 random bytes in the URL, only the sha256 hash stored, optional expiry (7, 30 or 90 days), revocable from Reports → Shared. A link keeps its creator's query and preferences, reads with the creator's current role, and a revoked, expired or unknown token, or a creator who left, gets the same 404. A shared report too large to stream refuses the export (413).
- The Detailed report edits a person's own entries in place (description, project and task, billable, times, duration); tags and the date stay read-only there. Other people's rows are read-only until Phase 4.
- Reports and the dashboard count stopped entries only. A running timer shows as "Tracking now" on the Team tab, not in today's bar.
- The Status tab's CSV is the Summary export grouped by task then person, so there is one export path.
- Duration sums are `bigint` mapped to `Number`; the Summary's series sums by local day and core's `bucketKeyOfDay` rolls days into weeks and months.

Bugs found by the tests and fixed in this phase: summed durations overflowed a 32-bit integer at 2^31 seconds (found by the perf seed); two quick filter clicks lost the first change; `router.replace` re-rendered the server tree and closed popovers mid-test (filters now use `history.replaceState`); Next 16.4.0's dev server exited under Playwright and 16.4.3 drops a `router.push` followed by `router.refresh` (upgraded with the owner's approval, refreshes removed); a react-query key helper lived in a client module and was called on the server; the manual Add, unlike Start, did not wait for a tag created a moment before and saved the entry without it (since Phase 1).

The preview run then found that Vercel functions shipped without Chromium's binary (the file-tracing keys named dynamic segments literally, and the include glob followed a pnpm link), so PDFs failed there; fixed and seen passing on the preview.

Review (2026-10-25): a fresh reviewer read the whole branch (1 Critical, 5 Important, 10 Minor findings). Fixed on the branch, each with a test that failed first: grouped by Project then Tag, a project's total counted a multi-tag entry once per tag (the levels above a tag level now come from a query without the tag join); a custom range had no upper bound (now a year, and the date inputs clamp); CSV text starting with `=`, `+`, `-` or `@` opened as a formula in Excel; the public share export launched Chromium for anyone with no throttle (now one export per link every 10 s, migration 0008); the Detailed export re-summed the whole range on every page; the Weekly export and share link ignored "People". Spec items the first pass had left out, now built: Summary rows, Weekly cells and dashboard "Most tracked" link to the filtered Detailed report; bulk select and Delete of own entries in the Detailed report; the filter bar folds into a sheet below 768px (its 375px test also found the page 40px too wide: report tabs and the header's workspace switcher); the share title names the range; the Status tab adds weekly bars past a month. Every deferred minor is in `docs/BACKLOG.md`.

## Phase 4 — Team, roles, rates and admin controls

Delivered in two halves (design: `docs/superpowers/specs/2026-10-27-phase-4-design.md`). Phase 4a (plan: `docs/superpowers/plans/2026-10-27-phase-4a.md`):

- [x] Permission matrix (`can(actor, action, resource)`) + docs/PERMISSIONS.md, every action, route and gated page through `authorize` (`permissions.test.ts`, `authorize-coverage.test.ts`, `permissions.spec.ts`)
- [x] Team page (full), groups, CSV import; manager scope (`team.test.ts`, `groups.test.ts`, `invites.test.ts`, `manager-scope.test.ts`, `team.spec.ts`)
- [x] Rate hierarchy with history and snapshots; amounts in reports (`rates.test.ts`, `entry-rates.test.ts`, `rate-recalc.test.ts`, `report-amounts.test.ts`, `rates.spec.ts`, `amounts.spec.ts`)

Phase 4b (plan: `docs/superpowers/plans/2026-10-28-phase-4b.md`):

- [x] Workspace rules: report rounding, hidden pages, who can create, who sees the team's time, required fields, force timer, breaks (`workspace-rules.test.ts`, `entry-rules.test.ts`, `breaks.test.ts`, `rounding.test.ts`, `settings.spec.ts`)
- [x] Add time for others, bulk edit, split, favourites, templates, the Audit tab, CSV import (`add-for-others.test.ts`, `bulk-edit.test.ts`, `split.test.ts`, `favorites.test.ts`, `catalog/templates.test.ts`, `audit.test.ts`, `entry-import.test.ts`; `others.spec.ts`, `power.spec.ts`, `import.spec.ts`)

Acceptance checks for 4b (the design's list):

- [x] A required field blocks Stop (`settings.spec.ts`, "a required project blocks Stop until it is picked"); force timer takes manual entry away from a member; a break stays out of the Summary unless the Type filter asks; rounding rounds the Summary and Raw shows real time
- [x] An admin adds time for a member and the member sees it in their tracker (`others.spec.ts`); bulk edit, split, pin and start a favourite, a project from a template and the Audit tab (`power.spec.ts`); an import dry run and commit (`import.spec.ts`)
- [x] Perf: the one-year Summary with amounts stays under a second with rounding on (364 ms); the recalculation over 1,000,000 entries takes 91.5 s (`docs/DATA_MODEL.md`)

Acceptance checks:

- [x] A Manager sees only their team in reports (`team.spec.ts`, "a manager's scope limits their Summary"; `manager-scope.test.ts`)
- [x] Changing a project rate from today does not change last month's amounts until "apply to past entries" runs (`rates.spec.ts`, "a project rate from today leaves last month's amount alone")

Decisions for 4a (the owner agreed to decisions 1, 2, 4, 9 and 10 on 2026-10-27; decision 3 follows the industry rule at their request):

- A manager's scope is the people they manage (directly or through groups) plus everyone's time on the projects they manage, plus their own. They read time and amounts in it, edit the time of the people they manage, and edit the projects they manage, but not rates and not a project's deletion. A manager with no assignments reads only their own time.
- Members never see amounts. Owners and admins set rates.
- A rate change never re-rates saved entries unless asked ("Entries from a date" or "All entries" run the job). A new entry takes the rate in force at its start; an edit keeps the rate and recomputes the amount; only a new person, project or task, or billable switched on, re-rates.
- One currency per workspace until Phase 6; changing it relabels rates and amounts after a confirmation.
- Deactivate keeps everything for reactivation; remove keeps only the time. Ownership goes to an active admin who confirms by typing the workspace name. Importing users sends invitations.
- The recalculation job runs after the response (`after()`), like export jobs; moving both to pg-boss is in `docs/BACKLOG.md`.

Decisions for 4b (the plan's, plus the rulings made while building; the owner has not reviewed these individually):

- Every rule column defaults to the behaviour before the rule existed. `loadActor` reads `workspace_settings` itself (one primary-key read per request), so the matrix answers hidden pages (a 404 page, a 403 JSON route, as 4a's `authorizePage` does), who can create, who sees the team's time, required fields and force timer.
- Required fields and force timer live in the entry service. A required field blocks Stop and every save (a task only when the project has active tasks; breaks are exempt). Force timer refuses manual times for the actor's own entries only, never time added for someone else, and never a stop with an explicit end (the idle dialog's discard must keep working).
- A break (`time_entry.type = 'break'`) carries no details, needs `allow_breaks`, is never rated and keeps its type for life. Reports count work entries unless the Type filter asks; the timesheet grid lists work only (breaks are tracked in the tracker and the calendar).
- Rounding is a report rule, not a change to entries: the engine reads it from `workspace_settings` with the currency, the URL toggle (`rounding=off`) shows raw time, the Detailed report sorts by raw duration, and the dashboard always shows raw time.
- Adding time for others: the target's own `Viewer` plus `actedBy` (the actor). A member asking for anyone else's time gets a 404 (the scoped "own" rule), not a 403. Writes on an entry id resolve the owner's scope server-side; creates take a `userId`. The timer bar is always the viewer's own.
- Bulk edit is all-or-nothing over the selected entries. A split keeps the rate snapshot on both parts, each at least a second long. A favourite pins details, not times, at most 20 per person; pinning the same details twice is refused.
- Templates: "Save as template" copies the project as "<name> template" (tasks, members, groups and rates, whatever the actor's `rate.set`); "Start from template" prefills the copy dialog, whose own fields win; templates are hidden from the projects list and the pickers.
- The Audit tab is the Detailed report with a filter (`audit`, `shortMinutes`, `longHours` in the query). Its criteria combine with OR; `/reports/audit` without an `audit` param redirects to the defaults (no project, longer than 10 hours).
- Import goes through a route handler (a 4 MB file is over the action body limit). The dry run names the line and field of every problem and its fingerprint guards the commit; the email column follows `entry.write`, so a member's rows for another email are errors; names to create match ignoring case, once per spelling.
- The Detailed report's `editable` follows `entry.write`, so admins and managers edit (and bulk edit) others' entries there. `task.create` for non-admins is exercised through the project picker's inline "Create task". The Clients and Tags pages open to anyone who may create there, with row actions still admin-only.

Bugs found while building 4b and fixed: the bulk edit dialog could apply before an inline tag create had settled and lose the new tag (it now waits for the draft writes); `TimezoneSelect` threw outside a form (the import dialog has no react-hook-form context).

Bugs found while building 4a and fixed: `updated_at` mixed the database's and the app server's clocks, so an update could be stamped before its insert (two time-entry tests flaked); `setProjectMembers` deleted a project's managers with its member list; a new user's personal workspace was always UTC, so "New entries only" missed entries early in their day; the recalculation cursor lost microseconds and looped forever on its last entry (found by the perf run). The final review then found, and this branch fixed: a backdated or "All entries" rate lost to later rows at its level (it now replaces them); Better Auth's organization endpoints let a deactivated admin change roles and remove members (closed with `disabledPaths`; the app writes memberships itself); Better Auth's default limit of 100 invitations and members capped bulk invite and import; a request merged into a waiting job kept that job's cursor and a failed job's entries were left behind (both now fold into one job started over, and polling fails a killed job and starts a stuck one); removing a member deleted their rates, so a later recalculation shifted their past amounts; the reports had no Groups filter.

### Tasks by group (change request, 2026-10-29)

The owner reversed the Phase 4 design's out-of-scope line "task assignees restricting who may track": decision 11 of `docs/superpowers/specs/2026-10-27-phase-4-design.md`; plan `docs/superpowers/plans/2026-10-29-task-groups.md`. Departments are the existing groups. The rule, one line each:

1. Workspace setting "Task visibility": Everyone (default, today) or By group; switching it on confirms with the count of active tasks without a group.
2. A task belongs to one or more groups; people are never assigned to tasks individually.
3. A member sees and tracks an active task only through one of its groups; several groups give the union.
4. Joining a group (Team page, invitation with groups, CSV user import) shows its tasks at once; leaving or deactivation hides them.
5. Only owners, admins and the project's managers create tasks and set their groups; members never (not inline, not through "Who can create", not through CSV import).
6. Owners and admins see every task; managers see their managed projects' tasks plus their own groups'.
7. Tasks with no group are invisible to members; admins and managers see a "No group" badge and filter.
8. On a project with a visible active task the member must pick one; a member's picker lists a project only when it has no active tasks or one they can see.
9. A group given a task on a private project gets the project's access in the same transaction; removing the last task keeps it.
10. Existing entries are untouched: times, description, tags, billable and split still work; project or task changes, Continue, Duplicate and favourites on an unavailable task are refused with "This task isn't available to your groups."
11. Time added for someone else is checked against the entry owner's groups.

Rulings made while planning (the owner approved the plan on 2026-10-29): rule 8 binds on Stop and saves, never Start, for managers and members only, through the required-field plumbing; in By group mode a task is never created without a group, so the picker's inline "Create task" shows only in Everyone mode; the rule 10 refusal is a validation error on every path, crafted ids included; the actor's groups load only in By group mode; the Team page's "Tasks" and "Tasks available" are dialogs from the row menus; `task_creators` and `task_assignee` stay in the schema unread; the demo seed keeps the demo-tenant specs' expectations; the perf seed gains groups and tasks.

- [x] Data: migration 0012 (`task_group`, `workspace_settings.task_visibility`), the assignee UI hidden
- [x] Permissions: `task.trackTime`, `task.assignGroups`, actors carry their groups, tasks leave "who can create"
- [x] Reads: `visibleTasksFor` behind the pickers, filter options and the Tasks tab; the task-list coverage test
- [x] Writes: the check in the entry service on every path, favourites, import; `setTaskGroups` with rule 9
- [x] Templates copy task groups
- [x] UI: the setting and its confirmation, the Tasks tab, the Team page lists, the import's groups for new tasks
- [x] Seed, integration and e2e tests, perf, docs (`task-groups.test.ts`, `task-groups-writes.test.ts`, `task-visibility-coverage.test.ts`, `catalog/tasks.test.ts`, `catalog/templates.test.ts`; `task-groups.spec.ts`; perf in `docs/DATA_MODEL.md`)

Rulings made while building (the owner has not reviewed these individually): rule 8 counts the project's active tasks visible or not, so a project whose tasks are all hidden from a person takes no untasked time from them (it is out of their picker anyway); `createTask` asserts `task.create` itself, so the import's commit and any later caller are held to it; the write-path tests live in one file on one fixture; the new e2e spec runs with a 180-second per-test timeout (each flow builds groups, projects and tasks through the UI); the "invitee" line is guarded by the acceptance hook, since the picker reads group membership in SQL. Two existing tests changed because the assignee UI is hidden: "manage a project's tasks" adds a task with a group instead of an assignee, and the templates test expects task groups on the copy.

Review (2026-10-29): a fresh reviewer read the whole branch (no Critical, 5 Important, 9 Minor findings). Fixed on the branch, each with a test that failed first: rule 8 was skipped by the implicit stop a new timer makes and by a stop through an edit's end; deactivating a member whose running timer had no task on a project with tasks failed on that person's rules (the administrative stop now closes the entry as it is); the import offered to create a project whose tasks were all hidden from the row's person instead of saying so, and its dry run now applies rule 8; a backup file the break-once script left was committed. Every deferred minor and every behaviour the reviewer set aside is in `docs/BACKLOG.md`.

## Phase 5 — Approvals, time off, attendance, reminders, kiosk

Design: `docs/superpowers/specs/2026-10-31-phase-5-design.md` (approved 2026-11-01). Delivered in three parts: 5a (approvals, lock dates, the email outbox and the daily cron; migration 0013), 5b (time off, holidays, attendance, targets; 0014), 5c (kiosk; 0015). Jobs run on Vercel only (the owner's choice): `after()` plus one daily Vercel Cron; the pg-boss worker drains the outbox locally. Holidays are country-neutral (imported per country from a bundled dataset), with the Philippines as the demo's.

### 5a — Approvals and lock dates (plan `docs/superpowers/plans/2026-11-01-phase-5a.md`)

- [x] Core: workspace periods (weekly from the week start, 1–15/16–end, monthly) in the workspace timezone, the lock boundary, the request state machine; the matrix's `approval.submit`, `approval.review` (the approvers setting), `approval.editLocked`, `lock.manage`
- [x] Data: migration 0013 (`approval_request`, `approval_event`, `email_outbox`, the approval and lock columns, `mute_target_reminders`)
- [x] Email outbox: enqueued in the cause's transaction, drained after the response, by `/api/cron/daily` and by the local worker (`/api/cron/outbox`), with retries and `.invalid` skipped
- [x] The write guard on every entry path (`assertWritable`, `writable-coverage.test.ts`); the rate job skips approved periods; deleting a project with submitted time is refused
- [x] Approvals: submit, withdraw, resubmit, approve or reject in bulk with a note, reopen; the Approvals page, a period's page with its history, the period bar on the tracker and timesheet; read-only time; the note prompt for owners' and admins' changes
- [x] Settings: Approval and Lock entries sections; no period change while pending; turning approval off withdraws pending periods after a confirmation
- [x] Daily job: the "submit your time" reminder for a closed period with time and no submission
- [x] Seed, e2e (`approvals.spec.ts`), integration tests (`entry-guard`, `approvals`, `outbox`, `daily-jobs`, `cron-auth`, `writable-coverage`), docs
- [x] Time off policies, holidays, requests, balances (5b)
- [x] Attendance/overtime report; targets and reminders (5b)
- [x] Kiosk with PIN/QR (5c)

Rulings made while building 5a are in the plan's ledger and listed in the branch's hand-off; the notable ones: the lookup of submitted periods ignores `approval_enabled` (approved time stays read-only after approval is turned off); every guarded write and a submission take the person's advisory lock, so a submission's totals never miss an edit the guard let through; empty timesheet cells in locked or submitted days stay typeable and the server refuses the write; the Unsubmitted tab lists, for a manager, the people they manage; members reviewing get a 403 and managers outside the setting a 404.

### 5b — Time off, holidays, attendance and targets (plan `docs/superpowers/plans/2026-11-02-phase-5b.md`)

- [x] Core: request counting (working days less the person's holidays, half days, hours), per-year balances (YEARLY on 1 January, MONTHLY in twelfths that sum to the allowance, no carry-over, NONE plus a negative balance is Unlimited), country-neutral holiday rules (assignees, yearly repeats, 29 February), attendance days and weeks, target rules; the matrix's `timeOff.request`, `timeOff.view`, `timeOff.review` (the approvers setting with no projects), `timeOff.manage`, `attendance.read`, `member.setCapacity`, `target.manage` on a new `person` resource
- [x] The public holiday import: `date-holidays` 3.38.0 (ISC code, CC BY 3.0 data, credited in the dialog and `docs/THIRD_PARTY.md`) as the server-only subpath `@timekeep/core/holiday-import`; the country is suggested from the workspace timezone; public days by default, optional ones on request, never school; Islamic-calendar days marked estimated; a renamed day offered unticked
- [x] Data: migration 0014 (policies, requests, adjustments, holidays, target rules, their assignees; membership capacity; `export_report` gains `attendance`), applied to the shared database by the Migrate workflow
- [x] Requests: under the person's advisory lock, refusing overlaps, two years and a negative balance (pending counts); review in bulk, rejection and cancellation with a note; emails through the outbox; the Time off page (Requests, Calendar, Balances, Policies, Holidays) with a server preview of the balance
- [x] Approved time off and holidays on the timesheet (read-only rows) and the calendar (an all-day band), never in tracked totals or reports
- [x] Capacity per member (Team page) and the Attendance report tab (each person's own days, first in, last out, raw work and breaks, time off, overtime, undertime, weekly subtotals) with CSV, Excel and PDF exports; one-year Attendance 506 ms for 25 people (perf tenant)
- [x] Target rules (Settings) evaluated by the daily job: under-target reminders the person can mute (Profile), over-target alerts to owners, admins and managers, each sent once
- [x] Seed (PH holidays this year and next, Vacation and Sick leave, member1's time off, an inactive target, member2 Sunday to Thursday), e2e (`time-off.spec.ts` on previews; `attendance.spec.ts` nightly), integration tests, docs

Rulings made while planning 5b: balances reckon per calendar year in the workspace timezone (R1); a request stays within one year (R2); time off review follows the approvers setting with no projects, so a project manager reviews only the people they manage (R3); Attendance covers, for a manager, themselves and the people they manage, each person in their own timezone, on raw time (R4). Rulings made while building are in the plan's ledger and the branch's hand-off; notable ones: "Who approves" stays editable with period approval off, since it also decides time off; the request dialog offers only the viewer's assigned policies and previews the balance from the server; a week the Attendance range cuts is measured against its days' capacity, not the weekly hours; requests are counted when made.

### 5c — Kiosk and limited users (plan `docs/superpowers/plans/2026-11-04-phase-5c.md`)

- [x] Core: the throttle maths (`throttleUntil`), the punch state machine, the `tkq1.` QR payload and the kiosk copy; the matrix's `kiosk.manage`, `pin.setOwn`, `member.manageLimited`; `planAllows` gains `kioskPhoto`
- [x] Data: migration 0015 (`kiosk`, `kiosk_assignee`, `kiosk_credential`, `kiosk_attempt`, `kiosk_photo`, `membership.limited`), applied to the shared database by the Migrate workflow
- [x] The Kiosks page: list, create and edit, the device URL shown once with Copy, Rotate URL, Disable
- [x] The kiosk screen `/kiosk/<token>`: no session, the allowed people, PIN pad or QR scan, the actions that fit the person's state, today's work, back to the list after the timeout; works at 375 px and on a tablet
- [x] Punches through the entry service under the person's own viewer at the server's time, so locks, approvals, force timer and required fields apply; a signed 120-second ticket, so the PIN is checked once per visit
- [x] Both PIN throttles, every attempt counted, verification under a per-person advisory lock
- [x] Profile → Kiosk: set or change a PIN, show, print and replace a QR code, per workspace
- [x] Team: Add limited user ("Kiosk only"), set their PIN, show their QR code, Convert to member with a set-password email
- [x] Clock-in photos: an optional kiosk setting with a notice, one JPEG in the private bucket, a camera link on the Detailed row for admins, deleted after 90 days
- [x] Seed (the demo kiosk "Front desk", PIN 1234 for the two members; the URL is printed locally, never in CI), e2e (`kiosk.spec.ts` on previews; `kiosk-extra.spec.ts` nightly), integration tests, docs

Rulings made while building 5c, beyond those in the plan: the person lock covers PIN entry only, so a valid QR code still identifies a PIN-locked person; a failed photo upload never undoes a punch, while an invalid photo refuses it; the daily cron route runs the kiosk purge, leaving `runDailyJobs` as it was; a kiosk on a project with tasks needs a default task, and the kiosk dialog says so; replacing a QR code asks first, because a printed copy stops working; an owner's or admin's punch into submitted time is refused, because a kiosk cannot ask for the note; the kiosk dialog warns about required fields its defaults leave unmet.

## Phase 6 — Expenses, invoicing, budgets and profit

- [x] Cost rates and profit; multiple currencies (Phase 6a, 2026-11-06)
- [x] Budgets, estimates, alerts (Phase 6b, 2026-11-09)
- [x] Expenses with receipts (Phase 6c, 2026-11-10)
- [x] Invoicing with payments and recurrence (Phase 6d, 2026-11-10)

Design: `docs/superpowers/specs/2026-11-05-phase-6-design.md`, written without an interview (the owner said to decide for now and revise later); its 28 decisions are the builder's. Four branches: 6a cost, profit and currencies; 6b estimates, budgets and alerts; 6c expenses; 6d invoicing.

### Phase 6a — cost, profit and currencies (migration 0016)

- Cost rates are `rate` rows with `kind = 'cost'`, per member (Team page: a Cost rate column and "Cost rate" in the row menu) and per project member (the project's Rates tab), in the workspace currency, with history and the same "apply to past entries" job.
- Every work entry carries a cost snapshot beside its billable one. Reports show Cost and Profit to owners and admins, and to managers when "Managers see cost and profit" is on; for everyone else they are zeroed on the server. A new Profit tab ranks projects, clients or people by profit, with margin and its own export.
- A client can be billed in its own currency. An entry's currency is its project's client's, else the workspace's; a rate applies only in its own currency, so a project billed in another currency needs a project rate (the Rates tab says so). Reports, exports, the dashboard and the Status tab list one amount per currency and never add two; profit covers the workspace currency and counts what it leaves out. Nothing is ever converted. Changing a client's currency, or moving a project to a client billed in another one, asks first and relabels.
- Share links and the dashboard never carry cost.

Rulings made while building 6a, beyond the design: totals keep `amountMinor` (the workspace currency) and gain `otherAmounts`, in place of one `amounts[]`; the report engine groups by the entry's currency (the client's), not the stored rate currency, so an unrated hour on a EUR project is left out of profit instead of counting as a loss; a workspace currency change relabels only what follows the workspace, so a client that chose the old code keeps it; moving a project with rates to a client billed in another currency is for owners and admins; a client created by anyone else gets no currency; a person's cost on one project lives on the project's Rates tab, not the Access tab; the Profit route answers 403 and its page 404; a Profit export always streams (no export job, no enum change); the Detailed export prints Rate, Amount and Currency per entry; a plain negative number in a CSV is not prefixed as a formula; no chart plots money yet, so there is no currency selector. `approvals.spec.ts`, `time-off.spec.ts` and `task-groups.spec.ts` moved to the nightly lane to make room on previews.

The final review (2026-11-06) found no cost leak and four defects, fixed with tests that failed first: a split dropped the cost snapshot on its second part; reports trusted the client's current currency, so an amount could show under a code it was not computed in (they now read the entry's own `rate_currency`); copying a project into a client billed in another currency copied rates that could never apply (it now starts without them); and a project relabel also relabelled time rated by member or workspace rates, reading ₱2,500 as $2,500 until a recalculation unrated it (that time now keeps its amount and currency). A rate row left in another currency than its project's is no longer shown as the current rate, so the Rates tab asks for one. One-year Summary over 1,000,000 entries with the new measures, before the review fixes: owner median 553 ms (435 ms before the phase), manager 247 ms, member 39 ms. Keying on the entry's own currency costs about 17% more in a like-for-like run on a busy machine (697 ms with the client's currency as the key, 814 ms with the entry's), still under the 1 s limit; the margin is thinner than before and is in the backlog to watch.

### Phase 6b — estimates, budgets and alerts (migration 0017)

- A project carries one estimate: none, by time (all work on it, billable or not) or by money (its billable amount, in the project's currency), for the whole project or reset every calendar month in the workspace timezone. Tasks take an optional time estimate, shown on the Tasks tab and the Budget tab's task table; they never add up into the project's.
- Progress is computed, never stored, by one aggregate over raw, stopped work entries (no rounding, no scope: it is the project's whole), and shows on the projects list, the project header, the dashboard's top project, the Summary rows grouped by project and the Budget tab (the estimate form, the bar, a cumulative chart against the estimate, the tasks with estimates). Owners, admins and the project's managers see every bar; everyone else a time bar only when "members see the team's time" is on, and a money bar never. Share links never carry progress.
- Alerts: "Budget alert thresholds" in Settings (default 50, 80 and 100 percent; up to five whole numbers from 1 to 200). The daily job measures every live, estimated project with alerts on and emails each threshold crossed once per project, threshold and period, to the active owners and admins and the project's managers, through the outbox.
- The Budget tab is now shown to a project's managers (it set estimates, not rates); `permissions.spec.ts` and `project-detail.spec.ts` changed with it.

Rulings made while building 6b, beyond the design: a member setting an estimate gets the matrix's 403 (never allowed), a manager on a project they do not manage its 404; the budget period and the chart's days follow the workspace timezone (decision 10), so the page needs no viewer preferences; a money estimate counts only amounts rated in the project's currency (`rate_currency`), as the reports key on the entry's own currency since the 6a review; `hasRates` on the Budget tab is a rate row in force in the project's currency at the project level or with no project, not a per-person resolution; a raised estimate does not re-fire a threshold already emailed for the period; alert recipients are owners, admins and the project's managers read directly from `project_member`, not the person-based target recipients; the chart samples weekly points past 62 days instead of bucketing by week; `createTask` takes the estimate as optional so the existing callers compile; `server/estimates.ts` imports nothing from the catalog and the budget service lives in `server/budgets.ts`, so the catalog can import the aggregate without a module cycle. `profit.spec.ts` moved to the nightly lane: with `budgets.spec.ts` the preview lane's test time reached 29 minutes locally (about 9.7 minutes of wall time on three workers), and it was the slowest mature spec at 4.1 minutes.

Gate on the branch: 202 e2e tests against a production build in 17.5 minutes (the five budget tests and the two changed ones were each seen to fail with their behaviour broken, one break per test, before the lines were ticked); `pnpm test` and the lint, typecheck and format checks green; migration 0017 applied to the shared database before the preview.

### Phase 6c — expenses (migration 0018; plan `docs/superpowers/plans/2026-11-09-phase-6c.md`)

- Expense categories (Settings-free: the Expenses page's Categories tab, owners and admins): a fixed amount, or a priced unit (km, pages…) with a billable default; archivable. An expense is a person's and a project's: a category, a local date, an amount or a quantity (the unit price is snapshotted, so a later price change leaves saved expenses alone), billable, a description and an optional receipt. Always in the workspace currency; nothing is converted.
- The Expenses page (Track › Expenses, everyone): the list with the report filters (range, people, groups, clients, projects, categories, billable; this month by default), keyset paging, a footer total, Edit and Delete (with Undo), add-for-others for admins and managers by the entries' rule. Receipts (JPEG, PNG, WebP, PDF, 4 MB) are typed by their bytes, shrunk and thumbnailed in the browser, stored in the private bucket and opened through 5-minute presigned URLs by whoever may read the expense.
- Expenses join approvals and locks: an expense belongs to the period holding its date; the same guard as entries refuses members' and managers' writes into locked or submitted time and asks owners and admins for a note (logged as `ADMIN_EDIT` with the expense); a submission snapshots the period's expense count and total, the period page lists them, and a project-manager approver must manage the expenses' projects too.
- Reports: an Expenses tab (by category, project or person; CSV, Excel, PDF; "Download receipts (zip)", always an export job with an `expenses.csv` manifest), and the Profit tab counts expenses: all of them as cost, billable ones as revenue, with Expenses and Billable expenses columns and the margin over revenue.

Rulings made while building 6c, beyond the design: the expense's free text is `description` and `note` stays the approval note on every write, as for entries; the `invoiced` filter waits for 6d (nothing can be invoiced yet); expense amounts are visible to whoever may see the expense (`report.viewAmounts` governs rated time); the Profit tab's margin divides by revenue (amount plus billable expenses), Summary and Detailed profit stay time-only, and a task, tag or description filter leaves expenses out of Profit (they have none of those); the Profit tab also groups expenses by client (the project's); `deleteProject` refuses while the project has expenses (`ON DELETE RESTRICT`); a member's list is pinned to themselves and scope-filtered; receipt keys are deterministic per expense, so a replacement overwrites and only an orphaned thumbnail is deleted; the receipts manifest prints ISO dates; the unsubmitted-period reminder keeps counting time only.

The final review (2026-11-10) found no cross-tenant or cross-scope leak and six defects, fixed with tests that failed first: an expense on an archived category could not be edited (the dialog fetched active categories only); a category's kind could change under saved expenses (now refused while any exist); the edit dialog previewed the category's current price instead of the expense's snapshot; deleting a project with expenses failed on the foreign key with "Something went wrong." (now a message naming the count, and soft-deleted expenses go with the project); a JPEG named `.png` was refused (the bytes decide the type; only an image/PDF mismatch is refused); a unit price of zero stored an amount of zero (refused). It also found the plan's `expense.read` row (`ownOrTeam` for members) contradicting the spec's access table ("Read and edit others' expenses — Member: no"): members now read only their own, whatever "members see the team's time" says, since money and receipts are not time.

Gate on the branch (2026-11-10): the five Expenses tests and the Profit case each seen to fail with their behaviour broken, one break per test, before the lines were ticked; the preview lane 143 tests in 5.2 minutes of wall time on three workers against a production build, the whole suite 208 in 8.8 minutes, so no spec moved to the nightly lane; `pnpm test` (core 621, web 819), lint, typecheck and format green; `report:perf` one-year Summary owner median 566 ms, manager 215 ms, member 34 ms (the Summary gained no query; the Profit tab reads one more aggregate, not measured by the script); migration 0018 applied to the shared database before the preview.

### Phase 6d — invoicing (migration 0019; plan `docs/superpowers/plans/2026-11-10-phase-6d.md`)

- Invoices (Manage › Invoices, owners and admins; a 404 page and a 403 route for everyone else): one client, that client's currency when created, a number from the workspace sequence (`INV-0001` by default; prefix, next number and padding in the Settings tab; editable on a draft, never reused). Stored status Draft, Sent or Void; Partially paid, Paid and Overdue are computed from the payments and today in the workspace timezone, so a status is never stale.
- A draft takes manual lines (quantity × unit price, rounded per line), a discount and up to two named taxes (each on the discounted subtotal, not compounded), and "Import time and expenses": the client's billable time rated in the invoice's currency and not yet invoiced, for a range and optionally some projects, rounded by the workspace rule and grouped by project, task, person or entry; in the workspace currency, also their billable expenses, per category. The invoice equals the Summary report by construction. Imported time and expenses are then read-only for everyone (a note does not unlock them), the rate job leaves them alone, and Detailed shows an Invoiced badge with an Invoiced filter (also on the Expenses page). Removing a line, deleting a draft or voiding gives them back.
- Sending freezes a PDF in the private bucket and mints a public link (`/invoice/<token>`, only the sha256 stored, no session, noindex, one PDF download per 10 s); "Send email" mails the client with the PDF attached and the link, "Mark as sent only" does not. A sent invoice takes payments up to its balance, and can be voided (its number and PDF stay).
- Recurring templates (the Recurring tab): weekly on a weekday or monthly on a day (31 means the last day), fixed lines and/or the period just ended, as a draft or sent. The daily job creates one invoice per template and period; one set to send whose client has no email stays a draft and the owners and admins are told. The job also emails the owners and admins once when a sent invoice falls overdue.
- Branding (company, address, tax number line, default notes and taxes, payment terms) is in the Settings tab; the logo is the workspace's. The accounting hook is `invoice.external_ref` and an empty adapter registry; nothing calls out.

Rulings made while building 6d, beyond the design: imported lines store the entry and expense ids they took, so removing one releases exactly those; grouping by entry lists one line per entry and one per expense; expenses import per category and only into an invoice in the workspace currency; the overdue and "could not send" emails go to the active owners and admins (the spec named no recipient); a recurring run catches up the periods due in the last seven days (older missed periods are not back-filled), and a send-mode template that cannot send for any reason the service gives leaves the draft and says why; the public PDF is the frozen file (no Chromium on the public path), the admin's PDF of a draft renders live; the `time_entry` partial index was built by the migration (`IF NOT EXISTS`), the shared database's `time_entry` holding only demo and e2e rows; a client's currency is refused a change while it has an invoice that is not void, the workspace's while an open invoice is in it for a client without its own currency, and a project with invoiced time cannot move to another client; the seeded sent invoice bills the owner's own Website time of the week before last, so no other demo person's entries are locked.

Gate on the branch (2026-11-10): the seven Invoices tests each seen to fail with their behaviour broken on a production build, one break per test per round (nine breaks over two rounds), before the lines were ticked; the preview lane 146 tests in 5.3 minutes of wall time on three workers against a production build and the nightly lane 69 in 4.2 minutes (215 in all), so no spec moved lanes; `pnpm test` (core 653, web 862), lint, typecheck and format green; `report:perf` one-year Summary owner median 474 ms, manager 228 ms, member 43 ms (Detailed gained a left join on `invoice`; the Summary none); migration 0019 applied to the shared database before the preview.

The final review (2026-11-10) found one critical and ten important defects, all fixed with tests that failed first: one workspace's recurring template that could not run (an archived client, a used number) stopped the daily job for every workspace after it (each template and each workspace is now isolated, and a failing template emails the owners and admins once per period); the frozen PDF said "Status: Draft" (the frozen file carries no status); a workspace currency change or a project moved to another client relabelled invoiced time (both now refused while it matters); a write the guard had let through could race an import, so the invoice billed an old amount or an entry was deleted after it was invoiced (the guard locks the rows it checks, and the import locks its candidates first); a zero-total invoice went Overdue for ever (nothing owed is Paid); a stale settings form wound the number sequence back into a unique-key failure (the sequence skips used numbers); a day the cron missed lost that period's invoice (the job catches up a week); billable expenses of a client billed in another currency were skipped silently (the preview counts them); void invoices blocked a client's currency change; deleting a client with invoices failed on the foreign key; and two status rules from the plan were reversed: a part-paid invoice past its due date is Overdue, and a template's end date still bills the period that ends on it.

## Phase 7 — Scheduling and forecasting

- [ ] Assignments, team and project schedules, publishing, forecasting, assignments report

## Phase 8 — Platform

- [ ] Plans and feature flags, billing, public API + OpenAPI, webhooks, SSO/SCIM, audit log, ops

## Phase 9 — Apps

- [ ] Browser extension, mobile PWA, desktop auto tracker
