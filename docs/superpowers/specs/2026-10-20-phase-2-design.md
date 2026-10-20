# Phase 2 — Projects, clients, tasks, tags, timesheet, calendar — design

Date: 2026-10-20. Status: draft for review. Source: the Phase 2 prompt in `Clockify Clone — Phased Claude Code Prompt Pack.md`, `docs/PRD.md`, `docs/DATA_MODEL.md`.

## Goal

Time can be organised properly (clients → projects → tasks, plus tags) and entered three ways: the timer (Phase 1), a weekly timesheet grid and a day/week calendar. The same entry shows identically in all three and an edit in one shows in the others.

Success means the two acceptance checks from the prompt pass end to end:

- The same entry shows identically in Time Tracker, Timesheet and Calendar, and editing it in one updates the others.
- A member cannot see or pick a private project they are not on.

## Decisions for the owner

These change what gets built. The design below assumes the recommended answer; the plan is written on the same assumption.

| # | Question | Recommended | Why |
| --- | --- | --- | --- |
| 1 | Who may create and edit clients, projects, tasks and tags? | Owner and admin only. Members see no "Create project/tag" in the pickers. | Matches the competitor's default. A "members too" workspace setting belongs with the other admin controls in Phase 4. |
| 2 | Who may open a project's detail page (tasks, access, status, settings)? | Owner and admin only in Phase 2. Members use the pickers. | The status tab shows everyone's time. Phase 4's manager role and project managers open these pages up with proper scoping. |
| 3 | Project names become unique per client instead of per workspace. The old unique index must go. | Drop it in this phase's migration and accept that, during the production build (about a minute) and on stale previews, old code's inline "Create project" returns an error toast. | The alternative (keep the old index now, drop it next phase) delays a stated Phase 2 feature by a phase for a one-minute window that only affects inline project creation. |
| 4 | Merge `fix/backlog-minors` into `main` now (deploys production)? | Yes. Its preview run was green, 30 passed, none flaky. | Phase 2 is cut from it either way. |

## Calls made by the builder (not from the prompt)

Each is a reasonable default; say so if one is wrong.

- **Timesheet rows group by project + task + description.** Every entry is visible in exactly one row, so the grid total always equals the entry list total. Entries without a project sit in a "(No project)" row.
- **The running timer is not in the timesheet** (it has no duration yet); it is in the calendar as a growing block and in the timer bar.
- **An entry that crosses midnight** counts under its start day in the timesheet (as in the entry list) and is drawn on both days in the calendar, clipped at midnight.
- **A task marked DONE cannot receive new time**, like an archived project; its entries keep it. Pickers hide DONE tasks and archived projects and tags.
- **Deleting a project with time** offers "Move entries to another project (or no project)" or "Delete the entries". Deleted entries are soft-deleted like list deletes, but there is no Undo for a bulk project delete.
- **Deleting a task** keeps its entries on the project with no task; the dialog says how many entries that affects.
- **Deleting a tag** removes it from its entries; the dialog says how many.
- **Favourites are per user** (a star on the projects list and in the picker). Timesheet templates are per user per workspace.
- **Tracked hours on the projects list:** owner and admin see everyone's time; a member sees their own time and the column is headed "Your time".
- **Continue and Duplicate** on an entry whose project is archived, task is done, or tag is archived fail with a clear message, because they create new time.
- **Project access members are users only.** User groups arrive in Phase 4; the table is ready for a `group_id` column then.
- **Calendar external events** are an interface and an empty list of sources; no OAuth, no sync.
- **New timesheet cells start at 09:00** in the viewer's timezone, or at the end of the day's last entry if the day already has entries, as the prompt says.

## Data model

Migration `0005_phase2_catalog` (one migration for the whole phase). Every new table calls `.enableRLS()`.

| Table | Columns | Notes |
| --- | --- | --- |
| `client` | id, workspace_id, name, address (default ''), email (default ''), notes (default ''), currency (char(3), null; Phase 6 uses it), archived (default false), timestamps | unique (workspace_id, name) |
| `project` (extended in place) | + client_id → client (ON DELETE RESTRICT), billable (default true), visibility `project_visibility` PUBLIC/PRIVATE (default PUBLIC), note (default ''), archived (default false), is_template (default false) | `project_workspace_name_uq` dropped; new unique (workspace_id, client_id, name) NULLS NOT DISTINCT |
| `project_member` | project_id, user_id | PK (project_id, user_id). Who may track on a PRIVATE project. |
| `project_favorite` | project_id, user_id | PK (project_id, user_id) |
| `task` | id, workspace_id, project_id (cascade), name, status `task_status` ACTIVE/DONE (default ACTIVE), timestamps | unique (project_id, name) |
| `task_assignee` | task_id, user_id | PK |
| `time_entry` | task_id gains FK → task ON DELETE SET NULL and an index | all current values are null |
| `tag` | + archived (default false) | |
| `timesheet_template` | id, workspace_id, user_id, name, rows jsonb `[{ projectId, taskId, description }]`, timestamps | unique (workspace_id, user_id, name) |

Enums in `packages/core`: `PROJECT_VISIBILITIES = ["PUBLIC", "PRIVATE"]`, `TASK_STATUSES = ["ACTIVE", "DONE"]`.

`project` and `tag` move from `schema/tracking.ts` to a new `schema/catalog.ts` (with client, members, favourites, tasks); table names do not change, so the move generates no SQL. `apps/web/test/db.ts` `truncateAll` gains the new tables. Seed: two clients, projects linked to them, three or more tasks per project, some entries on tasks, and "Mobile app" PRIVATE with member2 left off (so the demo tenant has a private project a member cannot see).

## Access rules

Pure functions in `packages/core/src/catalog.ts`:

- `canManageCatalog(role)`: owner or admin.
- `canSeeProject({ role, visibility, isMember })`: owner/admin always; otherwise PUBLIC, or PRIVATE and a project member.
- `trackingBlock({ project, task, tags })`: the reason new time cannot be recorded with these details, or null: "This project is archived", "This task is done", "This task belongs to another project", "Tag … is archived".

Applied in `apps/web/src/server/time-entries.ts`: `EntryScope` gains `role`, and the details check becomes `assertDetailsUsable(db, scope, details)`: the project must exist in the workspace, be visible to the user and not be archived; the task must belong to the project and be ACTIVE; tags must not be archived. It runs on start, manual create, continue, duplicate and on an update that changes project, task or tags. A private project the user is not on gives the same INVALID "Project not found." as a project in another workspace: never a hint that it exists.

Pages: Clients and Tags require admin; Projects (list) is for every member and shows only visible projects; project detail requires admin (decision 2). The sidebar hides Clients and Tags from members. Every list and picker filters by `canSeeProject`.

## Part 1 — Clients (`/clients`, admin)

- Table: name, email, projects (count), status; search box (`q`); status filter active / archived / all (default active).
- "New client" dialog: name (required, unique per workspace), address, email, notes, currency (ISO code select, optional, labelled as reserved for invoicing).
- Row menu: Edit (same dialog), Archive / Unarchive, Delete. Delete is only enabled when the client has no projects; otherwise the item is disabled with "Move or delete its projects first".
- Archived clients stay on their projects and in filters, but the project dialog's client list shows active clients only (plus the project's current one).

## Part 2 — Projects

### List (`/projects`, every member)

- Table: ★ favourite, name (link to detail for admins; plain text for members), client, tracked ("Your time" for members), progress (an em dash until estimates exist in Phase 6), access (Public / Private badge), row menu (admin: Edit, Archive/Unarchive, Delete).
- Filters in the URL: `q`, `client`, `status` (active | archived | all, default active), `billing` (all | billable | non-billable), `access` (all | public | private); sort by name, client or tracked, ascending or descending.
- Checkboxes with a bulk bar: Archive selected (admin).
- "New project" dialog (admin): name, client (optional), colour (the 20-colour palette, default picked from the name), billable by default (on), visibility (Public / Private), note.
- A name must be unique within its client (or among projects without a client): "A project with this name already exists for this client."

### Detail (`/projects/[projectId]/…`, admin)

Tabs are routes under a shared layout: Tasks (default), Access, Status, Settings, Budget, Rates. Budget and Rates are empty states naming the phase that fills them (6 and 4).

- **Tasks:** table of name, assignees (avatars with names on hover), status, tracked time; "Add task" (name, assignees); row menu: Rename, Mark done / Reopen, Delete (confirm; says how many entries lose the task). Done tasks are listed under a "Done" divider.
- **Access:** visibility switch Public / Private with one-line explanations; when Private, a member list with add (searchable member picker) and remove. The note "Groups arrive in Phase 4" sits under the list.
- **Status:** date range (default: this month, presets this week / last week / this month / last month, plus two date inputs); tracked time by task (with "No task") and by member, each with a total, plus billable vs non-billable totals.
- **Settings:** the same fields as the create dialog, plus "Use as template" (the Phase 4 flag), Archive / Unarchive, and Delete, which opens the move-or-delete-entries dialog when the project has entries.

### Picker (timer bar, entry rows, timesheet, calendar)

`ProjectPicker` becomes a project-and-task picker with value `{ projectId, taskId }`:

- Groups: Favourites first, then one group per client (alphabetical), then "No client". Archived projects, done tasks and private projects the user is not on never appear.
- A project with active tasks shows them indented beneath it; selecting a task selects its project too. Typing searches project and task names ("web des" finds Website › Design).
- Trigger label: `Project: Website › Design` (accessible name; the visible text shows the colour dot, name and task).
- "Create project …" at the bottom for admins only; members see nothing. Tasks are created on the project page.

## Part 3 — Tasks and tags

- Tasks: see the Tasks tab above. `task.name` is unique within its project. Assignees are informational in Phase 2 (anyone who can see the project may track on any of its active tasks); Phase 4 can restrict tracking to assignees.
- Tags page (`/tags`, admin): table of name, colour, used by (entry count), status; "New tag" (name, colour); row menu: Rename, Archive / Unarchive, Delete (confirm with the entry count). Archived tags cannot be added to entries and are hidden in the tag picker, but stay on entries that have them.
- Entry rows and the timer bar show `Project › Task` next to the colour dot.

## Part 4 — Timesheet (`/timesheet`)

- Week in the URL: `?week=YYYY-MM-DD` (the week's first day in the viewer's timezone, workspace week start). Header: ‹ › Today, the week range, the grand total.
- Grid: first column = row label (project with colour dot, task, description in muted text); seven day columns headed "Mon 19" style with the day total beneath; last column = row total. Totals row at the bottom. On narrow screens the grid scrolls horizontally with the first column sticky.
- Rows: every (project, task, description) combination that has entries this week, sorted by project name (no project last), task, description; plus rows the user adds this visit. Added rows are kept in memory for the page visit.
- Cells are text inputs. A cell shows the sum of its entries in the viewer's duration format. Typing accepts every Phase 1 duration format (bare numbers are hours). Enter or blur commits; Escape reverts; arrow keys and Tab move between cells.
- Cell maths (`packages/core/src/timesheet.ts`, `planCellChange`):
  - empty cell → create one entry for that day: start at 09:00 local, or at the end of the day's last entry if the day already has entries; billable from the project's default.
  - one entry → set its end so its duration matches.
  - several entries, new total ≥ sum → extend the last one (latest start).
  - several entries, new total < sum but the last entry can absorb the decrease → shrink the last one (or delete it when it hits zero).
  - several entries, new total < sum of the others → a popover lists the entries with their durations editable; nothing changes until the user edits one.
  - zero → delete the cell's entries.
- "Add new row": picker for project/task plus an optional description.
- "Copy last week": dialog with Rows only / Rows and time. Rows and time creates one entry per last-week entry, shifted exactly seven days (wall time preserved across DST), in one transaction.
- Templates menu: Save as template (name), Apply (adds the template's rows), Delete. Stored in `timesheet_template`.
- Data: `/api/w/[slug]/time-entries/range?from=&to=` returns the viewer's stopped entries in the range; writes go through the existing entry actions. All entry queries share the `["tracker", slug, "entries", …]` key prefix so a change anywhere (tracker, timesheet, calendar, another tab) refetches everywhere.

## Part 5 — Calendar (`/calendar`)

- Views: day and week (`?view=&date=`). Week is the default from `md` up; day on smaller screens. Header: ‹ › Today, the date or week range, view toggle.
- Grid: 24 hours × 15-minute slots (16 px per slot), hour labels in a sticky gutter, the grid scrolled to 07:00 on open, a current-time line on today.
- Blocks: one per entry on that day (clipped at midnight for entries that cross it); project colour as a tinted background and left border (neutral without a project); description, `Project › Task`, duration. Overlapping blocks share the width side by side. The running timer is a dashed block from its start to now, growing each minute; it is edited from the timer bar, not dragged.
- Interactions (pointer events; the maths is pure in `packages/core/src/calendar.ts`):
  - drag on empty space → a ghost block snapped to 15 minutes → a popover: description, project/task, tags, billable, start and end times → Create.
  - drag a block → move it (same duration; across days in week view).
  - drag a block's top or bottom edge → change its start or end (minimum 15 minutes).
  - click a block → edit popover (same fields plus Delete).
  - moves and resizes save optimistically through `updateEntryAction`.
- Timezone rules: a slot is a wall-clock time in the viewer's zone, converted with `zonedDateTimeToInstant`; a moved block keeps its duration; a nonexistent wall time (DST gap) normalises forward.
- Extension point: `apps/web/src/components/calendar/event-sources.ts` exports `ExternalEvent` and `externalEventSources: ExternalEventSource[]` (empty). When a source returns events they render as read-only grey blocks. Google/Outlook sync is a later phase and is listed as deferred in the PRD.

## Tracker changes

- `TimeEntryDTO` gains `task: { id, name } | null`; `EntryProject` gains `clientName`. Recent-description autocomplete already carries `taskId` and now fills the task too.
- The timer bar and entry rows use the new picker; the tag picker hides archived tags and offers "Create tag" to admins only.
- Starting, continuing or duplicating time on an archived project, a done task or an archived tag shows the message from `trackingBlock`.

## Tests

- **Core (Vitest):** `catalog.test.ts` (visibility and tracking-block rules), `timesheet.test.ts` (row grouping, totals, every `planCellChange` branch, copy-week shift across a DST change), `calendar.test.ts` (block geometry incl. midnight crossing, overlap columns, create/move/resize ranges in Asia/Manila and America/New_York across the spring-forward and fall-back days, the 24:00 boundary).
- **Integration (Vitest against the test database):** clients CRUD and delete-in-use; project list visibility per role and membership; picker excludes archived, done and private-not-member; per-client name uniqueness; delete project with move or delete; tasks; tags (archive hides, delete counts); entry service INVALID cases (archived project, private project not on, done task, task of another project, archived tag; continue and duplicate on an archived project); `listEntriesInRange`; project status aggregates; templates; copy week.
- **E2E (Playwright, written before the app code, failing first):** new sections in `docs/E2E_COVERAGE.md`, one line per user action, ticked only once the test passes against the finished feature. The suite must stay under 10 minutes on a preview; if Phase 2 pushes it past about 8 minutes, spec files run with 2 workers (fresh-user specs are independent; the demo-account specs are read-mostly and are checked before enabling it).

## Out of scope (later phases)

Estimates and budgets (6), rates (4), user groups and project managers (4), "members may create projects" setting (4), tracking restricted to assignees (4), calendar sync (deferred), timesheet approval (5), adding time for other users (4).

## Risks

- **Scope.** Five parts; the prompt allows a split at Part 4. Each part is committed and green on its own, so the phase can pause after Part 3.
- **E2E runtime** (above).
- **Migration window** (decision 3).
- **Drag interactions in tests** are driven with Playwright's mouse at computed coordinates; the maths is unit-tested in core so the e2e tests only need one create, one move and one resize.
