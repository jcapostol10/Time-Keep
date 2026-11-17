# Backlog

Known gaps and deferred fixes that are not part of a phase checklist. When an item is fixed, move it to **Done** with the date and the commit. Add new deferred findings here as they come up (code-review minors, things a test run exposed, setup left for later).

The cleanup of 2026-11-17 (`docs/superpowers/specs/2026-11-17-backlog-cleanup-design.md`) gave every open entry an outcome. Each entry below is tagged with the branch that fixes it (**b1**–**b5**). Feature ideas moved to **Later**, and entries settled by a ruling moved to **Done**.

## Needs the owner

- [ ] **Production email:** verify a sending domain in Resend and set `MAIL_FROM` to an address on it (Vercel → Production env, then redeploy). Until then, production can only email the Resend account owner, so sign-up verification, password reset and invites fail for everyone else. On our side (2026-10-22): production refuses to boot with a placeholder sender, a failed send tells the person what happened instead of a bare 500, and Profile settings has "Send me a test email" to check the sender. Resend verifies only a domain you own, so this waits for the custom domain.
- [ ] **Production is behind Vercel Authentication.** Deployment protection covers every deployment, production included, so anyone not signed in to the Vercel team gets a Vercel login page instead of TimeKeep. Before real customers use it, add a custom domain outside protection (or switch protection to previews only). Until then, a Vercel shareable link (`?_vercel_share=…`, from the deployment's Share button) lets a named person in; they open it first in each browser, and report share links, invoice links and kiosk URLs still stop at the Vercel login for everyone else. The e2e workflow only targets previews, so it is unaffected.
- [ ] **Check for clients whose currency was set before Phase 6a.** The client dialog has offered Currency since Phase 3 with no effect; from 6a it is what the client's projects are billed in. New time on such a client's projects is unrated until the project has a rate in the client's currency. Run privately (through the Supabase plugin or the SQL editor, never in a public Actions log), leaving out the demo and e2e tenants: `select w.slug, c.name, c.currency, ws.currency as workspace_currency from client c join workspace w on w.id = c.workspace_id join workspace_settings ws on ws.workspace_id = c.workspace_id where c.currency is not null and c.currency <> ws.currency and exists (select 1 from membership m join "user" u on u.id = m.user_id where m.workspace_id = c.workspace_id and u.email not like '%@e2e.test' and u.email not like '%@demo.test' and u.email not like '%@kiosk.invalid');` and, for each row that was not meant, set the client back to the workspace currency.
- [ ] **Review the Phase 6 decisions.** The design (`docs/superpowers/specs/2026-11-05-phase-6-design.md`) was written without an interview; its 28 decisions and the 6a rulings in `docs/PROGRESS.md` are the builder's. The two that shape 6a: no currency conversion anywhere, and a rate applies only in its own currency.
- [ ] **Review the Phase 7 decisions.** The design (`docs/superpowers/specs/2026-11-11-phase-7-design.md`) was written without an interview; its 22 decisions and the 7a rulings in `docs/PROGRESS.md` are the builder's. The ones that shape 7a: a published assignment is never edited in place (drafts replace it at Publish), members see only their own published plan, and approved time off lowers capacity rather than removing an assignment's day.
- [ ] **Review the cleanup rulings** (`docs/superpowers/specs/2026-11-17-backlog-cleanup-design.md`, 17 rulings, and its Later list).

## App

### b1 — tracker, timesheet, calendar, catalog, auth, CI



- [ ] **b1 review minors** (final review, 2026-11-17):
  - Add row does nothing when localStorage throws (blocked site data); fall back to component state for the visit.
  - `copyWeek` collapses two identical source entries into one, and reads the target week outside its transaction and the person's lock, so two tabs copying at once can still duplicate.
  - Back after a filter change gives a URL without `sort=` while the Detailed view keeps its sort until a reload.
  - A member's report filters still come from the picker: archived projects with their old entries are missing, and a client whose only visible projects are archived is still listed.

### b2 — approvals, time off, attendance, targets, kiosks, the daily cron

- [ ] **b2** Kiosk default tag (ruling 8): with a required tag, nobody can clock out on a kiosk, because a kiosk adds no tags; add `kiosk.tag_id` (additive migration) and a picker.
- [ ] **b2** Phase 5c review minors:
  - The QR path of `identify` treats any error from `allowedPerson` as "not allowed", so a database error counts as a QR failure; catch only `WorkspaceAccessError`.
  - An unknown QR payload costs nothing to send and counts toward the kiosk's 30-failure pause, so whoever has the URL can pause PIN entry; stop counting failures with no person toward the pause.
  - `savePunchPhoto` uploads before it inserts the row, so an insert failure leaves an object the purge never finds.
  - `photo: true` reaches a public share page's payload when the link's creator manages kiosks (not rendered, existence only); strip it on the share path.
  - `removeMember` keeps `kiosk_assignee` rows, so re-inviting someone silently re-allows them on that kiosk.
  - The device URL's Copy has no failure toast (insecure contexts), and an emptied timeout field shows a raw validation message.
  - The session timeout can fire while a punch is in flight (the photo capture waits for the camera); clear it while busy.
  - `credentialStatuses` returns `pinSetAt`, which no UI reads.
- [ ] **b2** Phase 5a review minors: `approversFor` uses the root pool inside the submit transaction (pass `tx`); the guard runs three statements per write (load the rules once per bulk edit or import); an owner's or admin's timer started with a note in a pending period can still be running when the period is approved; the settings check counts pending requests outside the update transaction; `deleteProject`'s submitted-time check takes no person lock; the daily reminder fires only on the first local day after a period and its dedupe is read-then-insert; `email_outbox` keeps full HTML forever (add retention, keep the reminder rows); `lock.manage` and core `transition()` are unused; the note prompt cancels an open prompt when a second write asks, Undo after a delete asks again, and a cancelled multi-owner delete restores rows already deleted; decision emails link to the timesheet, not the period; the Approvals tables lack billable totals; no web-level test with the viewer's zone different from the workspace's; Detailed report rows are not marked read-only for locked time.
- [ ] **b2** Phase 5a: a workspace timezone change while periods are APPROVED is allowed (ruling 5 keeps it); the settings page says what it moves before saving.
- [ ] **b2** Phase 5b: the request dialog offers an owner or admin only the policies assigned to them, but only the Policies tab shows assignment; an admin asking for time off on an unassigned policy gets "Not found".
- [ ] **b2** Phase 5b review minors (2026-11-03): the target dedupe reads every `target:%` outbox row the workspace ever had (narrow it to today's kinds); a member is reminded about days before they joined; an HOURS request over a range with no working days takes balance but shows nowhere (refuse it as DAYS does); the "Estimated" holiday badge cannot be cleared after the admin confirms the date; `/time-off/holidays` returns holidays' assignees to members (strip them as `listPolicies` does); the Attendance tab ignores a hidden Reports page; the group lookups in `peopleContext` and `listPolicies` are not scoped by workspace; `requestTimeOff` calls `approversFor` with the pool inside its transaction; Attendance's ±1-day window misses up to 2 h between UTC+14 and UTC−12 (use ±2 days); the preview answers 404 for an unassigned or archived policy so the dialog shows nothing; approval does not re-check the balance after a negative adjustment.
- [ ] **b2** Phase 5a: auth (verification, reset, magic link) and invitation emails are still sent inside the request; move them to the outbox (`enqueueEmail` + `drainSoon`).
- [ ] **b2** Phase 5a: an empty timesheet cell in a locked day or a submitted period stays typeable; mark those days read-only from the period list and the lock boundary.
- [ ] **b2** Phase 5a: a locked row's Duplicate, Split and Delete stay enabled in its menu; disable them with the reason.
- [ ] **b2** Phase 5a: the Unsubmitted tab shows a project manager only the people they manage, not people whose time is all on the manager's projects.
- [ ] **b2** Phase 5a: `assertWritable` reads its own `workspace_settings` row next to `rulesOf`'s; fold the two reads into one.
- [ ] **b2** Phase 5a: an owner's or admin's import into submitted periods writes one `ADMIN_EDIT` event per entry; write one per import.
- [ ] **b2** The daily cron runs at 22:00 UTC, so a workspace far west of UTC gets its reminder a day late. Run it hourly and act per workspace at its local morning (ruling 9).

### b3 — money: rates, cost, currencies, budgets, expenses, invoices

- [ ] **b3** **A cost rate applied to past entries re-rates billable snapshots too.** One job re-rates both snapshots from the date. Add a `kinds` column on `rate_recalc_job`.
- [ ] **b3** **Client currencies come from the short list** (`COMMON_CURRENCIES`, about twenty codes), though the server accepts any ISO 4217 code. Offer a searchable list of all of them.
- [ ] **b3** **Phase 6a review minors** (final review, 2026-11-06):
  - The relabel decisions (`updateClient`, `updateProject`, `setRate`'s currency) are read before the transaction opens; lock the client row or take a workspace advisory lock inside the transaction.
  - The client dialog still says "Its projects are not affected" when editing; a currency change does affect them.
  - The Summary hides Cost and Profit under 640px while the cost notes still show.
  - A row billed only in another currency with nothing rated prints a workspace-currency zero, and the export has no column for that currency.
  - The Status tab has its own "is there a profit" rule instead of core `hasProfit`, and no note about entries without a cost rate.
  - Core has two constants named `COMMON_CURRENCIES` (`currencies.ts`, `money.ts`), and `isCurrencyCode` depends on the runtime's Intl list, so browser and server can disagree.
  - Only owners and admins see the "Set a project rate" notice; a project's manager is not told their project is unrated.
  - On a Profit row that mixes currencies, Cost includes the hours profit leaves out, so Amount less Cost is not Profit; the note should say so.
  - Untested: `deleteProject` reassigning entries across currencies (the code re-rates both snapshots).
  - A relabel is one `UPDATE time_entry` inside the request; not measured on a large workspace.
- [ ] **b3** **Phase 6b review minors** (final review, 2026-11-09):
  - The alert dedupe loads every `budget:%` outbox row of the workspace on every daily run; narrow it to the candidate kinds computed from `crossedThresholds`.
  - `ThresholdsInput` keeps its typed text after a save normalises the value, and a non-numeric token shows the default zod message.
  - The Budget chart bounds its series at local tomorrow while a whole-project bar has no upper bound, so a future-dated entry shows in the bar and not in the chart's last point.
  - `getProjectBudget` reads `workspace_settings` twice; the page already holds `ctx.settings`.
  - `hasRates` counts any non-null billable row in force in the project's currency, so the "no rate" notice can hide when nobody on the project is rated.
  - `summaryReport` computes budget progress for exports and the Profit tab, which never render it. Pass a flag.
  - The perf seed has no estimated project, so `report:perf` does not exercise the Summary with the progress path.
  - No advisory lock around `evaluateBudgets`: two concurrent daily runs could double-send.
  - The Budget chart samples weekly past 62 days instead of bucketing by week.
- [ ] **b3** **Phase 6c review minors** (final review, 2026-11-10):
  - Expense writes are authorised through `scopeForUser`'s `entry.write`; `expense.write` is read only for the `editable` flag.
  - `expenseCategoryPatchSchema` validates the patch, not the merged row: `{ unitPriceMinor: null }` on a UNIT category passes.
  - `usableProject` does not refuse a template project the way the entry service does.
  - Receipt keys are deterministic, so a failed transaction after the upload leaves the new bytes under the old row's MIME; the upload also holds the connection and the person's lock for the S3 round trip. Use a versioned key.
  - Each receipt thumbnail runs `getExpense` → `toDTOs` → `expenseLockedReasons` (about six queries) and mints a new presigned URL; use a lighter read.
  - `lockedReasons` reads `writeRulesOf` twice per tracker or timesheet read; `myPeriods` runs the expense totals it never uses.
  - The period page's "changed since submission" flag compares work seconds only, not expenses.
  - The edit dialog removes a receipt before the save (a failed save loses it) and can ask an admin for a note up to three times.
  - A `projectIds=none` carried from another report tab matches nothing on the Expenses tab, which hides the "Without project" option.
  - `parseQuantity(".5")` is refused; `fflate` is `^0.8.3`, not pinned exactly; `createExpense` checks the project and category outside its transaction; one missing receipt object fails the whole zip job.
  - No integration test of the Profit tab for a manager with expenses in and out of scope.
- [ ] **b3** **Phase 6c, expenses:** the unsubmitted-period reminder counts time only; receipts of soft-deleted expenses are never purged; the receipts zip is built in memory (stream it); EXIF orientation is not read when a photo is shrunk; the expense dialog's project picker lists the viewer's own projects when adding for someone else.
- [ ] **b3** **Phase 6d, invoicing:** a recurring template catches up only 7 days (ruling 13: 31); `captured_email` keeps no attachment, so the PDF attachment is checked in the nightly lane only; the client dialog does not warn before a currency change on a client with invoices; a page left open past midnight defaults its date fields to the day it was opened.
- [ ] **b3** **Phase 6d review minors** (final review, 2026-11-10): the editor's "sent" date is the UTC date of `sent_at`, not the viewer's; a quantity of 1e9 at a price of 1e13 overflows `bigint` (an opaque error), many such lines pass `Number.MAX_SAFE_INTEGER` in `invoiceTotals`, and `next_number` has no upper bound on an `int4`; a client email whose PDF attachment is missing fails after its retries while the invoice reads Sent and no admin is told; a public PDF download bumps `invoice.updated_at`; Chromium renders the frozen PDF inside the send transaction, holding the row lock and a pooled connection for seconds; notes edited after sending show on the public page but not in the frozen PDF; `deleteProject`'s invoiced-time check has the same lock-free window against a concurrent import that the guard had.

### b4 — schedule and forecast

- [ ] **b4** **Phase 7a deferred:** split only by right-click on the team grid (add Split to the bar menu); the Calendar band shows the viewer's own plan only, never the person shown by add-for-others; a removed or deactivated member's assignments stay in the table with no row on the grid; the Team tab has no group or project filters yet, and Previous / Next do not prefetch the adjacent range.
- [ ] **b4** **Phase 7b deferred:** `schedule.spec.ts` › "a draft is hidden from the member until Publish…" missed the publish email once in the 15 s wait (2026-11-11), not reproduced since; add diagnostics that print the outbox row's `status`, `attempts` and `last_error` when it recurs.
- [ ] **b4** **Phase 7b review minors** (final review, 2026-11-11):
  - The forecast's tracked side counts the whole period, so a manual entry dated after today is counted with the plan for that day too (and "Reached on" can be a future date).
  - The Assignments PDF header lists the shared query's task, tag, billable and description filters, which the report ignores, and omits groups.
  - The Assignments XLSX writes durations (with U+2212) and the percent as text.
  - The tracked window is a day either side of the viewer's range: widen to two days.
  - The Budget tab scans the project's entries three times per load; the forecast could reuse the chart's daily rows.
  - The chart's caption does not mention the scheduled projection; the totals row's Variance % is not coloured.
  - A removed member's rows keep their name rather than "(former member)".
- [ ] **b4** **Phase 7a review minors** (final review, 2026-11-11):
  - Writers do not take the `schedule:` lock and `draftsInScope` does not lock its rows: a draft edited out of the publisher's scope mid-publish is still applied, and an edit racing a publish can deadlock.
  - `draftCount` counts drafts that Publish skips (an out-of-scope original).
  - Splitting a tiny total can store a `0:00 total` part, and a first part with no working day fails with zod's default text.
  - The publish bar's "Published …" time uses the browser's locale and zone, not the viewer's preference.
  - A `projectIds` filter naming a private project confirms it has assignments (grey rows); intersect the filter with visible projects.
  - `copyAssignment` checks only the destination, so a copy by a published id can duplicate another planner's out-of-scope draft.
  - Saving an unchanged published assignment makes an identical draft.
  - Drags have no `pointercancel` / Escape handling, and every pointer move re-renders the grid even when the column did not change.
  - The grid has no arrow-key navigation, bars sit outside gridcells, the resize handles are keyboard tab stops that do nothing, and the project rows' "Expand" buttons share one label.
  - The schedule read's perf test asserts 2 s where the design said 500 ms (measured 138 ms).

## E2E suite

- [ ] **b5** `others.spec.ts` "the timer bar stays the viewer's own" is a weak test: rewrite it so a real break fails it, or delete it and its coverage line (ruling 15).
- [ ] **b5** Local `pnpm e2e` runs against the dev server, where three workers occasionally close an open picker mid-test; make it build and start a production server (ruling 16).
- [ ] **b5** Backfill the rest of `docs/E2E_COVERAGE.md`, in this order: entry list (week paging, inline time/date edits, bulk delete), timer settings with `page.clock` (idle, Pomodoro, reminders), Phase 0 gaps, 375px layouts.
- [ ] **b5** Re-prove the 26 coverage ticks carried over from Phases 0–1: break each guarded behaviour once and watch its test fail.
- [ ] **b5** `projects.spec.ts` "filter, search and sort the projects list" was flaky once (2026-11-11), and `settings.spec.ts` "a required project blocks Stop until it is picked" once (2026-10-29); add diagnostics that print the cause if either recurs (ruling 15).

## Coverage check (`apps/web/scripts/coverage-check.ts`)

Nothing open.

## Docs

Nothing open.

## Later

Moved here by the cleanup of 2026-11-17. A Phase 8 or 9 entry is picked up by that phase's design; "not planned" means the PRD excludes it or nobody has asked.

**Phase 8 (platform, ops)**

- Export jobs (`runExportJob`), the rate recalculation (`runRateRecalcJob`, 76 s for 1M entries), the CSV import's commit and the user import's invitations run in the web function today (`after()` or the request, within the 300 s budget). Move them onto pg-boss once a worker host exists; `apps/worker` cannot import the web app's `server-only` storage and mail modules, so they need a shared package first.
- The rate recalculation re-rates every entry from its date, even when the changed rate can only affect some; narrow the job to the changed level's target.
- Credit notes (a void is the only undo of a sent invoice), per-line taxes, online invoice payment.
- Scale: budget alert recipients are read without pagination; target rules evaluate every active member with one query per window. Batch the reads and the outbox inserts at thousands of projects or hundreds of members.

**Phase 9 (apps)**

- Touch and keyboard drags on the schedule grid, and drags on the project schedule's bars.

**Not planned**

- QuickBooks or Xero sync (`server/invoices/sync.ts` stays an empty registry); a locale for the public invoice page (the PRD excludes localisation).
- Estimates that add up from tasks, "billable time only" time estimates, cost-based budgets; re-firing a threshold after a raised estimate.
- A "round the total" rounding setting (rounding stays per entry).
- Repeat-series exceptions (one occurrence moved or deleted) and splitting a series.
- What-if forecasts over drafts; a chart, share link or export job for the Assignments report (its export streams, and a very large range answers 413).
- An email or digest when a group gains tasks.
- Inline editing of tags and dates in the Detailed report.
- Share links and drill-downs on the Attendance tab.
- A windowed column axis for a quarter zoom on the schedule.
- An invoice import that splits an entry across ranges or invoices.

## Done

- [x] Dropped `task_assignee` and `workspace_settings.task_creators`, done 2026-11-17 (backlog cleanup b2, migration 0021): the contract half, after branch 1's code (which no longer reads or writes them) reached production.
- [x] PDF tests in CI, done 2026-11-17 (backlog cleanup b1): the CI job installs Playwright's Chromium and lifts Ubuntu 24.04's user-namespace restriction, so `report-pdf.test.ts` and `invoices/pdf.test.ts` print PDFs in CI (run 44080024987: both passed, not skipped).
- [x] Detailed sort in the URL, done 2026-11-17 (backlog cleanup b1): `sort` and `dir` sit beside the report query (unknown values read as start, descending), survive a reload and a filter change, and stay out of share links.
- [x] Timesheet rows added by hand, done 2026-11-17 (backlog cleanup b1): kept in local storage per workspace, person shown and week; a row on a project no longer offered is dropped.
- [x] Calendar's first day, done 2026-11-17 (backlog cleanup b1): the calendar reads entries from a day before the week, so one begun the evening before is drawn on the first day.
- [x] Calendar keyboard, done 2026-11-17 (backlog cleanup b1): Enter and Space on a focused block open the editor.
- [x] Optimistic calendar and timesheet writes, done 2026-11-17 (backlog cleanup b1): moves, resizes, cell edits and deletes patch the person's loaded ranges before the write and go back if it is refused, cancelled at the note prompt, or fails to send; a created entry goes into the range when it lands.
- [x] The three-workers note, done 2026-11-17 (backlog cleanup b1): it lives in CLAUDE.md's e2e bullets (a spec that writes to the demo tenant must be checked against the read-mostly demo specs).
- [x] `ci.yml`'s skipped pull_request job, done 2026-11-17 (backlog cleanup b1): the note lives in CLAUDE.md's Deployment section (require the push run's check if branch protection is added).
- [x] Tasks by group follow-ups, done 2026-11-17 (backlog cleanup b1): the report filters keep a project whose tasks are all hidden from the member (rule 8 is about tracking, not reading); a project that turns private gives its tasks' groups access in the same transaction (`grantTaskGroupsAccess`, rule 9); the CSV import lets a manager who may create projects add tasks to the projects that same import creates, for that request only (`withManagedProject`). Ruling (final review): creating a project does not make a manager its manager, because that would widen their own reach (other people's amounts and member rates, schedules, approvals) beyond what an owner granted.
- [x] Client filters, done 2026-11-17 (backlog cleanup b1): `listFilterClients` gives the projects toolbar and every report's filters the live clients of projects the viewer can see (owners and admins every live client); the create and edit dialogs keep the full list.
- [x] Flaky reassign test, done 2026-11-17 (backlog cleanup b1): the test stamps the entry an hour back before the reassign, so a database clock that steps back a little between transactions cannot fail it; it still fails if the reassign leaves `updated_at` alone.
- [x] One render per revalidating action, done 2026-11-17 (backlog cleanup b1): the client no longer calls `router.refresh()` after the 30 actions that already revalidate (the action's response re-renders the page). Kept where the action does not revalidate: the project and tag dialogs (their actions also serve the pickers' inline create, which must not re-render the tracker), targets, periods, share-link revoke, the project access tab's failure path and the once-a-session timezone detector. `rowAction` keeps its retry: tracker rows and expense categories need it too.
- [x] Timesheet arrows, done 2026-11-17 (backlog cleanup b1): Left and Right leave a cell only at the text's edge or with the whole value selected (`movesHorizontally`), so the caret moves within "1:30".
- [x] Copy last week, done 2026-11-17 (backlog cleanup b1): an entry already in the target week with the same times and details is not copied again, an entry whose details can no longer take time is skipped with its reason (the toast names the first), and a break stays a break (it was copied as work). A period refusal still fails the whole copy.
- [x] Sign-up error codes, done 2026-11-17 (backlog cleanup b1): `signUpErrorField` puts Better Auth's `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` (and `INVALID_EMAIL`) on the email field. A duplicate still gets the generic success while email verification is on.
- [x] Closed by ruling in the backlog cleanup, 2026-11-17 (`docs/superpowers/specs/2026-11-17-backlog-cleanup-design.md`):
  - "Should cost follow the report rounding rule?" Yes (ruling 1): profit is amount less cost over the same hours.
  - "With approvals on, approved time can never be costed after the fact." Kept (ruling 2): approval freezes the period, money included.
  - "New entries only" from today's midnight by the entry's date. Kept (ruling 3).
  - A second rate change on the same date replaces that date's row. Kept (ruling 4).
  - A time-off request is not recounted after a holiday or capacity change. Kept (ruling 6): the amount is what the approver saw.
  - `stopTimer` with an explicit end ungated under force timer. Accepted (ruling 7).
  - The unused `export_report` value `project-status`. Kept (ruling 10): removing a Postgres enum value means recreating the type.
  - The recalculation's batch `UPDATE` leaves `updated_at` alone. Kept (ruling 11): nothing reads amounts from the entry DTO.
  - A voided invoice keeps its number and its PDF; invoice PDFs are never purged. By design (ruling 12): an invoice is a business record.
  - "Watch the one-year Summary's time" (650 ms after 6a) and "the one-year Summary takes about 760 ms" (the rollup as last resort). Closed into the gate (ruling 14): `report:perf` fails over 1 s.
  - Phase 6c: `useState(expense?.date ?? localDateKey(new Date(), …))` was an impure initializer; fixed in the 6c review pass, and CLAUDE.md records that the expense dialogs use local state.
  - Phase 6c: `expenseLockedReasons` runs one query per owner in a list page. Accepted: at most 50 rows a page.
  - Phase 7b: a rate change entered later does not re-forecast history. By design: nothing is stored, so the forecast simply moves.
- [x] Phase 6c's deferred `invoiced` filter on the Expenses page (design decision 18), done 2026-11-10 in Phase 6d (a426be9): the Expenses page and the reports filter Invoiced / Not invoiced, and an invoiced expense is read-only.
- [x] Vercel automation bypass secret rotated, done 2026-11-04: the first kiosk acceptance test asserted on whole cookie objects, so its failure on preview run 41773136961 wrote `_vercel_jwt` unmasked into the public `playwright-report-preview` artifact. The owner deleted the artifact, regenerated the secret and updated `VERCEL_AUTOMATION_BYPASS_SECRET` in the Actions secrets; the test reads cookie names only since a25512f, and CLAUDE.md forbids asserting on whole cookies or headers.
- [x] Report leak guard, done 2026-11-05 ("e2e: keep secrets out of the public report"): lint refuses cookie and header dumps in `e2e/` (`cookieNames()` is the one reader), and `e2e:report-guard` deletes a report that carries a job secret or a JWT, inside zips too, before the preview and nightly workflows upload it.
- [x] Phase 5a operations: `CRON_SECRET` set in Vercel production and the 0013 migration applied to the shared database; done 2026-11-02 (4853308, "deploy: rebuild production to pick up CRON_SECRET").
- [x] Phase 5a review minor "the reminder email names a mute setting that has no UI yet": Profile → Timer settings has "Mute target reminders" (Phase 5b, 2026-11-03).

- [x] Phase 4 follow-ups, done 2026-10-31 ("phase 4 follow-ups: review fixes from the backlog"), each with a test that failed first:
  - Two transfers of ownership started together could leave two owners; the owner row now changes hands only while it is still the actor's, and the new owner only while an active admin.
  - Deactivation and removal raced a timer start; both now change the membership under the person's timer lock and stop the timer after it, and `startTimer` checks the membership under that lock.
  - The recalculation cursor followed its entry's live start (an entry moved later skipped the ones between); it now keeps the start as stored, with microseconds. Its claim read the job before the workspace lock (a merged earlier date left the total short); it reads it again after.
  - Re-rating the entries of a deleted project bound one parameter per entry and failed past 65,535; the ids now go as one array.
  - Routes answer a catalog service's refusal as 404 (unknown id), 409 (conflict) or 400 instead of 500, so the rates route's unknown target is a 404.
  - The import refuses an oversized upload (413) before reading it and malformed options with a 400; names an archived project or a template ("project X is archived") instead of planning a create the commit could not make; tells a member the same for an unknown address as for a refused one; and refuses an end equal to its start instead of importing 24 hours.
  - The Audit filter keeps one criterion chosen; "Pin as favourite" is not offered on someone else's entries; "Cancel a pending invitation" has its e2e test.
  - Tasks by group minors: a rename that keeps a task's groups leaves their rows alone; a task with no group can be renamed without picking one; "Tasks available" for a deactivated member lists nothing instead of an error; the import offers "Groups for new tasks" only to people who can create tasks; the settings form keys its confirmations on dedicated fields; groups are read only where they decide the answer (By-group mode, managers and members); plus a vacuous test removed, a mistitled case renamed, the task filter's probe explained and a non-null assertion gone.
- [x] The preview run passed its 10-minute budget (10.4 min on 2026-10-29 with 164 tests, 29.5 min of test time over 3 workers). The two slowest mature specs, `reports.spec.ts` (3.5 min) and `team.spec.ts` (2.2 min), are tagged `@nightly`: the preview lane skips them and `e2e-nightly.yml` runs them every night against a local production server. Done 2026-10-29 ("e2e: a nightly lane for the slowest specs; others.spec finds Max by session").
- [x] `others.spec.ts` "a manager's person picker lists only their people" looked Max Member up by name in the report options while `profile.spec.ts` was renaming him (the cross-spec race noted above); it now takes his id from his own session. Done 2026-10-29 (same commit).
- [x] `docs/E2E_COVERAGE.md` listed "Change a member's role — gap" although the ticked team line "a member's role, deactivation and removal" covers it; the duplicate line is gone. Done 2026-10-28 ("docs: drop the duplicate role-change coverage gap").
- [x] **Export bucket:** the owner created the private `timekeep-exports` bucket in Supabase Storage; `S3_EXPORT_BUCKET=timekeep-exports` is set for production and preview, `EXPORT_JOB_THRESHOLD=5` for previews only. The preview e2e passed 123/123 with the export-job test. Done 2026-10-26 ("docs: the export bucket is set up").
- [x] Phase 3 review minors (2026-10-25), all done 2026-10-25:
  - Report, export and tracker JSON routes answered unexpected errors with a bare 500 and logged nothing; they now log first (`routeErrorResponse`). A malformed Detailed cursor reached Postgres and gave 500; it is now a 400. ("routes: log unexpected failures; a malformed Detailed cursor is a 400")
  - `expireExportJobs` timed out running jobs by `createdAt`, so a late retry could be failed mid-build; `export_job.started_at` (0009) now dates the build. PDF jobs recorded 0 rows; they record the table's rows. Deleted users and workspaces left export files in the bucket; housekeeping sweeps any export file older than 7 days (a sweep, not a lifecycle rule: Supabase Storage has none). ("exports: time out by build start, record PDF rows, sweep orphaned files")
  - The Users filter listed active members only; it now adds anyone else with time in the workspace as "(former member)". ("reports: the Users filter offers former members")
  - Test gaps: week and month group keys, New York's fall-back date, "this year" on 1 January and the shared export's 413 ("tests: week and month keys, New York fall-back, 1 January, shared 413"); the 4 MB streaming cap is in `report-routes.test.ts`.
  - Filter changes used `replaceState`, so Back left the reports; discrete changes now push a history entry (typing still replaces). In the 375px sheet, a quick Escape after a picker closed nothing, because Radix keeps a closing popover as the top layer until its exit animation ends; popovers no longer animate out. The member Users-filter test now uses another member's real id. ("reports: Back undoes a filter change; Escape closes the filter sheet")
  - Migration 0007's index was built without `CONCURRENTLY`; nothing to redo at today's size, and CLAUDE.md now gives the procedure for an index on a large table.
- [x] Locally the `freshUser` fixture once timed out waiting for its verification email. Cause: the auth test "the check-email page resends the verification email" cleared all of Mailpit while other workers waited for their own email; it now deletes only its address's mail (`deleteMessagesTo`, unit-tested against Mailpit). Done 2026-10-25 ("e2e: clear one inbox, not Mailpit; longer keep-alive for the production server").
- [x] Against the local production server, a `page.request` call once failed with `ECONNRESET`: Node closes an idle keep-alive socket after 5 s. The Playwright web server now runs `next start --keepAliveTimeout 70000`. A race, so no test can show it; watch for a recurrence. Done 2026-10-25 ("e2e: clear one inbox, not Mailpit; longer keep-alive for the production server").
- [x] `/tracker-options` called `listTags`, which computed usage counts the picker discards, on every entry write; the pickers now read `listTagOptions`. Done 2026-10-22 ("tags: picker options without usage counts; the Tags page refuses a duplicate").
- [x] `dateRangeSchema` had no maximum span; a range is now at most a year (366 days). Done 2026-10-22 ("core: a date range is at most a year").
- [x] The Tags page's "New tag" never reported a duplicate (find-or-create dropped the colour and could return an archived tag); the page now refuses it, naming the archived case, while the picker's inline create still reuses. Done 2026-10-22 ("tags: picker options without usage counts; the Tags page refuses a duplicate").
- [x] Small cleanups: `createTask` and `updateTask` are one transaction each; `copyWeek` counts days in the zone (`daysBetweenInZone`); bulk project changes already stamped `updatedAt` through Drizzle's `$onUpdate` (the item's premise was wrong), and the tests now guard that. Done 2026-10-22 ("entries: bulk project changes stamp updatedAt; createTask is atomic; copyWeek counts days in the zone").
- [x] `profile.ts` and `team.ts` returned any `Error`'s message to the user; `userErrorMessage` now passes Better Auth's `APIError` through and both modules use it. Done 2026-10-22 ("actions: Better Auth errors pass through the shared mapping; profile and team use it").
- [x] CI ran only on pull requests and pushes to `main`, so a branch pushed without a PR reached Vercel with a stale lockfile unchecked; it now runs on every push of this repository's branches (the PR trigger stays for forks). Done 2026-10-22 ("ci: run on every push of this repository's branches").
- [x] A member whose picker still listed a project that was just archived or made private got the server's message on Start, but the picker only refreshed after the next options fetch, and the draft kept the dead project. Done 2026-10-21 ("tracker: a rejected Start refreshes the options and prunes the draft").
- [x] Add `pnpm --filter @timekeep/web e2e:coverage` to the commands table in `CLAUDE.md`. Done 2026-10-20 ("docs: e2e:coverage in the commands table").
- [x] Remote runs use `retries: 2`, which hides flaky tests unless someone reads the report. Fail the job on flaky tests, or report them in the job summary. Done 2026-10-20 ("e2e: a flaky test fails the run in CI"): failOnFlakyTests is on in CI and remote runs; a probe that passes only on retry exited 0 before and 1 after.
- [x] `fixtures.spec.ts` "two tests get different fresh users" depends on test order. Done 2026-10-20 ("e2e: fresh users near noon, with clear errors and an API slug"): replaced by "every freshUser is a new account with its own workspace", which signs up a second user itself; it fails when signUpFreshUser reuses an account.
- [x] Tests add manual entries at early times (00:05, 00:10) in Asia/Manila. A run that straddles Manila midnight can put them on different days. Done 2026-10-20 ("e2e: fresh users near noon, with clear errors and an API slug"): fresh users get a no-DST zone where it is about noon (e2e/helpers/time-zones.ts, unit-tested for every UTC hour and in July).
- [x] `freshUser` reads the workspace slug from the `Location` header of the `/` redirect. It breaks if that redirect changes; read it from an API instead. Done 2026-10-20 ("e2e: fresh users near noon, with clear errors and an API slug"): the slug comes from /api/auth/organization/list (exactly one workspace expected).
- [x] `freshUser` (`e2e/fixtures.ts`): when waiting for the verification email fails, the error drops the underlying cause. Done 2026-10-20 ("e2e: fresh users near noon, with clear errors and an API slug"): the error now carries the mail helper's reason and cause; seen missing before.
- [x] A `test.skip()` call inside a test body is invisible to `playwright test --list`, so `e2e:coverage` still counts that test as covered. Done 2026-10-20 ("e2e: skipping a test is a lint error"): no-restricted-syntax flags test.skip/test.fixme in e2e/; a probe spec with both linted clean before and fails after.
- [x] `parseCoverage` has no test for trailing spaces after the closing quote. Done 2026-10-20 ("coverage-check: spec paths, symlinked runs, trailing spaces"): test added; it fails when trailing whitespace handling is removed.
- [x] Tests are keyed by spec file name only; two specs with the same name in different folders would collide. Done 2026-10-20 ("coverage-check: spec paths, symlinked runs, trailing spaces"): specs are keyed by their path under e2e/; the two-folder test failed before.
- [x] The "run as a script" check compares `process.argv[1]` without resolving symlinks, so running it through a symlinked path silently does nothing. Done 2026-10-20 ("coverage-check: spec paths, symlinked runs, trailing spaces"): isMainModule compares real paths; the junction test failed before.
- [x] The workspace slug lock (`pg_advisory_xact_lock` in `createWorkspace`) covers the base slug only, not neighbouring suffixed slugs, so two sign-ups with different base names can still race for the same suffixed slug. Rare; the unique index turns it into an error, not bad data. Done 2026-10-20 ("workspaces: one lock for all slug allocation"): a single advisory lock now serialises slug allocation; workspaces.test.ts "gives distinct slugs when a name's suffixed slug is another name's base" failed before (duplicate neighbour-0-x-2).
- [x] Google sign-in on production. Done 2026-10-20: Vercel Production has `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (the local OAuth client, marked sensitive); the owner added the production redirect URI and origin in Google Cloud Console; production (`17ff9c6`) renders "Continue with Google" and starts OAuth at accounts.google.com with redirect_uri `https://time-keep-nine.vercel.app/api/auth/callback/google`. The owner confirmed a real Google sign-in works on 2026-10-20.
- [x] PROGRESS marked the e2e foundation done before the Vercel preview run was green. Resolved 2026-10-18: preview run 39128237619 passed 30/30 in 3.9 min on `2862a53`.
