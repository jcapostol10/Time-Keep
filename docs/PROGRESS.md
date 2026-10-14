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

## Phase 2 — Projects, clients, tasks, tags, timesheet, calendar

- [ ] Clients, Projects (+ detail tabs), Tasks, Tags
- [ ] Timesheet weekly grid with templates
- [ ] Calendar day/week with drag create/move/resize

## Phase 3 — Reports, dashboard and exports

- [ ] Report engine (SQL aggregation, filters, 3-level grouping, permissions)
- [ ] Summary / Detailed / Weekly pages, exports (CSV, Excel, PDF), share links, large exports via worker
- [ ] Dashboard (Me / Team), Project Status tab

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
