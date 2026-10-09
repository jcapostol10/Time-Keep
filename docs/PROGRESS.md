# Progress

The full phase prompts live in `Clockify Clone — Phased Claude Code Prompt Pack.md` at the repo root. Each phase is one Claude Code session: plan → build part by part (commit each) → `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` → click through acceptance checks → update docs → commit and tag `phase-N`.

## Phase 0 — Foundation

Goal: an empty but deployable app where a user signs up, creates or joins a workspace and lands on a placeholder tracker page.

- [x] 1. Repo scaffold: pnpm workspaces + Turborepo, scripts (`dev`, `build`, `lint`, `typecheck`, `test`, `e2e`, `db:migrate`, `db:seed`), `.env.example`, README, Docker Compose (Postgres, Mailpit, MinIO), GitHub Actions CI
- [x] 2. Schema: user, workspace, membership (role + status enums), invitation, workspace_settings; every tenant table has an indexed `workspace_id`
- [x] 3. Auth: sign up, sign in, sign out, forgot/reset password, email verification, magic link, Google (hidden until credentials set); personal workspace auto-created as OWNER
- [x] 4. Workspace switcher; invite by email (Mailpit); accept invite link; create workspace
- [x] 5. App shell: sidebar with all nav items (unbuilt pages show empty states), top bar with switcher, help, profile menu; responsive to 375px; light/dark
- [x] 6. `requireWorkspaceAccess(slug, minRole)` for every server action and route handler; tenant-isolation tests (`apps/web/src/server/workspace-access.test.ts`, `apps/web/e2e/tenant-isolation.spec.ts`)
- [x] 7. Profile settings: name, avatar upload to MinIO, timezone, date/time format, week start
- [x] 8. Seed: demo workspace `demo` with owner@demo.test / password123, admin, manager, two members
- [x] 9. Docs: CLAUDE.md, docs/PRD.md, docs/DATA_MODEL.md, docs/PROGRESS.md

Acceptance checks:

- [ ] `docker compose up` + `pnpm dev` runs the app locally; CI is green
- [ ] Sign up, verify email in Mailpit, see workspace, invite a second user, accept, switch workspaces
- [ ] Tenant-isolation tests pass

Decisions and deviations from the prompt:

- Pending invites are rows in `invitation`, not `membership` rows with status `INVITED` (the invitee may not have an account yet). The enum value is kept for later use.
- Roles are stored lowercase because Better Auth's organization plugin persists them that way.
- `cacheComponents` is off in Next 16: every page is auth-gated and dynamic.
- A minimal Team page and workspace Settings page were built in Phase 0 because invites and settings needed a UI; Phase 4 expands both.
- Emails are sent directly from the web app; Phase 5 moves sending into the pg-boss worker.

## Phase 1 — Time tracker

- [ ] TimeEntry schema with partial unique index on running entries
- [ ] Timer bar (description autocomplete, project/tag pickers, billable, live clock, manual mode)
- [ ] Entry list grouped by day with totals, inline edit, continue/duplicate/delete + undo, bulk delete
- [ ] Idle detection, Pomodoro, reminders (user settings)
- [ ] Unit, integration (concurrent start) and Playwright tests

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
