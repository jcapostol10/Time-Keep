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
- [ ] Change a member's role — gap

## Profile and settings

- [x] Change display name — `profile.spec.ts` › "update name and timezone, upload and remove an avatar"
- [x] Change timezone — `profile.spec.ts` › "update name and timezone, upload and remove an avatar"
- [x] Upload an avatar — `profile.spec.ts` › "update name and timezone, upload and remove an avatar"
- [x] Remove an avatar — `profile.spec.ts` › "update name and timezone, upload and remove an avatar"
- [ ] Avatar upload rejects a file that is not an image — gap
- [ ] Avatar upload rejects an image over the size limit — gap
- [ ] Change date format, time format and week start — gap
- [ ] Save timer settings (idle detection, Pomodoro, reminders) and see them after a reload — gap

## Time Tracker: timer bar

- [x] Start a timer, keep it running across a reload, stop it; the tab title shows the clock — `tracker.spec.ts` › "start, reload and stop a timer"
- [x] Pressing Enter twice quickly starts only one timer — `tracker.spec.ts` › "a double Enter starts only one timer"
- [x] Two browser tabs never show two running timers — `tracker.spec.ts` › "two tabs never show two running timers"
- [x] Create a project inline and start a timer on it — `timer-bar.spec.ts` › "create a project inline and start a timer on it"
- [x] Search the project picker and clear the project — `timer-bar.spec.ts` › "search the project picker and clear the project"
- [x] Pick several tags, including one created inline — `timer-bar.spec.ts` › "pick several tags, including one created inline"
- [x] Start right after creating a tag: the tag stays on the entry — `timer-bar.spec.ts` › "a tag created just before Start stays on the entry"
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
- [x] Edit project settings, mark it as a template, archive and unarchive it — `project-detail.spec.ts` › "edit project settings, mark it as a template, archive and unarchive it"
- [x] Members cannot open project detail — `project-detail.spec.ts` › "members cannot open project detail"
- [x] The Budget and Rates tabs say which phase brings them — `project-detail.spec.ts` › "the Budget and Rates tabs say which phase brings them"

## Projects and tasks in the tracker

- [x] Pick a task in the timer bar; the entry shows project and task — `project-picker.spec.ts` › "pick a task and the entry shows project and task"
- [x] Autocomplete fills the task along with the project — `project-picker.spec.ts` › "pick a task and the entry shows project and task"
- [x] Search the picker by task name — `project-picker.spec.ts` › "search the picker by task name"
- [x] The picker groups projects by client, favourites first — `project-picker.spec.ts` › "the picker groups projects by client with favourites first"
- [x] A member cannot see or pick a private project they are not on — `project-picker.spec.ts` › "a member cannot see or pick a private project they are not on"
- [x] Members cannot create projects or tags from the pickers — `project-picker.spec.ts` › "members cannot create projects or tags from the pickers"

## Tags

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
- [x] Clearing a cell deletes its entries — `timesheet.spec.ts` › "clearing a cell deletes its entries"
- [x] Invalid input reverts the cell — `timesheet.spec.ts` › "invalid input reverts the cell"
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

## Entry views

- [x] The same entry shows identically in the tracker, timesheet and calendar — `entry-views.spec.ts` › "an entry edited in the timesheet changes in the tracker and the calendar"
- [x] Editing an entry in one view updates the others — `entry-views.spec.ts` › "an entry edited in the timesheet changes in the tracker and the calendar"

## Tenant isolation

- [x] A member of one workspace cannot open another workspace's pages — `tenant-isolation.spec.ts` › "a member of one workspace cannot open another workspace's pages"
- [x] The workspace switcher lists only the user's own workspaces — `tenant-isolation.spec.ts` › "the switcher only lists the user's own workspaces"

## Small screens (375px)

- [ ] The tracker page fits a 375px screen without horizontal scrolling — gap
- [ ] The account and settings pages fit a 375px screen without horizontal scrolling — gap
