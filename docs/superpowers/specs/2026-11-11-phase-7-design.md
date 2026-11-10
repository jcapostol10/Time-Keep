# Phase 7 — Scheduling and forecasting: design

Prompt: "Phase 7 — Scheduling and forecasting" in `Clockify Clone — Phased Claude Code Prompt Pack.md`. Checklist: `docs/PROGRESS.md` § Phase 7. Builds on member capacity, holidays and approved time off (Phase 5b, `peopleContext`, `holidayRules`, `timeOffMinutesByDay`), the manager scope in the permission matrix, project estimates and the Budget tab (Phase 6b), the rate hierarchy (Phase 4), the report engine and export pipeline (Phase 3), the outbox (Phase 5a) and the calendar's all-day band. Written from the prompt without an interview: the owner's standing instruction since Phase 6 is that product decisions are the builder's ("make the decisions for now, we can revise them later"). Every call the prompt does not make is listed first, so it can be checked while reading.

## Goal

A manager plans who works on what over the coming weeks, sees at a glance who is over or under capacity, publishes the plan to the people in it, and compares the plan with what was actually tracked: per person, per project, and against each project's estimate.

The PRD puts scheduling in the Pro tier. Plan limits arrive in Phase 8; `planAllows` gains the feature `scheduling` and stays a stub returning true.

## Delivery: two branches

Each is merged, deployed and e2e-tested on its own. Each gets its own plan, written when it starts against the code the previous one leaves.

- **Phase 7a — schedule** (prompt Parts 1–3: team schedule, project schedule, publishing, My schedule, the calendar overlay). Migration `0020_phase7a`.
- **Phase 7b — forecast and report** (Parts 4–5: the Budget tab's forecast, the Assignments report and its export). No migration expected.

`phase-7` is tagged after 7b's acceptance checks pass.

The preview e2e lane ran 146 tests in 6.2 minutes after Phase 6d. Each branch measures the lane after adding its specs and moves the slowest mature spec to `@nightly` if the lane passes 9 minutes.

## Decisions (builder's calls; check these first)

### The assignment

1. **An assignment is a person, a project, an optional task, a start date and an end date (inclusive local dates, no time zone, like expenses), an amount of time, a flag for non-working days, a note and an optional weekly recurrence.** Dates are `date` columns; there is no time of day. The person's own working days and holidays decide where its hours fall.

2. **The amount is either minutes per day or a total spread over the days.** `hours_mode` PER_DAY (`minutes_per_day`, 1 minute to 24 hours) or TOTAL (`total_minutes`, at most 24 hours times the days it can fall on). A total is spread over the days it falls on in whole minutes: each day gets `floor(total / days)`, and the remainder goes one minute at a time to the earliest days, so the days always add up to the total. Typed amounts use the duration parser (bare numbers are hours).

3. **Which days an assignment falls on.** Without "include non-working days", only the person's working days (`membership.working_days`) that are not holidays applying to them. With it, every day in the span. Approved time off does **not** remove a day: the assignment still lands, and the day shows over capacity, so the clash is visible. *Cost if wrong:* skipping time-off days is one more filter in the same core function.

4. **Recurrence is weekly: every N weeks (1 to 4) until a date.** The span repeats with its start shifted by 7·N days while the repeat's start is on or before the until date; the until date is at most one year after the first start, so a series has at most 53 occurrences. A recurring assignment is one row: a move, resize, edit or delete applies to the whole series, and the dialog says so. Splitting a recurring assignment is refused ("Split works on a single assignment; edit the series instead"). *Cost if wrong:* per-occurrence exceptions are a child table later.

5. **An assignment cannot be created on an archived project or a done task** (the `trackingBlock` rule), for a person who is not an active member, or **on a private project the person is not on** (directly or through a group): "Add <name> to the project first." That way a member's My schedule never shows the name of a project they cannot see. A task must belong to the project and be visible to the person by the task-visibility rule.

6. **Who edits.** New matrix actions:
   - `schedule.viewTeam`: owners and admins everyone; a manager their scope (people they manage, and anyone's assignments on projects they manage); members never (403). They see only their own, in My schedule.
   - `assignment.write` on `{ kind: "assignment", userId, projectId }`: owners and admins yes; managers `scope` (the entries' rule: themselves, the people they manage, anyone on the projects they manage); members **no** (403; the prompt's "members cannot edit assignments").
   - `schedule.publish`: owners, admins and managers; a manager publishes the drafts inside their scope.
   - `milestone.manage`: owners, admins and the project's managers (`PROJECT_MANAGERS`).
   *Cost if wrong:* letting members see the team's published schedule is `ownOrTeam` on `schedule.viewTeam`.

7. **Hours on a project the viewer cannot see** still count toward the person's capacity and show as an unlabelled grey bar, "Another project", that cannot be opened or dragged. A manager therefore sees that a person in their scope is busy without learning which private project they are on.

8. **Deactivated and removed members** are not rows in the team schedule; their assignments stay, so the Assignments report still shows what was planned ("(former member)"). Deleting a project deletes its assignments and milestones (`ON DELETE CASCADE`).

### Drafts and publishing

9. **A published assignment is never edited in place.** Each row is either published or a draft. Editing a published assignment creates a draft that names it (`replaces_id`). Deleting one creates a draft tombstone (`replaces_id`, `deleted = true`). A new assignment is a draft from the start. So:
   - **Members** read published rows only.
   - **Planners** (whoever has `schedule.viewTeam`) read the working plan: drafts that are not tombstones, plus published rows that no draft replaces. Each draft is marked "Unpublished" on the grid.
   - **Publish** takes, in one transaction, every draft the actor may write. A draft that replaces an assignment deletes the published row, a tombstone deletes both, and every other draft becomes published.
   - **Editing a draft** edits it in place.
   - **"Discard changes"** deletes the actor's drafts in scope, restoring the published plan.

   This is two rows of one shape rather than a JSON snapshot, so every read is plain SQL. *Cost if wrong:* a simpler "editing unpublishes it" flag, which makes a member's assignment disappear until the next publish.

10. **Publishing notifies.** Each person whose published plan changed gets one email listing their published assignments from today for the next 28 days: date range, project, task, hours per day, note. It goes through the outbox with `kind` `schedule.published:<publishId>:<userId>`, sent after the response (`drainSoon`). A person whose only change was a deletion still gets the email, listing what remains. A `.invalid` address (kiosk-only people) is skipped, as elsewhere.

### Capacity and the heat indicator

11. **A person's capacity for a day** follows Attendance (Phase 5b): their daily capacity on a working day that is not a holiday applying to them, less that day's approved time off; zero otherwise. Pending time off does not count. Scheduled minutes on a day are the sum of the working plan's assignments falling on that day (decisions 2–3), the "Another project" bars included.

12. **Heat, per person per day:** **over** when scheduled > capacity (any scheduled time on a zero-capacity day is over); **at** when scheduled = capacity > 0; **under** when 0 < scheduled < capacity, or when nothing is scheduled on a day with capacity. Days with neither are blank. Shown as a coloured strip under each row's day cell: red over, green at, amber under. The cell's label says the numbers, "10:00 of 8:00", for screen readers and tests (`data-heat`). The acceptance check is that 10 hours a day against 8 is red.

### Pages

13. **`/w/[slug]/schedule`** has three tabs:
    - **Team** (`/schedule/team`): planners only.
    - **Projects** (`/schedule/projects`): planners only.
    - **My schedule** (`/schedule/mine`): everyone.

    `/schedule` opens Team for planners and My schedule for members. The nav item **Schedule** sits in Track, after Calendar, and is shown to everyone.

14. **Team schedule.**
    - **Layout:** a row per active member in the viewer's scope (sorted by name; filters for groups and projects), a column per day, and zooms of Week, 2 weeks and Month, with previous, next and Today.
    - **Bars:** each assignment is a bar in its project's colour, labelled project · task · hours per day. Overlapping assignments stack in lanes inside the row.
    - **Row header:** shows the person's scheduled total against their capacity for the range.
    - **Interactions:**
      - Drag across empty days to create: it opens the dialog with the person and dates filled in.
      - Drag a bar to move it in time, or to another person's row.
      - Drag a bar's edge to resize.
      - Alt-drag to copy.
      - Right-click (or the bar's menu) to split at the day under the pointer: two assignments, the second starting on that day.
      - Click to open the dialog.
    - **Keyboard and touch:** every pointer action has a dialog or menu equivalent ("Add assignment", the bar's menu: Edit, Copy, Split, Delete). The pointer gestures are a mouse convenience. At 375 px the grid scrolls sideways inside its card, and the dialog is the way to add.
    - **Publish bar:** shows "N unpublished changes" with Publish and Discard while the scope has drafts.

15. **Performance.** The grid's rows are windowed: rows have a fixed height, and only the rows in view plus a margin are rendered. This is a hand-rolled window rather than a new dependency. The widest zoom is one month, at most 31 columns, so columns are not windowed. The prompt's "100 members × 3 months" is met by the data route: one request returns a range of up to 13 weeks for the whole scope, and a perf script asserts that reading 100 members' plans over 3 months, with capacity, takes under 500 ms. Next and previous fetch the adjacent range ahead. *Cost if wrong:* a quarter zoom needs column windowing too.

16. **Project schedule.**
    - **Rows:** a row per project with assignments or milestones in the range (planners see the projects they may view), with total assigned hours for the range in the row header and milestones as diamonds on their day.
    - **Expanding a row** lists that project's assignments by person, as bars like the team grid's, editable with the same gestures.
    - **Milestones:** "Add milestone" (project, date, name) and a diamond's menu (Edit, Delete) are for `milestone.manage`.

17. **My schedule** (everyone) lists the viewer's published assignments by week, as cards per day with project, task, hours and note, for the selected range (week or month). There is no editing.

18. **The calendar overlay.** The Calendar's all-day band gains the viewer's published assignments as faint (dashed, muted) items: "Website · 4:00 scheduled". They are read-only and never block, like time off.

### Forecasting (7b)

19. **The forecast is for projects with a time or money estimate, on the Budget tab** (who sees it: the tab's existing rule, `project.update`).
    - **Tracked:** raw stopped work on the project in the estimate's period up to now, as today's progress bar counts it.
    - **Scheduled:** the **published** plan's minutes on the project from tomorrow to the period's end (for a whole-project estimate, to the last scheduled day). The published plan is the plan of record; a forecast that moved with every draft would mislead.
    - **Projected:** tracked plus scheduled.

20. **Money for scheduled time** is each assignment-day's minutes times the billable rate that would rate an entry for that person, project and task on that day: the same hierarchy and currency rule as the entries (`resolveRate`), in the project's currency. It counts only when the project is billable by default (`project.billable`); days without a rate are counted as unrated.

21. **What the tab shows:**
    - **Chart:** the cumulative chart gains a dashed "Scheduled" line continuing from today's tracked total.
    - **Projected total:** in hours, and in money for a money estimate or when rates exist.
    - **Projected completion date:** the first day the cumulative projection reaches the estimate. If it was reached before today, it reads "Reached on <date>". If the plan never reaches it, "Not reached by the published plan".
    - **Projected overrun:** `max(0, projected − estimate)` in the estimate's unit, and in the other unit "about" the same share of the projection: `other × overrun ÷ projected`, BigInt half up. An overrun shows in red. The acceptance check is that it is predicted when scheduled plus tracked exceeds the estimate.

### The Assignments report (7b)

22. **A Reports tab, Assignments: scheduled against tracked.**
    - **Grouping:** by person, project or date (day, or week by the workspace's week start).
    - **Columns:** Scheduled, Tracked, Variance (tracked − scheduled), and Variance % when scheduled > 0.
    - **Filters:** the range, people, groups, clients and projects.
    - **Scheduled** is the published plan (decision 19). **Tracked** is raw stopped work (rounding does not apply: a plan is in raw hours), on each person's own local days.
    - **Scope:** the report engine's scope (owners and admins everyone, a manager their scope, a member their own).
    - **Export:** CSV, Excel and PDF through the existing column records. No share links: a plan is internal. The tab is part of the Reports page and its hidden-page rule.

## Data model

Migration `0020_phase7a` (additive, new tables only):

- `assignment`:
  - Keys: `id`, `workspace_id` (cascade), `user_id` (cascade), `project_id` (cascade), `task_id?` (set null).
  - Dates: `start_date date`, `end_date date`.
  - Amount: `hours_mode enum (PER_DAY, TOTAL)`, `minutes_per_day int?`, `total_minutes int?`, `include_non_working boolean default false`.
  - Text and recurrence: `note text default ''`, `repeat_weeks smallint?` (1–4; null = no recurrence), `repeat_until date?`.
  - Publishing: `published boolean default false`, `replaces_id text?` (references `assignment.id` on delete cascade), `deleted boolean default false` (a tombstone; only on a draft with `replaces_id`).
  - Bookkeeping: `created_by`, timestamps.
  - Checks: end ≥ start; exactly one of the two amounts per mode; `repeat_until` with `repeat_weeks`.
  - Indexes on (`workspace_id`, `user_id`, `start_date`), (`workspace_id`, `project_id`, `start_date`), and a unique partial index on `replaces_id` where not null (one draft per published row).
- `milestone`: `id`, `workspace_id` (cascade), `project_id` (cascade), `date date`, `name text`, `created_by`, timestamps; index (`workspace_id`, `date`).
- `assignment_publish`: `id`, `workspace_id`, `published_by`, `published_at`, `changed_count`. One row per Publish, for the outbox key and the "last published" line.

Every new table enables RLS. `docs/DATA_MODEL.md` gains them and drops them from "Planned".

## Code layout

- **Core** (`packages/core/src/schedule.ts`, pure):
  - `assignmentDays(a, person, holidays)`: the date key → minutes map for one assignment over a range, recurrence and spreading included.
  - `scheduledByDay`: sums them.
  - `dayCapacity`.
  - `heatOf`.
  - `occurrences`: recurrence expansion.
  - `splitAssignment`, `moveAssignment`, `resizeAssignment`: date arithmetic on date keys only.
  - `forecast(...)` (7b).
  - zod schemas `assignmentInputSchema`, `milestoneInputSchema` in `schemas.ts`.
- **Server:**
  - `server/schedule/assignments.ts` (the only writer of `assignment`, every write under the matrix, the draft rules of decision 9).
  - `server/schedule/publish.ts`.
  - `server/schedule/read.ts` (the working plan and the published plan for a range and a scope, with capacity).
  - `server/schedule/milestones.ts`.
  - `server/schedule/emails.ts`.
  - 7b: `server/schedule/forecast.ts` and `server/schedule/report.ts`.
- **Routes and actions:**
  - `GET /api/w/[slug]/schedule/team`, `…/schedule/projects` and `…/schedule/mine` (each with a range).
  - Server actions in `actions/schedule.ts`.
- **UI:** `components/schedule/*`: grid, bar, drag hook, dialog, publish bar, milestone dialog, My schedule.
- **Query keys:** schedule queries live under `scheduleKeys` (their own prefix: entry writes do not change a plan; the Assignments report sits under the reports prefix, so entry writes refetch it).

## Access rules (summary; the full table is generated into `docs/PERMISSIONS.md`)

| | Owner | Admin | Manager | Member |
| --- | --- | --- | --- | --- |
| See the team and project schedules (working plan) | yes | yes | their scope | no |
| Create, edit, move, split, delete assignments | yes | yes | their scope | no |
| Publish and discard drafts | yes | yes | their scope | no |
| Milestones | yes | yes | projects they manage | no |
| My schedule and the calendar overlay (own, published) | yes | yes | yes | yes |
| The forecast on the Budget tab | yes | yes | projects they manage | no |
| The Assignments report | everyone's | everyone's | their scope | their own |

## Tests

- **Core:**
  - Capacity:
    - With a holiday and with approved half-day and full-day time off.
    - Across a DST change in New York: dates, not instants, so no drift.
  - Spreading a total: remainder to the earliest days; the days add up to the total; non-working days included or not.
  - Recurrence: every 1 and every 3 weeks; the until date on and before an occurrence's start; the one-year cap.
  - Heat at, under and over: 10 hours against 8 is over.
  - Split, move and resize on date keys, across month ends.
  - Forecast (7b):
    - Completion inside, before and beyond the plan.
    - Overrun in both units, proportional and half up.
    - A monthly estimate's period.
  - The matrix rows for the new actions.
- **Web integration:**
  - The writer refuses members (403) and a manager outside their scope (404).
  - It refuses an archived project, a done task and a private project the person is not on.
  - Editing a published assignment makes one draft and leaves the published row alone; a second edit edits that draft; delete makes a tombstone.
  - Publish applies replace, tombstone and new; is scoped to the publisher; and enqueues one email per changed person with the 28-day list.
  - Discard restores the published plan.
  - Two concurrent publishes do not double-apply: the publisher takes a workspace advisory lock.
  - A member's read sees published rows only.
  - The "Another project" bar for a manager without project access.
  - The perf read for 100 people over 13 weeks stays under 500 ms.
  - 7b:
    - The forecast's scheduled money agrees with `resolveRate`.
    - The report's scheduled and tracked totals, scoped.
    - The export columns.
- **E2E** (lines added to `docs/E2E_COVERAGE.md` before code, each failing first):
  - Acceptance:
    - Assigning a member 10 hours a day shows their day over capacity (`data-heat="over"`).
    - The forecast predicts an overrun when scheduled plus tracked exceeds the estimate (7b).
  - 7a:
    - Create, move and resize by drag on the team grid.
    - A draft is invisible to the member until Publish; after it, the member sees it in My schedule and on the Calendar band, and gets the email.
    - A member has no Team tab and the write route answers 403.
    - Milestones on the project schedule with the total hours.
    - Split from the bar's menu.
  - 7b: the Assignments report's variance and its CSV.

## Out of scope (later phases)

- Exceptions inside a recurring series (move or delete one occurrence).
- Time of day on assignments, and scheduling by percentage of capacity.
- Members seeing the whole team's schedule.
- Placeholders (unassigned roles), and assignments syncing to Google or Outlook (the event-source hook stays empty).
- Forecasting from drafts or what-if plans, and forecasting cost or profit.

## Risks

- **Two-row drafts double count.** Every planner read must apply the same "drafts plus unreplaced published" rule. Mitigation: one SQL helper, `workingPlanRows`, and one for `publishedPlanRows`, used by every reader, with an integration test per reader.
- **Drag on a dense grid.** Pointer maths on date columns is easy to get off by one. Mitigation: the gesture hook only computes date keys and calls the same pure `moveAssignment` / `resizeAssignment` the dialog uses, which are unit-tested.
- **The email lists a plan the person cannot see the project of.** Ruled out by decision 5 at write time; publishing re-checks the person's access to each project and leaves a now-inaccessible one out of the list.
