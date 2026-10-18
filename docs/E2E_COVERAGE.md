# End-to-end coverage

Every user-facing function of TimeKeep, and the Playwright test that proves it works. A ticked line names its spec file and exact test title; `pnpm --filter @timekeep/web e2e:coverage` fails if a ticked line names a test that does not exist. An unticked line is a gap still to cover.

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
- [x] Pressing Enter twice or S twice starts only one timer — `tracker.spec.ts` › "a double Enter or S starts only one timer"
- [x] Two browser tabs never show two running timers — `tracker.spec.ts` › "two tabs never show two running timers"
- [x] Create a project inline and start a timer on it — `timer-bar.spec.ts` › "create a project inline and start a timer on it"
- [x] Search the project picker and clear the project — `timer-bar.spec.ts` › "search the project picker and clear the project"
- [x] Pick several tags, including one created inline — `timer-bar.spec.ts` › "pick several tags, including one created inline"
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
- [x] Continue an entry: a new timer starts with the same details — `tracker.spec.ts` › "continue an entry"
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

## Tenant isolation

- [x] A member of one workspace cannot open another workspace's pages — `tenant-isolation.spec.ts` › "a member of one workspace cannot open another workspace's pages"
- [x] The workspace switcher lists only the user's own workspaces — `tenant-isolation.spec.ts` › "the switcher only lists the user's own workspaces"

## Small screens (375px)

- [ ] The tracker page fits a 375px screen without horizontal scrolling — gap
- [ ] The account and settings pages fit a 375px screen without horizontal scrolling — gap
