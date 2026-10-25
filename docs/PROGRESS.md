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
- Emails are sent directly from the web app; Phase 5 moves sending into the pg-boss worker.
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

- [ ] Permission matrix (`can(actor, action, resource)`) + docs/PERMISSIONS.md
- [ ] Team page (full), groups, CSV import
- [ ] Rate hierarchy with history and snapshots; amounts in reports
- [ ] Workspace settings (rounding, visibility, required fields, breaks)
- [ ] Add time for others, bulk edit, split, favourites, templates, audit report, import

## Phase 5 — Approvals, time off, attendance, reminders, kiosk

- [ ] Approval periods and state machine; lock dates
- [ ] Time off policies, holidays, requests, balances
- [ ] Attendance/overtime report; targets and reminders
- [ ] Kiosk with PIN/QR

## Phase 6 — Expenses, invoicing, budgets and profit

- [ ] Cost rates and profit; multiple currencies
- [ ] Budgets, estimates, alerts
- [ ] Expenses with receipts
- [ ] Invoicing with payments and recurrence

## Phase 7 — Scheduling and forecasting

- [ ] Assignments, team and project schedules, publishing, forecasting, assignments report

## Phase 8 — Platform

- [ ] Plans and feature flags, billing, public API + OpenAPI, webhooks, SSO/SCIM, audit log, ops

## Phase 9 — Apps

- [ ] Browser extension, mobile PWA, desktop auto tracker
