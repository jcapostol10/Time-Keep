# Clockify Clone — Phased Claude Code Prompt Pack

Oct 8, 2026 · @Jose Carlo Apostol

## Product brief

We are building a web-first time tracker and timesheet product with the same job-to-be-done as Clockify: teams log hours against clients, projects and tasks, then turn those hours into reports, approvals, payroll data and invoices. We ship it in ten phases, each a self-contained Claude Code session that ends with a working, tested app.

- **Target users:** agencies, consultancies, dev shops and SMBs with 2 to 200 people. Freelancers are a free-tier wedge.
- **Core loop:** start timer → stop → entry lands on a project → manager sees it in a report → it gets approved, paid or invoiced.
- **Positioning:** feature parity on the core loop first; differentiate later (price, local currency/PH payroll exports, better UX).
- **MVP line:** Phases 0 to 3 are a usable free product. Phases 4 to 6 are what people pay for. Phases 7 to 9 are expansion.

&#91;embedded content: build roadmap · 10 phases, 2 gates\]

Each phase ends tested and committed before the next starts; the two gates are where to pause, use the product, and re-cut scope.

**Guardrails for "copying":** clone the feature set and workflows, not the brand. Use our own product name, logo, colours, copy and illustrations; never scrape or reuse Clockify assets, text or screenshots. Working name in the prompts below is **TimeKeep** — find-and-replace it with the real name.

## Research: what Clockify actually ships

Clockify sells one product in five tiers: Free (up to 5 users), Basic $3.99, Standard $5.49, Pro $7.99 and Enterprise $11.99 per seat per month billed annually (about 20% more monthly). Every active or invited user is a seat; kiosk-only "limited" users are billed at under $3. The tiers tell us what customers value enough to pay for, so our phases follow them. Source: [pricing page](https://clockify.me/pricing), [features page](https://clockify.me/features).

| Module | What it does | Clockify tier | Our phase |
| --- | --- | --- | --- |
| Time tracker | Start/stop timer, manual entry, continue, billable flag, idle detection, Pomodoro | Free | 1 |
| Projects, clients, tasks, tags | Organise time; public or private projects | Free (private: Basic) | 2 |
| Timesheet | Weekly grid, copy last week, templates | Free | 2 |
| Calendar | Day/week view, drag to create, resize to edit, Google/Outlook events | Free | 2 |
| Reports | Summary, Detailed, Weekly; filters, breakdowns, shared live links; PDF/CSV/Excel | Free (1-month range, PDF only) | 3 |
| Dashboard / team activity | Who is working on what right now, time and money charts | Free | 3 |
| Billable rates, decimal format, rounding, historical rates | Earnings maths on entries | Basic / Standard | 4 |
| Add time for others, hide pages, required fields, bulk edit, split entry, favorites, breaks, import | Admin controls | Basic | 4 |
| Manager role, user groups, task rates | Delegated permissions | Standard | 4 |
| Approval and lock timesheets | Submit week or month, approve or reject, lock past periods | Standard | 5 |
| Time off | Policies, holidays, requests, balances | Standard | 5 |
| Attendance and overtime, targets and reminders | Start/end, breaks, overtime report; missed-time emails | Standard | 5 |
| Kiosk | Shared-device clock-in with PIN, QR, photo capture | Basic / Standard / Pro | 5 |
| Invoicing | Invoice from tracked time and expenses, PDF, payments, recurring | Standard | 6 |
| Expenses | Categories, receipts, billable expenses, expense report | Pro | 6 |
| Budgets, estimates, alerts, labor cost and profit, multiple currencies, custom and user fields | Project money control | Pro | 6 |
| Scheduling and forecasting | Assignments on a timeline, capacity, scheduled vs tracked | Pro | 7 |
| API, webhooks | REST API with rate limits by tier; up to 3 webhooks free | Free (limited) | 8 |
| SSO, SCIM, custom subdomain, audit log, control accounts, data region | Enterprise control | Enterprise / Pro | 8 |
| Apps | Browser extension, desktop, mobile, offline tracking, auto tracker, GPS, screenshots | Free / Pro | 9 |

**What we deliberately defer:** activity monitoring agents, screenshots and GPS (privacy-heavy, native apps), 80+ third-party integrations, multi-region hosting and the bundle with sister products.

## Stack, architecture and data model

One TypeScript monorepo, Postgres as the single source of truth, and every query scoped by workspace. This keeps Claude Code effective (one language, one schema) and is easy to run on Vercel + Supabase/Neon or on your own Kubernetes later.

| Layer | Choice | Why |
| --- | --- | --- |
| Monorepo | pnpm workspaces + Turborepo: `apps/web`, `apps/worker`, `packages/db`, `packages/core`, `packages/ui` | Shared types between web, worker and later the extension |
| Web app | Next.js (App Router) + React + TypeScript strict | Server actions for the app, route handlers for the public API |
| UI | Tailwind + shadcn/ui, TanStack Query, react-hook-form + zod | Fast, consistent, accessible components |
| Database | PostgreSQL 16 + Drizzle ORM + migrations | Time maths and reporting want real SQL |
| Auth | Better Auth (email/password, magic link, Google), org plugin for workspaces | Multi-workspace membership out of the box; SSO later |
| Jobs | pg-boss in `apps/worker` | Reminders, recurring invoices, email reports, webhooks without Redis |
| Email / files | Resend (or SMTP) + S3-compatible storage | Receipts, logos, PDF exports |
| Testing | Vitest (unit), Playwright (e2e), seeded demo workspace | Each phase ends green |
| Local dev | Docker Compose: Postgres, Mailpit, MinIO | One command to run |

**Core entities (Phase 0 to 2):** `User`, `Workspace`, `Membership` (role: owner, admin, manager, member), `UserGroup`, `Client`, `Project` (client, colour, billable default, public/private, archived), `ProjectMember`, `Task`, `Tag`, `TimeEntry` (user, project?, task?, description, start, end nullable while running, billable, tags, rate snapshot), `WorkspaceSettings` (week start, time format, duration format, rounding, currency, required fields).

**Later entities:** `Rate` (workspace, user, project, task, effective-from), `ApprovalRequest`, `LockPeriod`, `TimeOffPolicy`, `TimeOffRequest`, `Holiday`, `Kiosk`, `Expense`, `ExpenseCategory`, `Invoice`, `InvoiceItem`, `Payment`, `Budget`, `CustomField`, `Assignment`, `ApiKey`, `Webhook`, `AuditLog`, `Subscription`.

**Non-negotiable rules** baked into every prompt: store all timestamps in UTC and render in the user's timezone; at most one running timer per user per workspace (enforced by a partial unique index); money stored as integer minor units with a currency code; rates snapshotted on the entry so historical reports never shift silently; every query filtered by `workspaceId` and checked against role.

## How to run these prompts

Run one phase per Claude Code session, start each in plan mode, and do not move on until the phase's acceptance checks pass and are committed.

1. Start a fresh session in the repo root and press Shift+Tab into **plan mode**.
2. Paste the phase prompt. Review the plan Claude proposes; push back on scope creep before approving.
3. Let it build. If a phase is large, tell it to work through the numbered parts one at a time and commit after each.
4. Ask it to run `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` and fix failures before it reports done.
5. Click through the acceptance checks yourself in the browser with the seeded demo workspace.
6. Have it update `CLAUDE.md` and `docs/PROGRESS.md`, then commit and tag `phase-N`.
7. `/clear` before the next phase so context starts clean; `CLAUDE.md` and `docs/` carry the memory.

Every prompt assumes `CLAUDE.md`, `docs/PRD.md` and `docs/DATA_MODEL.md` exist from Phase 0, so later prompts stay short and reference them instead of repeating rules.

## Phase 0 — Foundation

Goal: an empty but deployable app where a user signs up, creates or joins a workspace and lands on a placeholder tracker page. Estimate: 1 session.

```text
You are the lead engineer on TimeKeep, a web-based time tracking and timesheet SaaS for teams (functionally comparable to Clockify; do NOT copy its brand, text or assets). We will build it in phases. This is Phase 0: foundation only. Do not build time-tracking features yet.

Stack (use exactly this unless you see a blocking problem, then ask):
- pnpm workspaces + Turborepo. apps/web (Next.js App Router, React, TypeScript strict), apps/worker (Node, pg-boss), packages/db (Drizzle ORM + migrations, PostgreSQL 16), packages/core (domain logic, zod schemas, pure functions), packages/ui (shadcn/ui on Tailwind).
- Auth: Better Auth with email+password, magic link and Google OAuth; use its organization plugin to model workspaces.
- Docker Compose for Postgres, Mailpit (email) and MinIO (S3).
- Vitest for unit tests, Playwright for e2e. ESLint + Prettier. GitHub Actions CI running lint, typecheck, unit and e2e.

Build:
1. Repo scaffold, scripts (dev, build, lint, typecheck, test, e2e, db:migrate, db:seed), .env.example, README with one-command local setup.
2. Schema: User, Workspace, Membership (role enum: OWNER, ADMIN, MANAGER, MEMBER; status: ACTIVE, INVITED, DEACTIVATED), WorkspaceSettings (timezone default, week start day, time format 12h/24h, duration format hh:mm:ss / hh:mm / decimal, currency code). Every tenant table has workspaceId and an index on it.
3. Auth flows: sign up, log in, log out, forgot password, verify email, Google login. After sign-up, auto-create a personal workspace named "<First name>'s workspace" with the user as OWNER.
4. Workspace switcher in the top bar; a user can belong to many workspaces. Invite by email (creates INVITED membership, sends email via Mailpit), accept invite link.
5. App shell: left sidebar with nav items Time Tracker, Timesheet, Calendar, Dashboard, Reports, Projects, Team, Clients, Tags, Settings (non-built pages show an empty state). Top bar with workspace switcher, help, profile menu. Responsive down to 375px. Light and dark theme.
6. A server-side helper `requireWorkspaceAccess(minRole)` used by every server action and route handler; it resolves the current workspace from the URL (/w/[workspaceSlug]/...) and rejects cross-tenant access. Write tests proving a member of workspace A cannot read workspace B.
7. Profile settings: name, avatar upload to MinIO, timezone, date format, time format, week start.
8. Seed script that creates a demo workspace with an owner (owner@demo.test / password123), an admin, a manager and two members.
9. Create these docs and keep them current in every future phase:
   - CLAUDE.md: stack, commands, folder layout, coding conventions, and these invariants: store timestamps in UTC; render in the viewer's timezone; money as integer minor units + ISO currency; every query scoped by workspaceId and role-checked; no feature merges without tests.
   - docs/PRD.md: the product vision and the phase list (Phase 0 foundation; 1 time tracker; 2 projects, clients, tasks, tags, timesheet, calendar; 3 reports and dashboard; 4 team, roles, rates, admin controls; 5 approvals, time off, attendance, reminders, kiosk; 6 expenses, invoicing, budgets, profit; 7 scheduling and forecasting; 8 public API, webhooks, plans and billing, SSO, audit log; 9 browser extension, PWA, desktop auto tracker).
   - docs/DATA_MODEL.md: ER description of current tables.
   - docs/PROGRESS.md: checklist per phase.

Acceptance checks:
- `docker compose up` + `pnpm dev` runs the app locally; CI is green.
- I can sign up, verify email in Mailpit, see my workspace, invite a second user, accept, and switch workspaces.
- Tenant-isolation tests pass.

Work in plan mode first: show me the folder tree, the schema and the list of files before writing code. Commit after each numbered part.
```

## Phase 1 — Time tracker (the core loop)

Goal: the Time Tracker page works as well as the product we are matching. This is the screen users live in, so polish matters more here than anywhere else. Estimate: 1 to 2 sessions.

```text
Read CLAUDE.md, docs/PRD.md and docs/DATA_MODEL.md. This is Phase 1: the Time Tracker page. Projects and tags are minimal stubs in this phase (name + colour only, created inline); Phase 2 fleshes them out.

Data:
- TimeEntry: id, workspaceId, userId, description (text, max 3000), projectId nullable, taskId nullable, tagIds (join table), billable boolean, start timestamptz, end timestamptz nullable (null = running), durationSeconds (computed on stop), createdAt, updatedAt, deletedAt (soft delete).
- Enforce at most ONE running entry per user per workspace with a partial unique index (WHERE end IS NULL). Starting a new timer must atomically stop the running one.

Timer bar (top of page):
- Description input with autocomplete of the user's recent descriptions (picking one also fills its project, task, tags and billable).
- Project picker (search, create inline), tag multi-select (create inline), billable $ toggle, live elapsed clock, Start/Stop button.
- Toggle between Timer mode and Manual mode. Manual mode: start time, end time, date, duration field that accepts 1:30, 1.5, 90m, 1h30m; end before start rolls to the next day.
- Running timer survives page reload and shows in the browser tab title (e.g. "0:42:10 · Design review").
- Keyboard: S to start/stop, N to focus description, Esc to blur.

Entry list (below):
- Grouped by day (Today, Yesterday, then dates) with a daily total and a weekly total header; infinite scroll.
- Consecutive entries with the same description + project + tags + billable are collapsible into one group showing a count.
- Each row inline-editable: description, project, tags, billable, start, end, date, duration. Saves on blur with optimistic UI and rollback on error.
- Row actions: Continue (starts a new timer with the same details), Duplicate, Delete (with 5-second Undo toast).
- Multi-select with checkboxes and bulk delete (bulk edit comes in Phase 4).

Rules:
- Duration display follows WorkspaceSettings.durationFormat; times follow the user's timezone and 12h/24h setting.
- An entry that crosses midnight stays one entry and appears under its start date.
- Server validates: end > start, no future end beyond now + 1 minute for timers, max single entry 999 hours.
- Idle detection (web): if the tab regains focus after N minutes of system idle while a timer runs (use the Idle Detection API when permitted, else visibility + last-input heuristic), ask: keep time, discard idle time, or discard and start new. N is a user setting, default 15, off by default.
- Optional Pomodoro: user setting for focus/break lengths; show a notification at each boundary.
- Reminders: a user setting to show a browser notification if no timer is running during their configured working hours.

Tests:
- Unit tests for duration parsing/formatting and the midnight and timezone cases (Asia/Manila, America/New_York, a DST transition).
- Integration test that two concurrent start requests leave exactly one running entry.
- Playwright: start, stop, edit duration inline, continue, delete + undo, manual entry.

Acceptance checks:
- Starting a timer, reloading, and stopping 2 minutes later produces one 0:02:xx entry under Today.
- Typing 1.5 in manual duration saves 1:30:00.
- Two browser tabs never show two running timers.

Update CLAUDE.md, docs/DATA_MODEL.md and docs/PROGRESS.md. Plan first, then build.
```

## Phase 2 — Projects, clients, tasks, tags, timesheet, calendar

Goal: time can be organised properly and entered three ways (timer, weekly grid, calendar). Estimate: 2 sessions; split at part 4 if needed.

```text
Read CLAUDE.md and docs/. This is Phase 2. Replace the Phase 1 project/tag stubs with full entities and add the Timesheet and Calendar views. Keep existing time entries working (write a migration).

Part 1 — Clients: list page with search, create/edit (name, address, email, notes, currency placeholder), archive/unarchive, delete only when unused. Show project count per client.

Part 2 — Projects:
- Fields: name (unique per client), client nullable, colour (palette of 20), billable by default, visibility PUBLIC (any member can track) or PRIVATE (only listed members/groups), note, archived, template flag (used in Phase 4).
- Projects list: table with name, client, tracked hours, progress bar (if estimate set later), access, favourite star; filters by client, status (active/archived), billing, access; sort; search; bulk archive.
- Project detail page with tabs: Tasks, Access (members), Status (tracked time by task and by member for a date range), Settings. Leave tabs Budget and Rates as empty states for later phases.
- Project picker everywhere is grouped by client, supports search, shows favourites first, and "Create project" inline.

Part 3 — Tasks and tags:
- Task: name, projectId, assignees (users), status ACTIVE/DONE. Picker shows project → task as a two-level list. Selecting a task implies its project.
- Tags page: create, rename, archive, delete; usage count.

Part 4 — Timesheet view (/timesheet):
- Weekly grid: rows = project + task (+ optional description), columns = 7 days starting at the workspace week start, cells accept durations in any format from Phase 1, row and column totals, grand total.
- Typing in an empty cell creates one entry for that day (start at 09:00 local by default, or after the last entry that day). Editing a cell that maps to several entries adjusts the last one, or shows a popover listing them if the new total is lower than the sum of the others.
- "Add new row", "Copy last week" (rows only, or rows + time), "Save as template" and "Apply template".
- Week navigation, Today button, keyboard navigation between cells with arrows/Tab.

Part 5 — Calendar view (/calendar):
- Day and week views, 15-minute grid, current-time line, each entry as a coloured block (project colour) with description and duration.
- Drag on empty space to create an entry (opens a quick popover for description/project/tags), drag a block to move, drag its edges to resize, click to edit. Overlaps render side by side.
- Running timer shows as a growing block.
- Leave a clearly marked extension point for importing Google/Outlook calendar events in a later phase; do not build OAuth calendar sync now.

Rules: archived projects/tasks cannot receive new time but keep historical entries; deleting a project with time requires choosing to delete or reassign its entries; private projects are hidden from non-members in every picker and list.

Tests: access rules for private projects; timesheet cell math (create, increase, decrease across multiple entries); calendar drag/resize updates start/end correctly across timezones; Playwright happy paths for all three entry methods.

Acceptance checks:
- The same entry shows identically in Time Tracker, Timesheet and Calendar, and editing it in one updates the others.
- A member cannot see or pick a private project they are not on.

Update docs. Plan first.
```

## Phase 3 — Reports, dashboard and exports

Goal: managers can answer "who worked on what, for how long" for any date range, and share or export it. This completes the free-tier MVP. Estimate: 2 sessions.

```text
Read CLAUDE.md and docs/. This is Phase 3: Dashboard and Reports. Amounts (money) are placeholders until Phase 4 adds rates; design the report engine so adding amount, cost and profit columns later is a column addition, not a rewrite.

Part 1 — Report engine (packages/core + SQL):
- One query builder that takes: date range, timezone, filters (users, user groups placeholder, clients, projects, tasks, tags with AND/OR mode, billable yes/no/all, description contains, "without project", "without task"), and grouping (up to 3 levels from: project, client, user, task, tag, date, week, month, description).
- Returns totals (duration, billable duration, entry count) per group and an overall total. Push aggregation into Postgres; no loading all entries into memory. Add the indexes it needs and show EXPLAIN plans for a 1M-entry seed.
- Respect permissions: members see only their own time unless the workspace allows otherwise; admins see all.

Part 2 — Report pages (/reports/summary, /reports/detailed, /reports/weekly):
- Shared filter bar with date-range presets (today, yesterday, this/last week, this/last month, this/last year, custom), saved in the URL so any view is linkable.
- Summary: bar chart of total time per day (or per week/month for long ranges), donut by top grouping, and a collapsible grouped table.
- Detailed: paginated list of individual entries with inline edit (same rules as Time Tracker), column chooser, sort.
- Weekly: users or projects × 7 days grid with totals.
- Use Recharts; charts must be legible in dark mode.

Part 3 — Exports and sharing:
- Export current report to CSV, Excel (.xlsx via exceljs) and PDF (server-rendered with headless Chromium or @react-pdf). PDF includes title, date range, filters summary and charts.
- "Share" creates a read-only public link with a random token (revocable, optional expiry) that renders the same report without login.
- Exports over 10,000 rows run as a pg-boss job and email a download link.

Part 4 — Dashboard (/dashboard):
- "Me" and "Team" tabs. Total time, top project, top client for the selected range; bar chart by day; most-tracked activities list.
- Team tab (admins/managers): each member's latest activity and whether they are tracking right now (live via polling every 30s or SSE).

Part 5 — Project Status tab: tracked time by task and member for the project, date-range filter, export.

Tests: report-engine unit tests with a fixed fixture (grouping, filters, timezone boundaries, entries crossing midnight split by date); permission tests; snapshot test of CSV output; Playwright for filtering, grouping and share link.

Acceptance checks:
- Totals match between Summary, Detailed, Weekly and the Time Tracker weekly total for the same range.
- A shared link opens in a private window and shows the same numbers.
- Summary for one year over 1M seeded entries returns in under 1 second locally.

Update docs. Plan first.
```

## Phase 4 — Team, roles, rates and admin controls

Goal: a company admin can run a real team: delegated managers, groups, hourly rates that turn time into money, and the guardrails that keep data clean. Estimate: 2 sessions.

```text
Read CLAUDE.md and docs/. This is Phase 4. Build a single permissions module first, then features on top of it.

Part 1 — Roles and permissions (packages/core/permissions.ts):
- Roles: OWNER (one per workspace, transferable), ADMIN, MANAGER, MEMBER. Manager scope = the projects they manage (Project Manager) and/or the users/groups they manage (Team Manager).
- A single `can(actor, action, resource)` function with a permission matrix documented in docs/PERMISSIONS.md and covered by table-driven tests. Every server action and route handler uses it.

Part 2 — Team page:
- Members table: name, email, role, groups, billable rate, cost rate (hidden until Phase 6), status; filters; invite (single and bulk by pasting emails), resend invite, deactivate (frees a seat), reactivate, remove.
- User groups: CRUD, add members, use groups in project access and report filters.
- Import users from CSV with a preview/validation step.

Part 3 — Rates:
- Billable hourly rate hierarchy, most specific wins: task rate → project-member rate → project rate → member rate → workspace default. Store rates in a Rate table with effectiveFrom so history is kept.
- On every entry save, snapshot the resolved rate and currency onto the entry. "Apply to past entries from date X" (historical rates) recalculates snapshots in a background job and shows progress.
- Reports gain Amount columns and totals; billable vs non-billable split.

Part 4 — Workspace settings (admin):
- Duration format (incl. decimal), rounding in reports (up/down/nearest, to 1/5/6/10/12/15/30/60 min; display-only, raw data unchanged), week start, default currency.
- Who can see what: hide Projects/Team/Reports pages from members; whether members see others' time; who can create projects, clients, tasks, tags.
- Required fields on time entries (project, task, tag, description); enforced server-side with clear errors.
- Force timer (disallow manual entry and editing start/end) — gate behind a plan flag stub for Phase 8.
- Breaks: allow tracking entries of type BREAK, excluded from billable totals.

Part 5 — Power features:
- Add time for others: admins/managers pick a user in Time Tracker, Timesheet and Calendar.
- Bulk edit time entries (project, task, tags, billable, description) from Time Tracker and Detailed report.
- Split entry at a chosen time; favourite (pinned) entries at the top of Time Tracker.
- Project templates: create project from template copying tasks, members, rates and settings.
- Time audit report: entries without project/task, shorter than X or longer than Y.
- Import time entries from CSV with column mapping and dry-run.

Tests: permission matrix; rate resolution (all five levels + effectiveFrom); rounding math; required fields; managers cannot see users outside their scope.

Acceptance checks: a Manager sees only their team in reports; changing a project rate from today does not change last month's report amounts until "apply to past entries" is run.

Update docs. Plan first.
```

## Phase 5 — Approvals, time off, attendance, reminders, kiosk

Goal: the HR and payroll side — time that is officially approved and locked, leave that is tracked, and clock-in from a shared device. Estimate: 2 to 3 sessions; run each part as its own session if context gets heavy.

```text
Read CLAUDE.md, docs/ and docs/PERMISSIONS.md. This is Phase 5. Emails go through the worker (pg-boss) and Mailpit locally.

Part 1 — Approval:
- Workspace setting: approval period WEEKLY or SEMI-MONTHLY or MONTHLY; who approves (admins, team managers, project managers).
- Member submits a period (time entries + later expenses). Status: PENDING → APPROVED or REJECTED (with note) → can be withdrawn while pending. Submitted/approved entries are read-only for the member; admins can edit with an audit note.
- Approvals page: tabs Pending, Unsubmitted, Archive; approve/reject in bulk; per-user period view with totals.
- Emails: submitted, approved, rejected, and a weekly reminder for unsubmitted periods.

Part 2 — Lock timesheets: admin sets a lock date (fixed or rolling, e.g. lock everything older than 7 days, recalculated daily). Non-admins cannot create or edit entries before it. Server-side enforced.

Part 3 — Time off:
- Policies: name, unit DAYS or HOURS, accrual (none, yearly allowance, monthly accrual), negative balance allowed, requires approval, assigned users/groups.
- Holidays: per-workspace list with recurring yearly option, assignable to users/groups; seed an optional Philippines regular-holiday set as an example.
- Requests: member requests (full/half day or hours, note), approver approves/rejects, balance updates. Time off page with calendar of who is away, requests list, balances per user.
- Approved time off shows in Calendar, Timesheet and the Attendance report.

Part 4 — Attendance and overtime report: per user per day — first start, last end, tracked work, breaks, time off, overtime vs a per-user daily/weekly capacity (setting on the member, default 8h/40h). Export CSV/Excel/PDF.

Part 5 — Targets and reminders: admin configures rules like "remind members who tracked less than X hours by end of day/week" or "alert when someone tracked more than Y hours"; daily job sends emails; members can mute.

Part 6 — Kiosk:
- Admin creates kiosks (name, default project, allowed users/groups, session timeout, logo). A kiosk gets a long-lived device URL with its own token, no user login.
- Users clock in/out and start/stop breaks using a 4–6 digit PIN (hashed, per user) or a personal QR code scanned by the device camera. Optional photo capture on clock-in stored to S3 (behind plan flag; show a consent notice).
- Limited users: members with no email who can only use kiosks.
- Kiosk screen shows today's worked time for the user after punch.

Tests: approval state machine; lock enforcement across all write paths (tracker, timesheet, calendar, bulk edit, import, API); accrual math; overtime calculation; kiosk PIN brute-force throttling.

Acceptance checks: an approved week cannot be edited by its member; time off reduces balance and appears on the calendar; kiosk punch creates a normal time entry visible in reports.

Update docs. Plan first.
```

## Phase 6 — Expenses, invoicing, budgets and profit

Goal: agencies can bill clients from tracked time and expenses, and see whether each project makes money. Estimate: 2 to 3 sessions.

```text
Read CLAUDE.md and docs/. This is Phase 6. All money is integer minor units + ISO currency; never use floats for money.

Part 1 — Cost rates and profit: add labor cost rate with the same hierarchy and effectiveFrom history as billable rates (member, project-member). Snapshot cost on entries. Reports gain Cost and Profit columns and a profitability view per project/client/user. Cost and profit are visible only to admins (configurable for managers).

Part 2 — Multiple currencies: workspace default currency plus per-client currency. Rates on a client's projects are in that client's currency. Reports either group by currency or show a currency selector; no FX conversion in v1 (document this).

Part 3 — Budgets, estimates, alerts:
- Project estimate by time or by money, either total or reset monthly; optional per-task estimates.
- Project progress bar everywhere a project appears; Budget tab with tracked vs estimate over time.
- Alerts: notify project managers/admins by email when a project reaches 50/80/100% (configurable) of its estimate; send once per threshold per period.

Part 4 — Expenses:
- Categories: name, unit-based (price per unit, e.g. mileage) or fixed amount, billable default, archived.
- Expense: user, project, category, date, amount or quantity, billable, note, receipt upload (image/PDF to S3, thumbnail).
- Expenses page with filters; Expense report with totals and receipts zip download. Expenses join approvals (Phase 5) and lock dates.

Part 5 — Invoicing:
- Invoice: client, number (configurable sequence with prefix), issue date, due date, currency, line items, tax (up to 2 named taxes, percent), discount, notes, status DRAFT → SENT → PARTIALLY_PAID / PAID / OVERDUE / VOID.
- "Import time and expenses" into an invoice: pick date range + projects; group line items by project, task, user or entry; mark imported entries as invoiced so they cannot be invoiced twice (and show an invoiced badge in reports).
- Manual line items for fixed fees.
- Branding settings: company logo, address, default notes, payment terms.
- PDF download (same renderer as reports), email to client with PDF attached, public view link.
- Record payments (date, amount, note) and compute balance due; overdue job marks invoices daily.
- Recurring invoices: schedule (weekly/monthly), auto-create as draft or auto-send.
- Leave a hook for a later QuickBooks/Xero sync; do not build it.

Tests: rate and cost snapshots; budget threshold alerts fire exactly once; invoice math (rounding per line vs total — choose per-line and document); double-invoicing prevention; recurring generation dates across month ends.

Acceptance checks: an invoice built from last month's billable time for one client equals the Amount total in the Summary report filtered the same way; marking it paid updates status and balance.

Update docs. Plan first.
```

## Phase 7 — Scheduling and forecasting

Goal: managers plan who works on what next and compare the plan with what was actually tracked. Estimate: 1 to 2 sessions.

```text
Read CLAUDE.md and docs/. This is Phase 7: Scheduling.

Data: Assignment — user, project, optional task, start date, end date, hours per day (or total hours spread across working days), include non-working days flag, note, published flag, recurrence (weekly, every N weeks, until date). Milestone — project, date, name.

Part 1 — Team schedule (/schedule/team): rows = members, columns = days (week, 2-week, month zoom). Assignments as coloured bars (project colour). Each row shows capacity per day (from member capacity, minus holidays and approved time off) and a heat indicator: under, at, over capacity. Drag to create, drag to move, drag edges to resize, Alt-drag to copy, right-click split.

Part 2 — Project schedule (/schedule/projects): rows = projects, showing milestones as diamonds on a timeline and total assigned hours; expand a project to see its members' assignments.

Part 3 — Publishing: changes are drafts until a manager clicks Publish; publishing notifies affected members by email with their upcoming assignments. Members see only published assignments in a "My schedule" view and as a faint overlay in their Calendar.

Part 4 — Forecasting on the project Budget tab: line for tracked to date + scheduled future hours vs the estimate, projected completion date and projected overrun in hours and money.

Part 5 — Assignments report: scheduled vs tracked per user/project/date with variance; export.

Performance: the team grid must stay smooth with 100 members × 3 months; virtualise rows and columns.

Tests: capacity math with holidays/time off; recurrence expansion; forecast math; permission (members cannot edit assignments).

Acceptance checks: assigning someone 10h/day shows them over capacity in red; forecast predicts overrun when scheduled + tracked exceeds the estimate.

Update docs. Plan first.
```

## Phase 8 — Platform: API, webhooks, plans and billing, SSO, audit log

Goal: turn the app into a sellable SaaS — paid tiers, an API others can build on, and the enterprise controls large customers ask for. Estimate: 2 to 3 sessions.

```text
Read CLAUDE.md and docs/. This is Phase 8.

Part 1 — Plans and feature flags:
- Plans: FREE (max 5 users, reports limited to 1-month range, PDF export only, public projects only), BASIC, STANDARD, PRO, ENTERPRISE. Write docs/PLANS.md mapping every feature built so far to the minimum plan, following the phase-to-tier mapping in docs/PRD.md.
- One `hasFeature(workspace, feature)` used by UI (show upgrade prompts, not broken buttons) and server (hard enforcement). Replace every earlier plan stub with it.
- 7-day trial of PRO on new workspaces.

Part 2 — Billing:
- Per-seat subscriptions, monthly or annual (annual ≈ 20% off), seats = active + invited members; deactivated users free a seat; mid-cycle seat changes prorated.
- Implement behind a PaymentProvider interface with a Stripe adapter first and a stub for a local provider (e.g. PayMongo or Xendit for PHP cards/e-wallets) to be built later.
- Subscription page: current plan, seats, invoices from the provider, upgrade/downgrade, cancel (downgrade to FREE at period end, no data loss). Handle provider webhooks idempotently.

Part 3 — Public REST API v1 (/api/v1):
- API keys per user (hashed, shown once), scoped to workspace; header X-Api-Key.
- Resources: workspaces, users, groups, clients, projects, tasks, tags, time-entries (incl. start/stop timer), reports (summary/detailed), expenses, invoices, time-off requests, assignments.
- Cursor pagination, consistent error shape, rate limits by plan (FREE ≈ 30 requests/hour, paid ≈ 50 requests/second) with standard rate-limit headers.
- Generate an OpenAPI 3.1 spec from the zod schemas and serve docs at /api/docs.

Part 4 — Webhooks: subscribe to events (time entry created/updated/deleted, timer started/stopped, project created, approval status changed, invoice paid, etc.); HMAC-SHA256 signed payloads, retries with exponential backoff, delivery log with replay. Limit count by plan (FREE 3).

Part 5 — Enterprise:
- SSO via SAML 2.0 and OIDC per workspace (use Better Auth's SSO plugin or BoxyHQ SAML Jackson), enforce SSO option.
- SCIM 2.0 user and group provisioning endpoint.
- Custom subdomain (acme.timekeep.app) mapping to a workspace.
- Audit log: append-only table recording actor, action, resource, before/after diff, IP, user agent for every write; filterable UI and CSV export; retention setting.
- Control accounts: admins can impersonate a member with a visible banner, every action audit-logged.

Part 6 — Ops: structured JSON logs, OpenTelemetry traces and metrics (HTTP, DB, jobs), /healthz and /readyz, Sentry for errors, nightly DB backup script, Dockerfiles for web and worker, and a short docs/DEPLOY.md for Vercel + Neon/Supabase and for Kubernetes.

Tests: feature gating server-side for every gated action; billing webhook idempotency; API contract tests from the OpenAPI spec; webhook signature verification; audit entries for each write path.

Acceptance checks: a FREE workspace cannot invite a 6th user or export Excel via UI or API; upgrading unlocks it instantly; a webhook to a request bin receives signed events.

Update docs. Plan first.
```

## Phase 9 — Apps: browser extension, mobile PWA, desktop auto tracker

Goal: track time without opening the web app. Every client talks only to the Phase 8 API. Estimate: 1 session per app; build them in this order.

```text
Read CLAUDE.md, docs/ and the OpenAPI spec. This is Phase 9. Build a shared TypeScript API client package (packages/api-client) generated from the OpenAPI spec, then the apps below, each in its own session.

9a — Browser extension (apps/extension, Manifest V3, Chrome + Firefox + Edge):
- Popup with the Phase 1 timer bar and today's entries; sign in via OAuth device-style flow or by pasting an API key.
- Badge shows elapsed time while running; context-menu "Start timer with selected text".
- "Start timer" buttons injected into a small, configurable set of web apps (start with GitHub issues/PRs, Jira, Trello, Asana) that pre-fill description with the item title and link. Integration adapters live in one folder, one file per site, so adding sites is easy.
- Idle detection via chrome.idle; reminders via notifications.

9b — Mobile PWA (inside apps/web): installable, responsive Time Tracker, Timesheet and Expenses (camera capture for receipts) screens; offline queue in IndexedDB that syncs when online with conflict rules (server wins on edited entries, client entries created offline are appended); push notifications for reminders. Document what a later React Native app would add.

9c — Desktop app (apps/desktop, Tauri): tray/menu-bar timer, global shortcut, idle detection, and an opt-in local Auto tracker that records active app and window title locally only, shows a daily timeline, groups by app, and lets the user convert blocks into time entries. Nothing auto-tracked is uploaded unless the user converts it. Code-sign and auto-update are out of scope; document the steps.

Acceptance checks: start a timer in the extension, stop it from the PWA, and see one entry in the web app; go offline on the PWA, log an entry, reconnect, and it syncs once.

Update docs. Plan first.
```

## Reusable prompts and backlog

Use these between phases; they catch most of the drift that builds up across long multi-session builds.

**Phase review (run at the end of every phase, ideally with a fresh session):**

```text
Act as a strict reviewer who has not seen this code. Read docs/PRD.md and the Phase N prompt in docs/PROGRESS.md, then audit the repo against it. List: (1) acceptance checks that fail or are untested, (2) any query not scoped by workspaceId or not permission-checked, (3) timestamp or money handling that breaks the CLAUDE.md invariants, (4) missing tests for edge cases, (5) UX gaps versus the spec. Do not fix anything yet; give me a prioritised list with file paths.
```

**Security pass (after Phases 4, 6 and 8):**

```text
Run a security review of the app: tenant isolation, IDOR on every route and server action, auth/session handling, CSRF, file upload validation (receipts, logos, avatars), public share links and kiosk tokens, API key storage, rate limiting, webhook signing. Write failing tests for each issue found, then fix them one at a time.
```

**UX polish pass (after Phases 1, 2 and 3):**

```text
Use Playwright to screenshot every page at 1440px and 375px in light and dark mode with the seeded demo data. Review them for alignment, empty states, loading skeletons, error states, keyboard focus, and WCAG AA contrast. Fix the top 10 issues and show before/after screenshots.
```

**Demo data refresh:**

```text
Update the seed script so the demo workspace exercises every feature built so far: 3 clients, 8 projects (public and private, with estimates), tasks, tags, 6 users across all roles and 2 groups, 90 days of realistic time entries, expenses, one approved and one pending week, time-off requests, assignments and two invoices.
```

**Out of scope for now (backlog):** third-party integrations beyond the extension adapters and QuickBooks/Xero sync; Google/Outlook calendar sync; GPS location and route tracking; screenshots and activity monitoring; native iOS/Android apps; data-region hosting; localisation into other languages; AI features (auto-categorising entries, timesheet anomaly detection).
