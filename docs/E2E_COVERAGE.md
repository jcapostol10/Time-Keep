# End-to-end coverage

Every user-facing function of TimeKeep, and the Playwright test that proves it works. A ticked line names its spec file (by its path under `apps/web/e2e/`, e.g. `team/invite.spec.ts` for a spec in a subfolder) and exact test title; `pnpm --filter @timekeep/web e2e:coverage` fails if a ticked line names a test that does not exist. An unticked line is a gap still to cover.

Rules (see `docs/superpowers/specs/2026-10-18-e2e-suite-design.md`):

- A line is ticked only after its test was seen to fail once when the behaviour it guards was broken.
- From Phase 2, a feature's lines are added here, unticked, before its code is written.
- Out of scope: Google sign-in (needs real Google accounts), production email delivery, visual regression, load testing.

## Auth

- [x] Sign up with email and password, verify the email, land in a personal workspace — `auth.spec.ts` › "sign up, verify email, land in a personal workspace, sign out and back in"
- [x] Sign out and sign back in with email and password — `auth.spec.ts` › "sign up, verify email, land in a personal workspace, sign out and back in"
- [x] Unverified users cannot sign in and can resend the verification email — `auth.spec.ts` › "unverified users cannot sign in and can resend the verification email"
- [x] Resend the verification email from the check-email page — `auth.spec.ts` › "the check-email page resends the verification email"
- [x] Sign in with a magic link — `auth.spec.ts` › "magic link signs an existing user in"
- [x] Reset a forgotten password from an emailed link — `auth.spec.ts` › "forgot password sends a reset link that sets a new password"
- [x] Protected pages redirect to sign-in and return to the original page afterwards — `auth.spec.ts` › "protected routes redirect to sign-in and preserve the destination"

## Workspaces and team

- [x] Create a new workspace — `workspace.spec.ts` › "invite a second user, accept the invite and switch between workspaces"
- [x] Invite a member by email — `workspace.spec.ts` › "invite a second user, accept the invite and switch between workspaces"
- [x] Accept an invitation from its link — `workspace.spec.ts` › "invite a second user, accept the invite and switch between workspaces"
- [x] Switch between workspaces — `workspace.spec.ts` › "invite a second user, accept the invite and switch between workspaces"
- [x] Members cannot invite; admins can — `workspace.spec.ts` › "members cannot invite; admins can"
- [x] Workspace settings are read-only for members and editable by admins — `workspace.spec.ts` › "workspace settings are read-only for members and editable by admins"
- [ ] Cancel a pending invitation — gap
- [x] Invite several people at once and see what happened to each address — `team.spec.ts` › "bulk invite reports each address"
- [x] Import people from a CSV: preview each row, then invite the ready ones (creating their groups) — `team.spec.ts` › "user import previews and invites"
- [x] Change a member's role; a member sees the team read-only — `team.spec.ts` › "a member's role, deactivation and removal"
- [x] Deactivate a member (the workspace closes to them) and reactivate them — `team.spec.ts` › "a member's role, deactivation and removal"
- [x] Remove a member; their time stays in reports as a former member — `team.spec.ts` › "a member's role, deactivation and removal"
- [x] Transfer ownership to an admin, confirming with the workspace name — `team.spec.ts` › "transfer ownership to an admin"
- [x] A manager's scope limits what their Summary shows — `team.spec.ts` › "a manager's scope limits their Summary"
- [x] Create a group, add members, and filter the members table by group and status — `team.spec.ts` › "groups: filter members, and a group on a private project lets its member track on it"
- [x] A group on a private project lets its members track on it — `team.spec.ts` › "groups: filter members, and a group on a private project lets its member track on it"
- [x] The Team page fits a 375px screen — `team.spec.ts` › "the Team page fits a 375px screen"

## Profile and settings

- [x] Change display name — `profile.spec.ts` › "update name and timezone, upload and remove an avatar"
- [x] Change timezone — `profile.spec.ts` › "update name and timezone, upload and remove an avatar"
- [x] Upload an avatar — `profile.spec.ts` › "update name and timezone, upload and remove an avatar"
- [x] Remove an avatar — `profile.spec.ts` › "update name and timezone, upload and remove an avatar"
- [ ] Avatar upload rejects a file that is not an image — gap
- [ ] Avatar upload rejects an image over the size limit — gap
- [ ] Change date format, time format and week start — gap
- [ ] Save timer settings (idle detection, Pomodoro, reminders) and see them after a reload — gap
- [x] Send yourself a test email from Profile settings — `profile.spec.ts` › "send a test email"

## Time Tracker: timer bar

- [x] Start a timer, keep it running across a reload, stop it; the tab title shows the clock — `tracker.spec.ts` › "start, reload and stop a timer"
- [x] Pressing Enter twice quickly starts only one timer — `tracker.spec.ts` › "a double Enter starts only one timer"
- [x] Two browser tabs never show two running timers — `tracker.spec.ts` › "two tabs never show two running timers"
- [x] Create a project inline and start a timer on it — `timer-bar.spec.ts` › "create a project inline and start a timer on it"
- [x] Search the project picker and clear the project — `timer-bar.spec.ts` › "search the project picker and clear the project"
- [x] Pick several tags, including one created inline — `timer-bar.spec.ts` › "pick several tags, including one created inline"
- [x] Start right after creating a tag: the tag stays on the entry — `timer-bar.spec.ts` › "a tag created just before Start stays on the entry"
- [x] Add a manual entry right after creating a tag: the tag stays on the entry — `timer-bar.spec.ts` › "a tag created just before a manual Add stays on the entry"
- [x] Start right after creating a project: the project stays on the entry — `timer-bar.spec.ts` › "a project created just before Start stays on the entry"
- [x] The billable toggle is saved with the entry — `timer-bar.spec.ts` › "the billable toggle is saved with the entry"
- [x] Description autocomplete fills project, tags and billable from a recent entry — `timer-bar.spec.ts` › "autocomplete fills project, tags and billable from a recent entry"
- [x] N focuses the description and Esc leaves it — `timer-bar.spec.ts` › "N focuses the description and Esc leaves it"
- [x] S starts and stops the timer from another workspace page — `timer-bar.spec.ts` › "S starts and stops the timer from another workspace page"

## Time Tracker: manual mode

- [x] Add a manual entry with a decimal duration (1.5 saves 1:30:00) — `tracker.spec.ts` › "add a manual entry with a decimal duration"
- [ ] An end time before the start time rolls over to the next day — gap

## Time Tracker: entry list

- [x] Consecutive identical entries collapse into a group that expands — `tracker.spec.ts` › "continue an entry"
- [ ] Entries are grouped by day (Today, Yesterday, dates) with day totals — gap
- [ ] The week header shows the week total — gap
- [ ] An entry that crosses midnight is listed under its start day — gap
- [ ] Older weeks load when scrolling or pressing Load more — gap

## Time Tracker: row actions and inline edits

- [x] Edit a duration inline and keep it after a reload — `tracker.spec.ts` › "edit a duration inline"
- [x] Continue an entry: a new timer starts with the same description, project, tags and billable — `tracker.spec.ts` › "continue an entry"
- [x] Delete an entry and undo the delete — `tracker.spec.ts` › "delete an entry and undo"
- [ ] Duplicate an entry — gap
- [ ] Select several entries and delete them in bulk, with undo — gap
- [ ] Edit the description inline — gap
- [ ] Change the project and tags of an entry — gap
- [ ] Toggle billable on an entry — gap
- [ ] Edit start and end times inline — gap
- [ ] Move an entry to another date — gap

## Time Tracker: timer helpers

- [ ] Idle prompt: keep the idle time — gap
- [ ] Idle prompt: discard the idle time — gap
- [ ] Idle prompt: discard and start a new timer — gap
- [ ] Pomodoro notice at the end of a focus block — gap
- [ ] Reminder when no timer runs during working hours — gap

## Clients

- [x] Create a client with name, email and notes — `clients.spec.ts` › "create and edit a client"
- [x] Edit a client — `clients.spec.ts` › "create and edit a client"
- [x] Search clients by name — `clients.spec.ts` › "search clients"
- [x] Archive a client and find it under the archived filter; unarchive it — `clients.spec.ts` › "archive and unarchive a client"
- [x] Delete an unused client — `clients.spec.ts` › "delete an unused client"
- [x] A client with projects cannot be deleted — `projects.spec.ts` › "create a project from the projects page"
- [x] Members cannot open the clients page and do not see it in the sidebar — `clients.spec.ts` › "members cannot open the clients page"

## Projects

- [x] Create a project with client, colour, billable default and visibility — `projects.spec.ts` › "create a project from the projects page"
- [x] Filter projects by client, status, billing and access — `projects.spec.ts` › "filter, search and sort the projects list"
- [x] Search and sort projects — `projects.spec.ts` › "filter, search and sort the projects list"
- [x] Favourite a project (the star persists) — `projects.spec.ts` › "favourite a project"
- [x] Archive projects in bulk — `projects.spec.ts` › "bulk archive; archived projects keep their time but take no new time"
- [x] An archived project keeps its entries but takes no new time — `projects.spec.ts` › "bulk archive; archived projects keep their time but take no new time"
- [x] Project names are unique per client — `projects.spec.ts` › "project names are unique per client"
- [x] Delete a project and move its entries to another project — `projects.spec.ts` › "delete a project and move its entries"
- [x] Delete a project and its entries — `projects.spec.ts` › "delete a project and its entries"
- [x] Members see only their own tracked time in the projects list — `projects.spec.ts` › "a member sees Your time; admins see Tracked"

## Project detail

- [x] Add a task with assignees — `project-detail.spec.ts` › "manage a project's tasks"
- [x] Rename a task — `project-detail.spec.ts` › "manage a project's tasks"
- [x] Mark a task done and reopen it — `project-detail.spec.ts` › "manage a project's tasks"
- [x] A done task takes no new time and is hidden from the picker — `project-picker.spec.ts` › "a done task takes no new time and is hidden from the picker"
- [x] Delete a task; its entries keep the project — `project-picker.spec.ts` › "delete a task; its entries keep the project"
- [x] Make a project private and pick its members — `project-detail.spec.ts` › "make a project private and pick its members"
- [x] The status tab sums time by task and member for a date range — `project-detail.spec.ts` › "the status tab sums time by task and member"
- [x] The status tab adds weekly bars when the range is longer than a month — `project-detail.spec.ts` › "the status tab adds weekly bars when the range is longer than a month"
- [x] The status tab exports CSV and opens the same numbers in reports — `project-detail.spec.ts` › "the status tab exports CSV and opens the same numbers in reports"
- [x] Edit project settings, mark it as a template, archive and unarchive it — `project-detail.spec.ts` › "edit project settings, mark it as a template, archive and unarchive it"
- [x] Members cannot open project detail — `project-detail.spec.ts` › "members cannot open project detail"
- [x] The Budget tab says which phase brings it; the Rates tab sets the project's rates — `project-detail.spec.ts` › "the Budget tab says which phase brings it and the Rates tab sets rates"

## Projects and tasks in the tracker

- [x] Pick a task in the timer bar; the entry shows project and task — `project-picker.spec.ts` › "pick a task and the entry shows project and task"
- [x] Autocomplete fills the task along with the project — `project-picker.spec.ts` › "pick a task and the entry shows project and task"
- [x] Search the picker by task name — `project-picker.spec.ts` › "search the picker by task name"
- [x] The picker groups projects by client, favourites first — `project-picker.spec.ts` › "the picker groups projects by client with favourites first"
- [x] A member cannot see or pick a private project they are not on — `project-picker.spec.ts` › "a member cannot see or pick a private project they are not on"
- [x] Members cannot create projects or tags from the pickers — `project-picker.spec.ts` › "members cannot create projects or tags from the pickers"
- [x] A rejected Start refreshes a stale picker and drops the dead project from the draft — `projects.spec.ts` › "a stale picker refreshes when Start is rejected"

## Tags

- [x] A duplicate tag name is refused on the Tags page (the picker's inline create reuses it) — `tags.spec.ts` › "a duplicate tag name is refused on the Tags page"
- [x] Create a tag — `tags.spec.ts` › "create and rename a tag"
- [x] Rename a tag — `tags.spec.ts` › "create and rename a tag"
- [x] An archived tag stays on entries but cannot be added — `tags.spec.ts` › "an archived tag stays on entries but cannot be added"
- [x] Tags show how many entries use them — `tags.spec.ts` › "delete a tag in use"
- [x] Delete a tag in use after a confirmation naming the count — `tags.spec.ts` › "delete a tag in use"

## Timesheet

- [x] The week's entries show as rows with day, row and grand totals — `timesheet.spec.ts` › "the week's entries show as rows with totals"
- [x] Typing a duration in an empty cell creates an entry at 09:00 — `timesheet.spec.ts` › "typing in an empty cell creates an entry at 09:00"
- [x] A second cell on the same day starts after the day's last entry — `timesheet.spec.ts` › "a second cell on the same day starts after the day's last entry"
- [x] Increasing a cell extends its entry — `timesheet.spec.ts` › "increasing a cell extends its entry"
- [x] Lowering a cell below its other entries opens the entries list — `timesheet.spec.ts` › "lowering a cell below its other entries opens the list"
- [x] Clearing a cell deletes its entries, with an Undo toast — `timesheet.spec.ts` › "clearing a cell deletes its entries"
- [x] Undo restores a cleared cell — `timesheet.spec.ts` › "undo restores a cleared cell"
- [x] A cleared row stays for the visit, so its other days can be typed — `timesheet.spec.ts` › "a cleared row stays for the visit"
- [x] Invalid input (text, negative, over 999h) reverts the cell and writes nothing — `timesheet.spec.ts` › "invalid input reverts the cell"
- [x] A cell total over 24 hours is rejected — `timesheet.spec.ts` › "invalid input reverts the cell"
- [x] Add a new row — `timesheet.spec.ts` › "add a new row"
- [x] Copy last week, rows and time — `timesheet.spec.ts` › "copy last week with time"
- [x] Save and apply a template — `timesheet.spec.ts` › "save and apply a template"
- [x] Move between cells with the keyboard — `timesheet.spec.ts` › "move between cells with the keyboard"
- [x] Navigate weeks and back to today — `timesheet.spec.ts` › "navigate weeks"

## Calendar

- [x] Entries show as blocks with the project colour in week and day view — `calendar.spec.ts` › "entries show as blocks in week and day view"
- [x] Drag on empty space to create an entry — `calendar.spec.ts` › "drag to create an entry"
- [x] Drag a block to move it — `calendar.spec.ts` › "move and resize an entry by dragging"
- [x] Drag a block's edge to resize it — `calendar.spec.ts` › "move and resize an entry by dragging"
- [x] Click a block to edit it — `calendar.spec.ts` › "click a block to edit it"
- [x] The running timer shows as a growing block — `calendar.spec.ts` › "the running timer shows as a block"
- [x] Overlapping entries sit side by side — `calendar.spec.ts` › "overlapping entries sit side by side"
- [x] Navigate days and weeks and back to today — `calendar.spec.ts` › "navigate days and weeks"
- [x] Drags past the edges of the day (above 00:00, below 24:00, out of the column) stay inside it — `calendar.spec.ts` › "drags past the edges of the day stay inside it"
- [x] A block dropped where it no longer fits the day is pulled back inside it — `calendar.spec.ts` › "a block dropped where it no longer fits the day is pulled back inside it"
- [x] The current time line shows on today — `calendar.spec.ts` › "the current time line shows on today"

## Entry views

- [x] The same entry shows identically in the tracker, timesheet and calendar — `entry-views.spec.ts` › "an entry edited in the timesheet changes in the tracker and the calendar"
- [x] Editing an entry in one view updates the others — `entry-views.spec.ts` › "an entry edited in the timesheet changes in the tracker and the calendar"

## Reports

- [x] The summary shows the range's total, a chart and a grouped table — `reports.spec.ts` › "the summary shows the week's total, a chart and a grouped table"
- [x] Filter by project (including "Without project") and by tag — `reports.spec.ts` › "filter by project and by tag"
- [x] Back undoes a filter change — `reports.spec.ts` › "Back undoes a filter change"
- [x] Group by client then project shows nested totals — `reports.spec.ts` › "group by client then project shows nested totals"
- [x] Presets and a custom range change the URL and the totals — `reports.spec.ts` › "presets and a custom range change the URL and the totals"
- [x] A member cannot widen the Users filter by URL and has no Users filter — `reports.spec.ts` › "a member cannot widen the Users filter by URL"
- [x] The Groups filter narrows the summary to the group's members — `reports.spec.ts` › "the Groups filter narrows the summary to the group's members"
- [x] The summary agrees with the tracker's week total — `reports.spec.ts` › "the summary agrees with the tracker's week total"
- [x] A summary row opens the detailed report filtered to it — `reports.spec.ts` › "a summary row opens the detailed report filtered to it"
- [x] A weekly cell opens the detailed report for that project and day — `reports.spec.ts` › "a weekly cell opens the detailed report for that project and day"
- [x] The detailed report lists entries and loads more — `reports.spec.ts` › "the detailed report lists entries and loads more"
- [x] Edit an own entry inline in the detailed report — `reports.spec.ts` › "edit the description and duration of an own entry inline"
- [x] Select own entries in the detailed report and delete them, with Undo — `reports.spec.ts` › "select own entries in the detailed report and delete them, with undo"
- [x] Another person's entry is read-only in the detailed report — `reports.spec.ts` › "another person's entry is read-only"
- [x] The column chooser hides a column and remembers it — `reports.spec.ts` › "the column chooser hides a column and remembers it after reload"
- [x] Sort the detailed report by duration — `reports.spec.ts` › "sort the detailed report by duration"
- [x] The weekly grid by project shows day and row totals that match the summary — `reports.spec.ts` › "the weekly grid by project shows day and row totals that match the summary"
- [x] The weekly grid can list people instead of projects — `reports.spec.ts` › "the weekly grid can list people instead of projects"
- [x] The weekly export lists people when the grid does — `reports.spec.ts` › "the weekly export lists people when the grid does"

## Exports and sharing

- [x] Export the summary as CSV — `reports.spec.ts` › "export the summary as CSV"
- [x] Export the summary as PDF — `reports.spec.ts` › "export the summary as PDF"
- [x] The share title defaults to the report and its range — `share.spec.ts` › "the share title names the report and its range"
- [x] A share link opens without signing in and shows the same total — `share.spec.ts` › "a share link opens without signing in and shows the same total"
- [x] Revoking a link makes it unavailable (404, same page as an unknown token) — `share.spec.ts` › "revoking a link makes it unavailable"
- [x] The shared page exports CSV — `share.spec.ts` › "the shared page exports CSV"
- [x] A shared link refuses a second export within seconds (429) — `share.spec.ts` › "a shared link refuses a second export within seconds"
- [x] A large export becomes a job: listed under Exports, downloadable, emailed — `reports.spec.ts` › "a large export becomes a job with a download link and an email"

## Dashboard

- [x] The dashboard shows this week's total, top project and most tracked — `dashboard.spec.ts` › "the dashboard shows this week's total, top project and most tracked"
- [x] A most tracked item opens the detailed report for it — `dashboard.spec.ts` › "a most tracked item opens the detailed report for it"
- [x] The Team tab shows who is tracking now within a poll — `dashboard.spec.ts` › "the Team tab shows who is tracking now within a poll"
- [x] A member has no Team tab — `dashboard.spec.ts` › "a member has no Team tab"

## Tenant isolation

- [x] A member of one workspace cannot open another workspace's pages — `tenant-isolation.spec.ts` › "a member of one workspace cannot open another workspace's pages"
- [x] The workspace switcher lists only the user's own workspaces — `tenant-isolation.spec.ts` › "the switcher only lists the user's own workspaces"
- [x] A project id from another workspace is not found, on every project page — `project-detail.spec.ts` › "a project id from another workspace is not found"

## Amounts

- [x] Summary and Detailed show the amount to the owner and not to a member — `amounts.spec.ts` › "Summary and Detailed show the amount to the owner and not to a member"
- [x] A CSV export carries the Amount column — `amounts.spec.ts` › "a CSV export carries the Amount column"

## Rates

- [x] The workspace default rate is set and shows in its history — `rates.spec.ts` › "the workspace default rate shows in the history"
- [x] A project rate from today leaves last month's amount alone; "Entries from a date" covering it changes it once the job runs — `rates.spec.ts` › "a project rate from today leaves last month's amount alone"
- [x] A task rate beats the project rate on a new entry — `rates.spec.ts` › "a task rate beats the project rate on a new entry"
- [x] The rate dialog fits a 375px screen — `rates.spec.ts` › "the rate dialog fits a 375px screen"

## Permissions

- [x] A manager opens a project they manage, without its Rates and Budget tabs — `permissions.spec.ts` › "a manager opens a project they manage, without its Rates tab"
- [x] A manager gets not-found for a project they do not manage — `permissions.spec.ts` › "a manager gets not-found for a project they do not manage"
- [x] A member sees no Clients or Tags in the sidebar — `permissions.spec.ts` › "a member sees no Clients or Tags in the sidebar"

## Workspace rules

- [x] Hiding a page from members removes it from their sidebar and its routes answer not found / 403 — `settings.spec.ts` › "a hidden page leaves a member's sidebar and answers 403"
- [x] Members see the team's time in reports when the workspace allows it — `settings.spec.ts` › "members see the team's time when the workspace allows it"
- [x] The "who can create" setting lets a member create a project and a tag from the pickers — `settings.spec.ts` › "who can create opens the pickers' inline create to members"
- [x] A required field blocks Stop and manual Add until it is filled — `settings.spec.ts` › "a required project blocks Stop until it is picked"
- [x] Force timer hides manual mode and makes the timesheet read-only for a member — `settings.spec.ts` › "force timer takes manual entry away from a member"
- [x] A break entry is tracked with the Break switch and stays out of the Summary by default — `settings.spec.ts` › "a break stays out of the Summary unless the Type filter asks"
- [x] Report rounding rounds the Summary and the Raw toggle shows real time — `settings.spec.ts` › "rounding rounds the Summary and Raw shows real time"

## Add time for others

- [x] An admin adds time for a member through the person picker and the member sees it in their tracker — `others.spec.ts` › "an admin adds time for a member and the member sees it in their tracker"
- [x] A manager's person picker lists only the people they manage, and a URL for someone else is not found — `others.spec.ts` › "a manager's person picker lists only their people"
- [ ] The timer bar stays the viewer's own while another person's entries are shown — `others.spec.ts` › "the timer bar stays the viewer's own"

## Power features

- [x] Select entries and edit their project, tags and billable flag at once — `power.spec.ts` › "bulk edit moves selected entries to a project and tags them"
- [x] Split an entry into two at a chosen time — `power.spec.ts` › "split an entry at a time"
- [x] Pin an entry as a favourite and start a timer from it — `power.spec.ts` › "pin an entry as a favourite and start it"
- [x] A favourite on an archived project cannot start — `power.spec.ts` › "a favourite on an archived project is disabled"
- [x] Save a project as a template and start a new project from it (tasks, members, rates copied); a template takes no time — `power.spec.ts` › "start a project from a template"
- [x] The Audit tab lists entries without a project or longer than 10 hours and bulk edit fixes them there — `power.spec.ts` › "the Audit tab lists problem entries and fixes them"

## Import

- [x] Import entries from a CSV: map columns, check every row, then import the ready ones — `import.spec.ts` › "import entries from a CSV: check, then import"
- [x] An import for another person's email needs permission — `import.spec.ts` › "a member cannot import time for someone else"

## Small screens (375px)

- [x] The tracker page fits a 375px screen without horizontal scrolling — `power.spec.ts` › "the tracker fits a 375px screen with favourites and the person picker"
- [x] At 375px the report filters fold into a sheet (Escape closes it after a picker) and the page does not scroll sideways — `reports.spec.ts` › "at 375px the filters fold into a sheet and the page does not scroll sideways"
- [x] The account and settings pages fit a 375px screen without horizontal scrolling — `settings.spec.ts` › "the account and settings pages fit a 375px screen"
