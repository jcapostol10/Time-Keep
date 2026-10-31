# Phase 5 — Approvals, time off, attendance, reminders, kiosk: design

Prompt: "Phase 5 — Approvals, time off, attendance, reminders, kiosk" in `Clockify Clone — Phased Claude Code Prompt Pack.md`. Checklist: `docs/PROGRESS.md` § Phase 5. Builds on the Phase 4 permission matrix, the entry service (`apps/web/src/server/time-entries.ts`, the only writer of `time_entry`), the report engine and the export pipeline. Written from the prompt without an interview (the owner chose to skip questions); every call the prompt does not make is marked as the builder's, so it can be checked while reading.

## Goal

The HR and payroll side of TimeKeep. Time that is officially approved and then cannot drift; past periods that are locked; leave that is requested, approved and counted against a balance; an attendance report a payroll clerk can export; reminders that chase missing time; and clock-in on a shared device for people who never sign in.

The phase is the PRD's Standard tier (kiosk extras are Pro). Plan limits arrive in Phase 8; here every workspace gets every feature through `planAllows`, which stays a stub returning true, and the one Pro-only option (kiosk photo capture) asks it.

## Delivery: three branches

The prompt estimates two to three sessions. The work ships as three branches, each merged, deployed and e2e-tested on its own, with its own additive migration run through the Migrate shared database workflow before its preview:

- **Phase 5a — approvals and locks** (Parts 1–2), plus the email outbox and the daily job runner every later part uses. Migration `0013_phase5a`.
- **Phase 5b — time off, attendance, targets** (Parts 3–5). Migration `0014_phase5b`.
- **Phase 5c — kiosk** (Part 6). Migration `0015_phase5c`.

Each branch gets its own implementation plan, written when it starts against the code the previous one leaves. `phase-5` is tagged after 5c's acceptance checks pass.

## Decisions (builder's calls; check these first)

1. **Email and scheduled jobs run without a new server (the owner chose this on 2026-10-31: Vercel only, no worker host).** The prompt says emails go through the pg-boss worker, but the worker has no host in production (`docs/BACKLOG.md`), and the app talks to Postgres through Supavisor's transaction mode. So:
   - Every email the phase sends is written to an `email_outbox` row **in the same transaction** as the change that causes it (a submitted period, an approval, a reminder). Nothing is sent inside a request.
   - One function, `drainOutbox(db, { limit })`, sends pending rows through the existing `sendEmail` (SMTP; Mailpit locally; capture on previews) with retries and backoff, and marks them sent or failed. It is idempotent and claims rows with `FOR UPDATE SKIP LOCKED`, so two drainers never send the same email.
   - Three things call it: `after()` at the end of the request that enqueued mail (so mail goes out within seconds), a protected Vercel Cron route `/api/cron/daily` (backstop and the daily jobs), and the pg-boss worker locally (a scheduled job every minute, so local development matches "through the worker").
   - The daily jobs (unsubmitted-period reminders, target reminders and alerts, monthly accruals are computed, not stored: see decision 9) run from the same cron route, once a day, against every workspace, evaluating the **previous local day** in each workspace's timezone. Vercel's Hobby plan allows one cron run a day; this design needs no more.
   - When a worker host exists, the worker calls the same functions; nothing else changes. *Cost if wrong:* if the owner wants pg-boss in production now, a small always-on host (Railway, Fly or Render) runs `apps/worker`, and the cron route becomes a no-op. The outbox stays either way, because it is what makes "the email is sent if and only if the change committed" true.

2. **Periods are workspace-wide and live in the workspace timezone and week start**, because a pay period is the company's, not each viewer's. The setting is one of WEEKLY (from the workspace week start), SEMI_MONTHLY (the 1st–15th and the 16th–month end) or MONTHLY. An entry belongs to the period that contains its **start** in the workspace timezone. Today the tracker, timesheet and reports group by the viewer's own timezone and week start (`resolveViewerPrefs`), so for someone in another zone a period can begin mid-way through the week they see: their screens mark each entry by **its** period (a read-only row or cell shows the period it belongs to), and the "Submit" control names the period's dates in full ("Submit 27 Oct – 2 Nov"), rather than assuming the visible week. The lock date (decision 6) is also in the workspace timezone; the Attendance report's days are each person's own (decision 13).

   Requests never overlap: submitting a period that overlaps a PENDING or APPROVED request is refused with the dates of the one it overlaps, and `assertWritable` looks up "any PENDING or APPROVED request of this person covering this entry's date" (an index on `(workspace, user, period_start, period_end)`), so it does not depend on the current period type. Changing the period type is refused while any request is PENDING; APPROVED and REJECTED history keep their dates. Turning approval off withdraws every PENDING request (logged) and leaves APPROVED periods read-only, because they were approved.

3. **A request is one person's whole period.** Status PENDING → APPROVED or REJECTED (rejection needs a note); the person may withdraw while PENDING (the request is deleted, its history kept in the event log); a REJECTED period is editable again and can be resubmitted. An approver may **reopen** an APPROVED request with a note: it becomes REJECTED (so the person can correct and resubmit), and the event log records REOPEN. Expenses join requests in Phase 6 (the request has no expense columns yet). A request records the totals it was submitted with (`work_seconds`, `entry_count`) so the Approvals page shows what was asked, and the per-user view also shows today's live totals.

4. **Who approves.** A workspace setting with three levels, each including the previous: Admins only (default); Admins and team managers (a manager approves the people they manage, directly or through groups); Admins, team managers and project managers (a project manager approves a request when **every** entry in it is on a project they manage). Managers and members never approve their own request. Owners and admins may approve their own, because a workspace often has one owner and nobody else to do it, and they can already edit any time. *Cost if wrong:* one matrix rule (`approval.review`) and one check.

5. **Submitted and approved time is read-only for its owner; admins edit it with a note.** A member or manager cannot create, edit, split, delete, bulk-edit, import or move an entry into a period of theirs that is PENDING or APPROVED; the refusal says why ("This week is submitted for approval."). Owners and admins can, and must give a note when the entry is in a PENDING or APPROVED period (theirs or anyone's); the note goes to the request's event log with the entry and the change. A lock alone (decision 6) never asks owners and admins for a note. An admin's edit does not reopen an approved period. A manager who approves cannot edit it either.

   How the note is asked for: the entry service refuses such a write without a note with a typed error (`NOTE_REQUIRED`); every write action accepts an optional `note`; on the client, one helper wraps the entry mutations (tracker rows, timesheet cells, calendar moves and dialogs, split, delete, restore, duplicate) so a `NOTE_REQUIRED` answer opens a single "Why are you changing approved time?" dialog and retries with the note. Bulk edit and the CSV import show a Note field when the server's check says some of the entries are in such a period. *Cost if wrong:* the check lives in one function in the entry service; the dialog is one component.

6. **Locks are a date, computed at the moment of the check.** The lock setting is OFF, FIXED (a date) or ROLLING (N days: everything before the start of the day N days ago in the workspace timezone). "Recalculated daily" falls out of computing it at check time; no job writes it. Non-admins (managers and members, including a manager adding time for someone) cannot create, edit, split, delete or import an entry whose start (before or after the change) is before the lock. Stopping a running timer is always allowed, even across the lock, so a timer can never be stuck. Owners and admins are not locked. The lock and the approval check sit together in the entry service as `assertWritable(scope, before, after)`, called by every write path.

   Writes that are not entry edits: the "apply to past entries" rate job skips entries in APPROVED periods (as the Phase 4 design promised: an approved entry keeps its rate); the currency relabel still relabels them (it changes the label, not an amount); deleting a project is refused while it has entries in PENDING or APPROVED periods ("archive it instead"), since moving or deleting them would change approved time.

7. **Notes and edits are kept in an event log, not an audit system.** `approval_event` records submit, withdraw, approve, reject (with note), admin edit (with note, entry id, and the before and after of the fields changed). Phase 8's audit log is wider and separate.

8. **Time off is not time tracked.** Approved time off is its own table, never a `time_entry`. It shows on the Calendar (an all-day or partial-day band), in the Timesheet (a read-only row "Time off: <policy>"), on the Time off page and in the Attendance report, but not in Summary, Detailed or Weekly totals, and it is never rated or invoiced.

9. **Balances are computed, not stored.** A balance is: the policy's grants up to today, plus manual adjustments, minus approved requests, for that person and policy, in the policy's unit. Grants: NONE (balance comes only from adjustments; "unlimited" when negative balances are allowed and nothing is granted), YEARLY (the full allowance on 1 January in the workspace timezone; no proration, no carry-over in 5b) or MONTHLY (allowance ÷ 12 on the first of each month, accrued from the person's join date or the policy's assignment date, whichever is later). PENDING requests do not reduce the balance but are shown next to it and count when checking whether a new request would go negative. *Cost if wrong:* the maths is one pure function in `packages/core`, unit-tested; carry-over and proration are later options on the policy.

10. **A day of time off means a working day.** Each member has a capacity: daily hours (default 8), weekly hours (default 40) and working days (default Monday to Friday), set on the Team page (admins). A DAYS request counts the person's working days in the range, minus holidays that apply to them; a half day is 0.5 and is only allowed on a one-day request. An HOURS request takes hours per day for one day, or a total for a range. Converting is not needed: a policy is in one unit.

11. **Holidays work for any country (the owner asked for this on 2026-11-01: mainly Filipino users, but no country built in).** A holiday is a date, a name and "repeats every year"; with no users or groups assigned it applies to the whole workspace, and assigning it to users or groups covers teams in different countries within one workspace. Holidays are not requests and need no approval; they reduce capacity (decision 13) and are skipped when counting DAYS.

    - **Import public holidays**: the Holidays tab has "Import public holidays" with a country (and, where the data has them, a region), a year, and the list to review before anything is added: each row can be unticked or renamed, and nothing is imported twice (same date and name). The country defaults to the one the workspace timezone points to (`Asia/Manila` suggests the Philippines), and every country the data covers can be chosen.
    - **The data** comes from a maintained open-source holiday dataset bundled with the app (the builder's choice, `date-holidays` or an equivalent, after checking its licence allows our use; no external API is called at request time). Imported rows are plain holiday rows with a `source` ("imported: PH 2027") and are editable, because governments move or add days: in the Philippines, for example, Eid'l Fitr and Eid'l Adha are proclaimed each year and special non-working days are added by proclamation, so the import marks dates the dataset only estimates and the admin confirms or corrects them.
    - **Only public (statutory) days** are offered by default, with an option to include observances and optional days where the dataset distinguishes them.
    - **Manual holidays** (company days, local feasts) are added by hand, alone or repeating every year.
    - The demo seed imports the Philippines for this year and next, as an admin would; nothing in the code is specific to the Philippines.

12. **Time off requests follow the same approver rule as timesheets** (decision 4), and a policy that does not require approval approves on submit. Cancelling an approved request is an approver's action (a member asks by withdrawing while pending, or asks an admin). Rejection needs a note.

13. **Overtime is work beyond capacity, after time off and holidays.** Per person per day in their timezone: first start, last end, work (stopped work entries, as reports count them, raw time, rounding never applied), breaks, time off (hours; a full day off is the daily capacity), and capacity = daily hours on a working day, 0 on a non-working day or a holiday, minus time off that day. Daily overtime = max(0, work − capacity); undertime = max(0, capacity − work) on working days. The weekly view sums the week and computes weekly overtime against the weekly hours minus time off. The report reads one person's own row for members, their scope for managers, and everyone for admins (the existing `scopeFilter`). Export CSV, Excel and PDF through the existing column-record pipeline (`report-export.ts`).

14. **Target rules are workspace rules with two kinds.** UNDER: "remind anyone who tracked less than X hours on a working day / in a week" (sent to the person). OVER: "alert when someone tracks more than Y hours in a day / week" (sent to the workspace's admins and that person's team managers). Each rule names its users and groups (default everyone). The daily job evaluates yesterday (daily rules) and, on the first day of the week, last week (weekly rules), skipping holidays and full days off. A person can mute reminders for themselves (`user_settings.mute_target_reminders`); alerts to managers cannot be muted per subject. The weekly "you have unsubmitted periods" reminder is the same job.

15. **A kiosk is a device, not a user.** An admin creates a kiosk (name, default project, optional default task, allowed users and groups, session timeout in seconds, show logo), and gets a device URL `/kiosk/<token>` where the token is 32 random bytes and only its sha256 is stored, as share links are. Opening it needs no login and sets nothing in any session; the token can be rotated or the kiosk disabled. All kiosk requests go through one route family `/api/kiosk/<token>/…`, rate-limited per kiosk.

16. **On the kiosk a person picks their name, then proves it.** The screen lists the kiosk's allowed people (names and avatars). The person taps their name and enters their PIN (4 to 6 digits), or scans their personal QR code with the device camera, which identifies and proves at once. PINs are per person per workspace, hashed with the same scrypt Better Auth uses, and set by the person on their profile or by an admin for limited users. QR codes carry a random per-person token (sha256 stored, rotatable), shown on the person's profile as a printable code. **Brute force:** five wrong PINs for one person on one kiosk lock that person on that kiosk for 15 minutes, and 30 failures on a kiosk in 15 minutes lock the kiosk's PIN entry for 15 minutes; every attempt is counted in `kiosk_attempt`. A 4-digit PIN is only as strong as this throttle, which the kiosk screen says on the PIN setup page.

17. **A punch is a normal entry.** Clock in = `startTimer` for that person, with the kiosk's default project and task, description "Kiosk: <kiosk name>". Clock out = `stopTimer`. Start break = stop the work entry and start a break (`type = 'break'`; needs the workspace's breaks setting, otherwise the kiosk shows no Break button). End break = stop the break and start work again with the kiosk defaults. Every punch goes through the entry service with the person's own scope, so locks, approvals, force timer and required fields all apply (a required field the kiosk's defaults do not satisfy blocks Clock out with the message, and the admin fixes the kiosk's defaults). After a punch the screen shows the person's work today and returns to the name list after the session timeout.

18. **Limited users are members without an email login.** An admin adds a limited user with a name only. The `user` row gets a synthetic, undeliverable address (`limited+<id>@kiosk.invalid`), no password and no account row, so Better Auth can never sign them in; `membership.limited = true`. They appear on the Team page with a "Kiosk only" badge, in reports and attendance like anyone else, and are never emailed (the outbox skips `.invalid` addresses). An admin can convert one to a normal member by entering a real email. The same `user` row keeps its id (so its entries, rates, PIN and groups stay): its email is replaced and a "set your password" email (Better Auth's reset-password link, through the outbox) goes to the new address; `membership.limited` becomes false. An address that already has an account is refused ("this address already has an account; invite it instead"), since merging two people's history is out of scope. Seats are Phase 8.

19. **Photo capture is optional, Pro-tier, and private.** A kiosk setting "Take a photo at clock in" (behind `planAllows(workspace, "kioskPhoto")`) shows a consent notice on the kiosk before the camera is used, captures one JPEG at clock in, and stores it in the private bucket (`S3_EXPORT_BUCKET` style, never public) under `kiosk-photos/<workspace>/<entry>.jpg`, linked to the entry. Admins see it in the entry's details through a short-lived presigned URL. Photos are deleted after 90 days by the daily job.

20. **Permissions are new matrix actions, documented by the generator.** `approval.submit` (own), `approval.review` (decision 4), `approval.editLocked` (owner, admin), `lock.manage`, `timeOff.request` (own), `timeOff.review` (decision 4's rule), `timeOff.manage` (policies, holidays, adjustments: admins), `attendance.read` (the report's scope), `target.manage` (admins), `kiosk.manage` (admins), `pin.setOwn` (anyone), `member.manageLimited` (admins). `docs/PERMISSIONS.md` regenerates; `authorize-coverage.test.ts` covers every new action and route, and the kiosk routes are listed as authorized by the kiosk token.

## Part 1 — Approval (5a)

- Settings → Approval section: Period (Weekly / Semi-monthly / Monthly), Approvers (the three levels of decision 4), and "Require approval" on or off (off hides the feature).
- Time Tracker and Timesheet show the current period's status and a **Submit for approval** button for each closed or current period of the person's that is not submitted; a submitted period shows "Pending" with **Withdraw**; approved shows a lock icon; rejected shows the note and **Resubmit**.
- **Approvals page** (nav item for anyone who can review, and for everyone to see their own requests): tabs Pending, Unsubmitted (people and periods with time but no request, for approvers), Archive (approved and rejected). Rows: person, period, work and billable totals as submitted, submitted at. Select several and Approve or Reject (one note for all). Clicking a row opens the per-user period view: the entries by day with totals, the event log, Approve / Reject.
- Emails (through the outbox): to approvers when a period is submitted; to the person when it is approved or rejected (with the note); the weekly unsubmitted reminder to people with time in a closed, unsubmitted period.

## Part 2 — Lock timesheets (5a)

- Settings → Lock section: Off / Lock entries before a date (date picker) / Lock entries older than N days. The UI shows "Entries before 24 October are locked" under the tracker, timesheet and calendar for non-admins, makes those rows and cells read-only, and the server refuses (decision 6).

## Part 3 — Time off (5b)

- **Time off page**: tabs Requests (mine, and to review for approvers), Calendar (month view of who is away, with holidays), Balances (per person per policy; admins and managers in scope), Policies (admins), Holidays (admins).
- Policy form: name, unit, accrual (none, yearly allowance, monthly accrual) with the amount, allow negative balance, requires approval, assigned users and groups (or everyone), archived.
- Request form: policy, dates (one day: full, half, or hours; range: days or a total of hours), note; it shows the balance before and after.
- Approved time off shows in the Calendar (decision 8) and the Timesheet. Adjustments (admins): a signed amount with a note, on the Balances tab.
- Emails: request to approvers, decision to the person.

## Part 4 — Attendance report (5b)

- A fifth Reports tab, **Attendance**, with the reports' date range and Users / Groups filters (no project filters: it is about presence). Daily rows per person (decision 13), a weekly subtotal, and totals. Export CSV, Excel and PDF. Members see their own.
- Capacity on the Team page: daily hours, weekly hours, working days (admins), in the member's row menu.

## Part 5 — Targets and reminders (5b)

- Settings → Targets: a list of rules (decision 14) with kind, threshold, period (day/week), who it applies to, active. Account → Timer section gains "Mute target reminders". The daily job sends through the outbox.

## Part 6 — Kiosk (5c)

- **Kiosks page** (admins): list, create/edit (decision 15), copy the device URL, rotate its token, disable.
- **Kiosk screen** `/kiosk/<token>`: full-screen, large touch targets, works at 375 px and on a tablet: the allowed people, then PIN pad or QR scan, then Clock in / Start break / End break / Clock out according to the person's state, then today's work, then back to the list after the timeout. The device's clock is not trusted: every punch takes the server's time.
- **Profile → Kiosk**: set or change your PIN, show and print your QR code, rotate it. **Team → Add limited user** (decision 18) and set a limited user's PIN.

## Data model

Migration `0013_phase5a` (additive):

- `workspace_settings`: `approval_enabled boolean default false`, `approval_period enum (WEEKLY, SEMI_MONTHLY, MONTHLY) default WEEKLY`, `approval_reviewers enum (ADMINS, TEAM_MANAGERS, PROJECT_MANAGERS) default ADMINS`, `lock_mode enum (OFF, FIXED, ROLLING) default OFF`, `lock_date date null`, `lock_days smallint null`.
- `approval_request` (`id`, `workspace_id`, `user_id`, `period_start date`, `period_end date`, `status enum (PENDING, APPROVED, REJECTED)`, `work_seconds bigint`, `billable_seconds bigint`, `entry_count int`, `submitted_at`, `decided_by?`, `decided_at?`, `note?`); unique (workspace, user, period_start); index (workspace, user, period_start, period_end) for `assertWritable`; index (workspace, status, period_start) for the Approvals page.
- `approval_event` (`id`, `workspace_id`, `request_id?`, `user_id` (whose period), `actor_id`, `action enum (SUBMIT, WITHDRAW, APPROVE, REJECT, REOPEN, ADMIN_EDIT, AUTO_WITHDRAW)`, `note?`, `entry_id?`, `changes jsonb?`, `created_at`).
- `email_outbox` (`id`, `workspace_id?`, `to`, `subject`, `html`, `text`, `kind`, `status enum (PENDING, SENT, FAILED)`, `attempts`, `next_attempt_at`, `last_error?`, `created_at`, `sent_at?`); index (status, next_attempt_at).
- `user_settings.mute_target_reminders boolean default false` (used in 5b; added here so 5a's weekly reminder can honour it).

Migration `0014_phase5b`: `time_off_policy` (+ `time_off_policy_assignee` user/group rows), `time_off_request`, `time_off_adjustment`, `holiday` (`id`, `workspace_id`, `date`, `name`, `repeats_yearly`, `source?` e.g. "imported: PH 2027", `country?`) (+ `holiday_assignee`), `membership.daily_capacity_minutes default 480`, `weekly_capacity_minutes default 2400`, `working_days smallint[] default {1,2,3,4,5}`, `target_rule` (+ `target_rule_assignee`).

Migration `0015_phase5c`: `kiosk` (+ `kiosk_assignee`), `kiosk_credential` (per membership: `pin_hash?`, `qr_token_hash?`, rotated_at), `kiosk_attempt`, `kiosk_photo` (entry id, object key, taken_at), `membership.limited boolean default false`.

Every new table enables RLS; `docs/DATA_MODEL.md` gains them and moves them out of "Planned".

## Access rules (summary; the full table is generated into `docs/PERMISSIONS.md`)

| | Owner | Admin | Manager | Member |
| --- | --- | --- | --- | --- |
| Submit, withdraw own periods; request own time off | yes | yes | yes | yes |
| Approve or reject periods and time off | yes | yes | per the approvers setting (their people, or their projects) | no |
| Edit submitted or approved or locked time | with a note | with a note | no | no |
| Approval, lock, targets, policies, holidays, kiosks, limited users | yes | yes | no | no |
| Attendance report | all | all | their scope | own |
| Use a kiosk | through an allowed kiosk, with their PIN or QR | | | |

## Tests

- **Core**: the period maths (weekly from each week start, semi-monthly at 15/16 and month ends incl. February and leap years, monthly; DST-safe in New York and Manila); the approval state machine (every allowed and refused transition); the lock date for FIXED and ROLLING at local midnight; accrual maths (yearly, monthly from a mid-month join, adjustments, negative allowed or not, pending counted for the check only); working-day counting with holidays and half days; overtime and undertime per day and per week with time off and holidays; the holiday import (a country and year to rows, de-duplicated against existing rows, region and type filters); target rule evaluation.
- **Web integration**: `assertWritable` on every write path (start, stop, manual, edit, split, duplicate, continue, delete, restore, bulk edit, timesheet copy-week, calendar, import, add-for-others) for a PENDING, an APPROVED and a locked period, for a member, a manager and an admin (who passes with a note); the stop of a running timer across the lock; the approvers setting at each level, including "nobody approves themselves" and the project-manager "every entry" rule; the outbox (enqueued in the same transaction, rolled back with it, drained once by two concurrent drainers, retried with backoff, `.invalid` skipped); the daily job against two workspaces in different timezones; balances and requests; the attendance query against the report engine's totals for the same range; kiosk token, PIN and QR checks and both throttles; a kiosk punch passing through locks and force timer; limited users never signing in.
- **E2E** (lines added to `docs/E2E_COVERAGE.md` before code, failing first):
  - The acceptance checks: an approved week cannot be edited by its member (the tracker row, the timesheet cell and a crafted request all refuse); time off reduces the balance and appears on the calendar; a kiosk punch creates a normal entry visible in the Detailed report.
  - Plus: submit, withdraw, resubmit after rejection; bulk approve from the Pending tab; the approval emails in Mailpit; a rolling lock blocks a member and not an admin; a time off request needing approval; importing a country's public holidays (review, untick one, import) and assigning a holiday to a group; the Attendance tab with overtime and its CSV; a target reminder email after running the daily job route; kiosk PIN punch in, break, out; the PIN lockout after five failures; a QR punch (a fake camera stream); a limited user on a kiosk; the kiosk screen at 375 px.
- **Perf**: the Attendance report for one year over the perf seed stays under one second (`report:perf` gains it); `assertWritable` adds at most one indexed query per write.

## Out of scope (later phases)

- Expenses in approval requests, and invoicing approved time (Phase 6).
- Carry-over, proration and expiry of leave, leave in payroll exports (later options; Phase 6 for payroll).
- Scheduling capacity beyond the per-member hours (Phase 7).
- Plan limits, seats (limited users' price) and billing (Phase 8; `planAllows` is a stub).
- A general audit log (Phase 8).
- Geofencing, GPS or face recognition on kiosks.

## Risks

- **Every write path must call `assertWritable`.** A missed path lets approved time drift. Mitigations: one function in the entry service, a table-driven integration test over every exported write function, and a static test like `authorize-coverage.test.ts` that fails when an exported write function in `time-entries.ts` does not call it.
- **The outbox and Supavisor.** `FOR UPDATE SKIP LOCKED` and plain inserts work in transaction mode; nothing uses `LISTEN/NOTIFY` or session advisory locks. A drainer killed mid-send can send an email twice (sent, then killed before marking it); accepted, as every mail service is at-least-once.
- **One cron run a day** means a reminder arrives the morning after, not at 18:00. Stated in the settings copy ("sent the next morning").
- **Kiosk security.** The device URL is a bearer token; a leaked URL lets anyone use the kiosk's PIN pad, not sign in to the app. Throttles bound PIN guessing; the token rotates; kiosk routes never return anything but the allowed people's names, avatars and their own today's totals.
- **Shared database.** Three additive migrations, each through the migrate workflow before its preview. New enums and columns with constant defaults only.
