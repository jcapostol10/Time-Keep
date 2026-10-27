# Phase 4 — Team, roles, rates and admin controls: design

Prompt: "Phase 4 — Team, roles, rates and admin controls" in `Clockify Clone — Phased Claude Code Prompt Pack.md`. Checklist: `docs/PROGRESS.md` § Phase 4. Builds on the Phase 2 catalog, the entry service and the Phase 3 report engine. Written from the prompt without an interview (the owner chose to skip questions); every call below that the prompt does not make is marked as the builder's, so it can be checked while reading.

## Goal

A company admin runs a real team in TimeKeep: delegates managers who see and fix only their own people's or projects' time, organises people into groups, puts hourly rates on the work so reports show money, and sets the guardrails (required fields, rounding, who sees and creates what) that keep the data clean. Every permission question has one answer, from one function, documented in one table.

The phase opens the PRD's paid tiers (Basic and Standard). Plan limits arrive in Phase 8; here every workspace gets every feature, and the one gated setting (force timer) asks a stub that always says yes.

## Delivery: two halves

The prompt estimates two sessions. The work ships as two branches, each merged, deployed and e2e-tested on its own, so each review and each shared-database migration is a manageable size:

- **Phase 4a — permissions, team, rates** (Parts 1–3): `can()` and the matrix, manager scopes, groups, the Team page, user import, the rate hierarchy, snapshots, the recalculation job, and amounts in reports. Migration `0010_phase4a`.
- **Phase 4b — settings and power features** (Parts 4–5): rounding, visibility and creation settings, required fields, force timer, breaks, add time for others, bulk edit, split, favourites, project templates, the time audit report, CSV import of entries. Migration `0011_phase4b`.

Each half gets its own implementation plan, written when it starts (the 4b plan is written against the code 4a leaves). `phase-4` is tagged after 4b's acceptance checks pass.

## Decisions (builder's calls; check these first)

1. **What a manager's scope means.** A manager is given people (directly or through groups: "Team Manager") and/or projects ("Project Manager"). Their scope is the union: entries by the people they manage on any project, plus every entry on the projects they manage, plus their own. Within it they read the time in reports and the dashboard, including amounts. They may add and edit time only for the people they manage (not for everyone on a managed project). They edit the projects they manage (details, tasks, members, but not rates). Rates are set only by owners and admins. A manager with no assignments is a member with a manager badge. *Cost if wrong:* the scope SQL and the matrix rows change, not the data model.
2. **Members never see amounts in Phase 4.** Amounts (money) show to owners, admins, and managers within their scope. The "members see others' time" setting shows members durations only. *Cost if wrong:* one matrix row and a setting.
3. **Rates follow the industry rule: a rate change never re-rates existing entries unless you ask.** Owner's direction: follow what Clockify, Harvest and Toggl do. They agree on three points. A new rate applies to new entries by default, and existing entries keep the rate they were saved with, so past reports and invoices stay accurate. The change dialog offers the scope explicitly: "New entries only" (the default), "Entries from a date", or "All entries, past and future". Rates have effective dates, and an entry is rated by the rate in force on its date. Here that means:
   - An entry is rated when it is created, with the rate in force at its start. Its rate, currency and amount are stored on the row.
   - Editing an entry keeps its rate. A changed duration recomputes the amount from the stored rate. Only a change to what decides the rate re-rates it: the project, the task, the person (Phase 4b's add-for-others) or switching billable on. This is also how one entry is refreshed by hand, as in Clockify.
   - "New entries only" adds a rate row effective from today (the start of today in the workspace timezone). "Entries from a date" adds a row effective from that date and runs the "apply to past entries" job from it. "All entries" adds a row effective from the beginning and runs the job over everything.
   - The acceptance check follows: a project rate changed from today leaves last month's amounts alone until the job runs.
   - Phase 5's approvals will lock an approved entry's rate, and the job will skip locked entries.

   *Cost if wrong:* the rule lives in one function (`needsRerate(before, after)`) in the entry service.
4. **One currency per workspace until Phase 6.** Rates and snapshots carry the workspace's currency code (invariant 2). Changing the workspace currency relabels every rate and snapshot in one transaction, after a confirmation that says amounts are not converted. Multi-currency and conversion are Phase 6. *Cost if wrong:* Phase 6 adds per-rate currencies, which the columns already allow.
5. **Required fields bind when an entry is stopped, not when a timer starts.** Starting a timer needs nothing. Stopping it, saving a manual entry, editing a stopped entry, timesheet cells, calendar blocks, bulk edit and import all check. A refused stop keeps the timer running and says which field is missing. "Task required" applies only when the chosen project has active tasks. Break entries are exempt. The fields are the four a workspace admin can require in Part 4's settings: project, task, tag and description. This matches Clockify, where a timer can start without them but cannot stop until they are filled. One difference to settle when 4b is planned: with task required, Clockify hides projects that have no tasks from the picker. This design keeps them usable and applies the rule only to projects that have tasks. *Cost if wrong:* also checking on start is one more call site.
6. **Breaks are their own entry type and stay out of report totals by default.** `time_entry.type` is `work` or `break`. A break has no project, task, tags or billable flag and never has an amount. Reports gain a Type filter (Work, the default; Breaks; All). Phase 5's attendance report reads breaks. *Cost if wrong:* the default flips to All.
7. **Force timer exempts owners and admins, and time added for someone else.** With force timer on, members and managers cannot create manual entries or change start, end or duration of their own entries (timesheet and calendar become read-only for them). Admins keep full editing, and a manager or admin adding time for someone they manage is not blocked. It sits behind `planAllows(workspace, "forceTimer")`, a stub returning true until Phase 8. *Cost if wrong:* one exemption rule.
8. **Nobody runs a timer for someone else.** "Add time for others" covers manual entries and edits in the tracker, timesheet and calendar. The timer bar always belongs to the person signed in. *Cost if wrong:* the running-timer invariant would need an actor/target split in `startTimer`.
9. **Deactivate keeps everything; remove keeps only the time.** Deactivating stops the person's running timer, blocks their access (they get the same 404 as a stranger, which `resolveWorkspaceAccess` already does for non-ACTIVE memberships), and keeps their groups, project memberships, manager assignments and rates for reactivation. Removing deletes the membership and all of those. Their entries stay in reports under their name with "(former member)", as today. The owner can be neither: ownership is transferred first. There are no seats until Phase 8; "frees a seat" means a deactivated person is not counted in the Team page's active total.
10. **Ownership transfer goes to an active admin.** The old owner becomes an admin, in one transaction, after typing the workspace name. It is never reachable by URL tampering: it is an owner-only action in the matrix.
11. **User import is a bulk invite.** People in a CSV usually have no account yet, so "import users" sends invitations: columns `email`, `role` (default member), `groups` (semicolon-separated names). The preview flags invalid emails, unknown roles, owners, existing members and pending invites, and marks group names that will be created. On acceptance the membership gets the role and joins the groups (a new `invitation_group` table, since the invitation row belongs to Better Auth).
12. **Amounts are computed at save, rounded per entry.** `amount = round(rate × seconds / 3600)` half up, in integer minor units, with exact integer arithmetic (`bigint`, never floats), stored on the entry. Report totals sum stored amounts. With report rounding on, the engine recomputes each entry's amount from its rounded duration (still per entry, in SQL `numeric`, then cast to `bigint`). Only billable entries' amounts count in reports.
13. **Rounding is a report rule.** It applies to report views, exports and share links, per entry (as the prompt's "display-only, raw data unchanged" implies). The tracker, timesheet, calendar and dashboard show raw time. A report toolbar toggle (in the URL, so exports and links follow it) shows raw time when a rule is set.
14. **Share links never carry amounts unless asked.** The share dialog gains "Include amounts", offered only to someone who can see them. It is stored on the link and checked against the creator's current permissions when the link is read.
15. **Permissions are code, and the doc is generated from it.** The matrix is a typed table in `packages/core/src/permissions.ts`. `pnpm permissions:doc` writes `docs/PERMISSIONS.md` from it, and a test fails when the checked-in doc is stale. A second test fails when an exported server action or JSON route handler does not call `authorize` (the guard that "every server action and route handler uses it").

## Part 1 — Roles and permissions

`packages/core/src/permissions.ts` (pure, no I/O):

- `Actor`: `{ userId, role, managedUserIds: ReadonlySet, managedProjectIds: ReadonlySet, settings: PermissionSettings }`. `managedUserIds` is already expanded through groups. `PermissionSettings` holds the Part 4 switches (page visibility, members see team time, who creates what, force timer). In 4a it is the defaults: members cannot see others' time, and only admins create catalog items (today's behaviour).
- `Action`: a fixed vocabulary, grouped by resource: `workspace.update`, `workspace.transferOwnership`, `member.invite`, `member.changeRole`, `member.deactivate`, `member.remove`, `member.assignScope`, `group.manage`, `page.view` (projects, team, reports), `client.create`/`update`, `project.create`/`update`/`manageMembers`, `task.create`/`update`, `tag.create`/`update`, `rate.view`, `rate.set`, `rate.recalculate`, `entry.read`, `entry.write`, `entry.writeTimes` (start/end/duration, the force-timer gate), `report.readTeam`, `report.viewAmounts`, `shareLink.manage`, `import.users`, `import.entries`.
- `Resource`: a discriminated union naming what the action touches: `{ kind: "workspace" }`, `{ kind: "member", userId, role }`, `{ kind: "project", projectId, visibility, isMember }`, `{ kind: "entry", userId, projectId }`, `{ kind: "page", page }`, and so on.
- `can(actor, action, resource): boolean` reads the matrix, then the scope rule for manager rows ("own", "in scope", "managed people only"). `canSeeProject`, `canManageCatalog`, `canReadTeam` and the pages' `hasMinRole` checks become calls to `can` and are deleted. `roles.ts` stays the source of role ranking.

Server side, `apps/web/src/server/authz.ts`:

- `loadActor(db, ctx)` builds the `Actor` for a request: two indexed queries (managed people direct and via groups; managed projects), cached per request with React `cache()`.
- `authorize(ctx, action, resource)` throws `WorkspaceAccessError`. A role that may never perform the action gets 403. A resource outside the actor's scope (another person's entry, a private project, a member outside the manager's team) gets 404, matching invariant 3 and the catalog's rule.
- `scopeFilter(actor)` returns the SQL condition the report engine, the dashboard and the Users filter use: none for owners and admins (and for members when "members see team time" is on), `user_id IN managed ∪ me OR project_id IN managed` for managers, `user_id = me` for members. `effectiveQuery` keeps pinning a member's `userIds` and intersects a manager's with their scope.

Better Auth's access-control statements (`lib/permissions.ts`) stay only for its own invitation endpoints. Our actions call `authorize` before calling them.

Every server action and every JSON route handler calls `requireWorkspaceAccess` (membership; unchanged) and then `authorize`. Pages call `requireWorkspacePage` and `authorize(…, "page.view", …)` where a page can be hidden.

## Part 2 — Team page

`/w/[slug]/team`, rebuilt:

- **Members table**: avatar and name, email, role, groups, billable rate (owners and admins only), status (Active, Invited, Deactivated), and a row menu. The cost rate column is built and hidden until Phase 6. Filters: search by name or email, role, group, status (Active by default). Pending invites are rows with status Invited, not a separate list. Works at 375 px (email and rate collapse under the name).
- **Row actions** (admins; a manager sees the table read-only): change role, edit groups, set billable rate (Part 3's dialog), manage scope (for managers: people, groups, projects), deactivate / reactivate, remove, resend or cancel an invite, transfer ownership (owner only, admins as targets).
- **Invite**: one dialog with an email box that takes one address or many pasted at once (commas, spaces or new lines; up to 100), a role, and optional groups. The result lists each address as invited, already a member, already invited, or invalid.
- **Import users from CSV**: upload (≤ 1 MB, ≤ 500 rows), preview table with a status per row (decision 11), then "Invite N people". Nothing is sent until that click.
- **Groups**: a Groups tab on the Team page: create, rename, delete, add and remove members. Groups are used in three places: a private project's access list (a group on a private project lets its members see and track on it), the reports' new Groups filter (expanded to its members at query time, then intersected with the viewer's scope), and a manager's scope.
- The demo seed gains two groups, a manager (`manager@demo.test`) who manages `member1@` directly and the "Mobile app" project, and rates at every level.

## Part 3 — Rates

- **Hierarchy**, most specific wins: task rate → project-member rate → project rate → member rate → workspace default. A level with no rate in force falls through.
- **`rate` table** (`kind` = `billable`; `cost` is reserved for Phase 6): one row per level and `effective_from`, holding `amount_minor` (`bigint`) and `currency`, or `amount_minor = null` meaning "no rate at this level from this date" (fall through). The row in force for an entry is the latest one with `effective_from ≤ entry.start`. Rows are never edited in place; a change adds a row, so the history is the table.
- **Resolution in one place**: `resolveRate(rates, entry)` in core (pure, for the unit tests: every level, fall-through, effective dates, a null row), and one SQL expression in `apps/web/src/server/rates.ts` (a lateral subquery per level, first non-null wins) that the entry service and the recalculation job both use. An integration test checks that the SQL and the core function agree over a fixture of every case.
- **Snapshots**: `time_entry` gains `billable_rate_minor`, `rate_currency`, `rate_source` (which level answered, for the "rate from project" hint) and `amount_minor`. `time-entries.ts` rates every new entry in the same transaction (start, manual create, duplicate, continue, timesheet and calendar creates; Phase 4b's split, import and add-for-others). Every edit recomputes the amount, and re-rates only under decision 3's rule (project, task, person, billable switched on), including stop, timesheet and calendar edits and Phase 4b's bulk edit. Existing entries keep nulls (no rates existed) until a recalculation.
- **Setting a rate**: a dialog per level (Settings for the workspace default; the Team page for a member; the project's Settings tab for the project rate; its Members tab for project-member rates; its Tasks tab for task rates). It has the amount (typed as `125.50`, parsed exactly into minor units with the currency's exponent: never `parseFloat`), and "Apply to": New entries only (the default; effective from today in the workspace timezone), Entries from a date (a date picker; any earlier or later date), or All entries, past and future (decision 3). The last two run the recalculation job. A History list shows every row for that level with its date and who set it.
- **"Apply to past entries" job**: a `rate_recalc_job` row (`workspace_id`, `created_by`, `from`, `status`, `total`, `processed`, `cursor`, `error`, `started_at`, `finished_at`) run after the response (`after()`, like export jobs, decision 1 of Phase 3). It updates entries with `start ≥ from` in keyset batches of 5,000, each batch its own transaction committing `processed` and `cursor`, so a killed run resumes from its cursor on Retry. A job running for over 15 minutes is marked failed by the next job's housekeeping, as exports are. The rate dialog and a banner on the Team and project pages show "Updating entries: 4,000 of 12,000" by polling the job. One job per workspace at a time. A second request waits in the queue and then runs from the earlier of the two dates. The job is a single call (`runRateRecalcJob(db, jobId)`) so it can move to pg-boss with the export jobs.
- **Reports gain money**: the engine's measures gain `amount` (sum of billable entries' amounts) next to `billableDuration`. Summary, Detailed, Weekly, the dashboard's Me and Team tabs and the project Status tab show Amount columns and totals to viewers allowed to see them (decision 2). Entries with no rate show "—" and a footnote counts them ("12 billable entries have no rate"). Exports read the same column records (`report-export.ts` gains amount columns, omitted for viewers who cannot see amounts). Money is formatted by a core `formatMoney(minor, currency)` with `Intl.NumberFormat`.

## Part 4 — Workspace settings (Phase 4b)

Settings (owners and admins), in sections:

- **Time format**: duration format (including decimal: it already exists, with the user's own preference taking precedence), week start, default currency (decision 4).
- **Rounding** (reports only, decision 13): Off, or Up / Down / Nearest to 1, 5, 6, 10, 12, 15, 30 or 60 minutes. A core `roundDuration(seconds, rule)` and its SQL twin, tested to agree (including exactly-on-step values and "nearest" ties, which round up).
- **Who can see what**: hide the Projects, Team and Reports pages from members (the nav hides them and the routes answer 403); members see others' time in reports and the dashboard (durations only).
- **Who can create**: projects, clients, tasks and tags, each `Admins`, `Admins and managers`, or `Everyone`. Defaults: Admins (today's behaviour). Project managers can always add tasks to the projects they manage.
- **Required fields**: project, task, tag, description (decision 5). Server-side errors name the field; the UI marks the field.
- **Force timer** (decision 7).
- **Breaks**: allow break entries (decision 6). The timer bar and manual mode gain a Break switch when on.

All of these are columns on `workspace_settings` with defaults that reproduce today's behaviour, so the migration is expand-only.

## Part 5 — Power features (Phase 4b)

- **Add time for others**: admins and managers get a person picker (themselves first, then the people they may write for) in the Time Tracker's entry list, the Timesheet and the Calendar. Picking someone shows and edits that person's entries with the same components. Their projects are the ones visible to that person, not to the viewer. The timer bar stays the viewer's (decision 8). The entry service's scope gains `actorId` beside `userId`: reads and writes target `userId`, `authorize(…, "entry.write", { userId })` checks the actor, and the react-query keys gain the target's id, so another person's week never lands in your own cache.
- **Bulk edit**: the tracker's selection bar and the Detailed report's selection gain Edit: project (and task), tags (add, replace or remove), billable, description (replace). One `bulkUpdateEntries` call validates every entry first (permissions, tracking blocks, required fields), then applies all of them in one transaction or none, with an error that names how many entries failed and why.
- **Split**: a row action opens a time picker between the entry's start and end (default: the midpoint, rounded to the minute) and turns the entry into two with the same details and tags.
- **Favourites**: "Pin" in a row's menu saves its details (description, project, task, tags, billable) as a favourite. Favourites sit above the entry list (up to 20, oldest pinned first) with Start and Unpin. A favourite whose project is archived or no longer visible shows disabled with the reason.
- **Project templates**: "Save as template" on a project, and "Start from template" in the new-project dialog. Creating from a template copies active tasks, members (and their manager flag), groups, rates (project, project-member and task levels, effective from the new project's creation) and settings (billable default, visibility, colour, note). The client is chosen in the dialog. Templates use the existing `project.is_template`: they appear in a Templates filter on the Projects page, never in pickers or reports, and take no time (`trackingBlock` says "This project is a template").
- **Time audit report**: a fourth report tab, Audit, which is the Detailed report with audit criteria in the URL: without project, without task (on projects that have tasks), shorter than X, longer than Y (any combination; defaults: without project, longer than 10 h). Bulk edit works there, so problems are fixed where they are found.
- **Import time entries**: Tracker → Import. Upload a CSV (≤ 4 MB, the request limit, ≤ 10,000 rows). Map columns (auto-matched by header name: Date, Start, End, Duration, Description, Project, Client, Task, Tags, Billable, Email). Choose the timezone the times are in (default: yours) and whether missing projects, clients, tasks and tags may be created. Then a dry run lists every row as OK or with its error and shows what would be created. Import writes everything through the entry service in one transaction. The Email column is honoured only for admins and managers, within their scope; for everyone else, entries are their own. The CSV reader is an RFC 4180 parser in `packages/core` (quotes, CRLF, BOM, `;` or `,` delimiter detection), since the repository has a writer but no parser.

## Data model

Migration `0010_phase4a` (all additive):

- `project_member.is_manager` (`boolean`, default false).
- `user_group` (`id`, `workspace_id`, `name` unique per workspace, timestamps); `user_group_member` (`group_id`, `user_id`); `project_group` (`project_id`, `group_id`: group access to a private project).
- `managed_user` (`workspace_id`, `manager_id`, `user_id`); `managed_group` (`workspace_id`, `manager_id`, `group_id`). Composite primary keys, indexed by manager.
- `invitation_group` (`invitation_id`, `group_id`).
- `rate` (`id`, `workspace_id`, `kind` enum `billable | cost`, `level` enum `workspace | member | project | project_member | task`, `user_id?`, `project_id?`, `task_id?`, `amount_minor bigint?`, `currency char(3)`, `effective_from timestamptz`, `created_by`, `created_at`). Unique on (workspace, kind, level, user, project, task, effective_from) with NULLS NOT DISTINCT. Indexed for the lateral lookup: `(workspace_id, kind, level, project_id, task_id, user_id, effective_from desc)`.
- `rate_recalc_job` (as in Part 3).
- `time_entry`: `billable_rate_minor bigint?`, `rate_currency char(3)?`, `rate_source` enum (the five levels)?, `amount_minor bigint?`.
- `report_share_link.include_amounts` (`boolean`, default false).

Migration `0011_phase4b` (all additive): the `workspace_settings` columns of Part 4, `time_entry.type` enum `work | break` (default `work`), `favorite_entry` (`id`, `workspace_id`, `user_id`, `description`, `project_id?`, `task_id?`, `tag_ids text[]`, `billable`, `created_at`).

Every table enables RLS. `docs/DATA_MODEL.md` gains them, and the recalculation plan over the perf seed goes there too.

## Access rules (summary; the full table is `docs/PERMISSIONS.md`)

| | Owner | Admin | Manager | Member |
| --- | --- | --- | --- | --- |
| Workspace settings, groups, rates, invites, roles | yes | yes (not ownership) | no | no |
| Read time in reports, dashboard | all | all | scope (decision 1) | own (or all, durations only, if allowed) |
| See amounts | all | all | scope | no |
| Add or edit others' time | all | all | people they manage | no |
| Edit a project | all | all | projects they manage | no |
| Create catalog items | yes | yes | per setting | per setting |

## Tests

- **Core**:
  - `permissions.test.ts`: table-driven over every action × role × scope case, plus "manager outside scope" and every Part 4 switch.
  - `rates.test.ts`: the five levels, fall-through, `effective_from` boundaries, null rows.
  - `money.test.ts`: exact parsing for exponents 0, 2 and 3; half-up rounding; no float path.
  - `rounding.test.ts`: every mode and step; exactly on a step; ties.
  - `required-fields.test.ts`.
  - `csv-parse.test.ts`: quotes, embedded newlines, BOM, delimiters.
  - Import mapping.
- **Web integration**:
  - The SQL rate resolution equals the core function.
  - Every entry write path stores a snapshot.
  - The recalculation job: progress, resume from cursor, one per workspace.
  - A manager sees only their scope in Summary, Detailed, Weekly, the dashboard and the Users and Groups filters, and gets 404 for an entry outside it.
  - Deactivation stops the timer and blocks access; reactivation restores it.
  - Ownership transfer.
  - Group access to a private project.
  - Bulk invite results.
  - The user CSV preview.
  - Bulk edit is all-or-nothing.
  - Split.
  - Import dry run equals commit.
  - The authorize-coverage test and the PERMISSIONS.md freshness test.
- **E2E**:
  - Test-first, lines in `docs/E2E_COVERAGE.md` before app code.
  - The two acceptance checks:
    - a manager sees only their team in reports;
    - a project rate changed from today leaves last month's amount alone, and "Entries from a date" covering last month changes it once its job finishes.
  - Plus: bulk invite, user import preview, groups on a private project, deactivate/reactivate, role change, rate history, amounts in Summary and in a CSV export, required field blocks Stop, rounding toggle, force timer, a break entry, add time for someone else in the timesheet, bulk edit, split, pin and start a favourite, project from template, audit tab, entry import dry run and commit.
  - A 375 px Team page check.
- **Perf**: the one-year Summary with amounts over the perf seed stays under one second (`report:perf`). A recalculation over the perf seed's million entries finishes inside one function budget (300 s), and its time is recorded.

## Out of scope (later phases)

- Cost rates, profit and multiple currencies (Phase 6; `rate.kind` and the currency columns are ready).
- Approvals and locked periods (Phase 5).
- Plan limits, seats and billing (Phase 8; `planAllows` is a stub).
- An audit log of who changed what (Phase 8).
- Who-edited-this on entries.
- Timers for other people.
- Task assignees restricting who may track (`task_assignee` stays informational).

## Risks

- **Moving every check onto `can()` at once** can quietly widen or narrow access somewhere. Mitigations: the authorize-coverage test, the table-driven matrix tests, the existing e2e tenant-isolation and role tests (unchanged expectations), and 4a lands before any 4b feature depends on it.
- **The report budget**: the one-year Summary takes ~760 ms today. Amounts add one `sum(bigint)` over a stored column (cheap). The scope filter adds an `OR` over two sets, which may defeat the start index for managers. The perf script gains a manager case, and the fallback is `UNION ALL` of the two halves.
- **Recalculation inside a function**: a million-row update must fit in 300 s. It commits in batches and resumes from its cursor, so a timeout costs time, not correctness. The perf seed measures it before 4a merges.
- **Shared database**: both migrations are additive and run through the migrate workflow before their previews. Nothing is renamed or dropped. `canReadTeam` and friends are removed in code, not in the schema.
- **Better Auth's invitation endpoints** keep their own role checks. The invite actions keep calling `authorize` first, and an integration test checks that a manager's invite is refused by us, not by accident.
