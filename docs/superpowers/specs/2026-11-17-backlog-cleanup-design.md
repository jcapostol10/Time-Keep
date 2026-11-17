# Backlog cleanup — triage and design

## Why

`docs/BACKLOG.md` has collected about seventy entries since Phase 0, many with several sub-items: review minors, gaps test runs exposed, open product questions and feature ideas parked while a phase was built. Before Phase 8 the owner asked to clean it out (2026-11-17). The owner's ruling on scope: **fix every real defect and review minor, settle every open decision, and move feature ideas to a short "Later" list** (Phase 8, Phase 9 or "not planned"), so the backlog holds only real work.

The leftover Phase 6 data check (clients whose currency differs from their workspace's) runs privately through the Supabase plugin once the owner authorizes it. Its output names customer clients, so it never runs in a public Actions log.

## Outcomes

Every entry gets exactly one of the following outcomes:

- **Fix (branch N):** built in that branch, with a test that fails first.
- **Ruling:** a decision written here. The entry closes with the ruling quoted in Done.
- **Later — Phase 8 / Phase 9 / not planned:** moved to the backlog's new "Later" section. A Phase 8 or 9 entry is picked up by that phase's design.
- **Owner:** stays under "Needs the owner".

## Branches

Each branch follows the usual process: a plan, native execution with TDD, a fresh final review, one fix pass, then a merge.

| Branch | Area | Migration |
| --- | --- | --- |
| `chore/backlog-1` | Tracker, timesheet, calendar, catalog, auth, rates job, tasks by group, CI | 1 (contract: drop `task_assignee`, `workspace_settings.task_creators`) |
| `chore/backlog-2` | Approvals, time off, attendance, targets, kiosks, the daily cron | 1 (additive: `kiosk.tag_id`) |
| `chore/backlog-3` | Money: rates, cost, currencies, budgets, expenses, invoices | 1 (additive: `rate_recalc_job.kinds`) |
| `chore/backlog-4` | Schedule and forecast | none expected |
| `chore/backlog-5` | The e2e suite: flakes, coverage backfill, re-proving the carried-over ticks | none |

Each migration goes through `migrate.yml` with the owner's approval. The contract migration in branch 1 is safe because no code has read those columns since 2026-10-29, and every open preview is newer.

## Rulings

1. **Cost follows the report's rounding rule.** Profit is amount less cost over the same hours, so rounding one and not the other would make profit drift with the rounding setting. *Cost if wrong:* one expression in `reports.ts`.
2. **Approved time is not re-costed.** The recalculation job keeps skipping approved periods for both snapshots: approval freezes the period, money included. A cost rate added later costs new and unapproved time only. *Cost if wrong:* the job's skip becomes per-kind.
3. **"New entries only" stays "from today's midnight, by the entry's date".** An entry is rated by its date everywhere else. *Cost if wrong:* a wording change or a `created_at` rule.
4. **A second rate change on the same date replaces that date's row.** History shows one value per effective date, which is what the rate in force means. *Cost if wrong:* a history table.
5. **A workspace timezone change while periods are APPROVED stays allowed.** Changing the zone is rare, refusing it would block a workspace forever once anything is approved, and the moved edge is at most the zone difference. The settings page will say so before saving (branch 2). *Cost if wrong:* request bounds stored as instants.
6. **A time-off request keeps the amount it was made with.** A holiday or capacity change afterwards does not recount it: the amount is what the approver saw. Attendance and the timesheet already recount the days. *Cost if wrong:* a recount on such changes.
7. **`stopTimer` with an explicit end stays ungated under force timer.** The idle dialog's discard needs it, and the end must still fall after the start and not in the future. Accepted as a known soft spot.
8. **The kiosk gets one default tag** (`kiosk.tag_id`, nullable, an archived tag refused like the other defaults). Today a required tag means nobody can clock out at a kiosk. One tag satisfies "a tag is required"; more can follow if someone asks.
9. **The daily jobs run hourly and act per workspace at its local morning.** The team is on Vercel Pro, so an hourly cron is available. Each workspace's jobs run in the first hour at or after 07:00 in its timezone, once per local day, deduplicated as today (the outbox `kind`s), so a missed hour catches up at the next. This also fixes the reminder that only fires on the first day after a period, because that check becomes "the most recent closed period not yet reminded". `purgeKiosk` and the outbox drain run every hour.
10. **The unused `export_report` value `project-status` stays.** Removing a Postgres enum value means recreating the type, which is not worth it for one dead label. Documented in `DATA_MODEL.md`.
11. **The recalculation's batch `UPDATE` keeps `updated_at` as it is.** Nothing reads amounts from the entry DTO, and touching up to 1M rows' `updated_at` would make every open tracker refetch. Revisit when a DTO carries amounts.
12. **A voided invoice keeps its number and its PDF, and invoice PDFs are never purged.** An invoice is a business record: numbers are never reused, and the PDF is what was sent.
13. **A recurring invoice template catches up 31 days, not 7.** That covers any monthly template after an outage of up to a month. Anything older is not back-filled automatically, because an invoice dated long ago surprises more than it helps.
14. **Perf watch items close into the gate.** `report:perf` already fails the one-year Summary over one second, so the two "watch the Summary" entries close. The day-level rollup stays the documented last resort in `DATA_MODEL.md`.
15. **Weak or watch-only e2e entries close only with a change.** The weak "timer bar stays the viewer's own" test is rewritten so a real break fails it (or, if none exists, deleted, with its coverage line removed). Each one-off flake gets diagnostics that print its cause when it recurs (the outbox row's status and last error, the list's sort state), so "watch for a recurrence" becomes self-explaining.
16. **Local `pnpm e2e` runs against a production build.** The dev server's on-demand compiles close popovers under three workers. The gate has run that way in practice since Phase 3, and the Playwright UI mode keeps the dev server.
17. **"Review the Phase 6 decisions" and "Review the Phase 7 decisions" move to "Needs the owner".** Only the owner can review them.

## Later

**Phase 8 (platform, ops)**
- Moving export jobs, the rate recalculation, the CSV import's commit and the user import's invitations onto pg-boss. This needs a worker host and a shared package for storage and mail.
- Narrowing the rate recalculation to the changed level's entries.
- Credit notes, per-line taxes, online invoice payment.
- Alert recipients and target rules at the scale of thousands of projects or hundreds of members: batch the reads and the outbox inserts.

**Phase 9 (apps)**
- Touch and keyboard drags on the schedule grid. Keyboard and touch users keep the dialog and the new menu Split.

**Not planned** (the PRD excludes it, or nobody has asked)
- QuickBooks/Xero sync (the adapter registry stays empty), and a locale for the public invoice page (the PRD excludes localisation).
- Estimates that add up from tasks, "billable time only" time estimates, cost-based budgets, re-firing a threshold after an estimate is raised.
- A "round the total" rounding setting.
- Repeat-series exceptions (one occurrence moved or deleted), and splitting a series.
- What-if forecasts over drafts, a chart and share link on the Assignments report, an export job for it.
- An email when a group gains tasks.
- Inline editing of tags and dates in the Detailed report (the sort moves into the URL in branch 1).
- Share links and drill-downs on the Attendance tab.
- A windowed column axis for a quarter zoom.
- An import that splits an entry across invoice ranges.

## What each branch fixes

The entries quoted are the backlog's wording, shortened. Every sub-item not listed under Rulings or Later is a fix in the branch shown.

**Branch 1:**
- the sign-up duplicate code;
- the double render after `revalidatePath`;
- hand-added timesheet rows kept per week in local storage;
- optimistic calendar moves and timesheet cells;
- calendar keyboard open, and fetching from one day earlier;
- members' client filter;
- timesheet arrows only at the caret's edge;
- Copy last week's duplicate guard and naming the entry it skips (skip it rather than abort);
- the PDF integration test running in CI (Playwright's Chromium installed in the job);
- the Detailed report's sort in the URL;
- the tasks-by-group follow-ups (report filters from entries, not the picker; group access when a project turns private; tasks for a new project in one import);
- the contract migration;
- the flaky `reassignProjectEntries` timestamp test;
- `ci.yml`'s skipped-job note moved into CLAUDE.md;
- the three-workers note moved into CLAUDE.md's e2e bullets.

**Branch 2:**
- every 5a, 5b and 5c review minor;
- the empty locked cell and the locked row's menu;
- the project manager's Unsubmitted tab;
- folding the guard's settings reads;
- one `ADMIN_EDIT` event per import instead of per entry;
- auth and invitation emails through the outbox;
- the kiosk default tag;
- the hourly cron (rulings 8 and 9);
- the timezone notice (ruling 5);
- the unassigned-policy message.

**Branch 3:**
- every 6a, 6b, 6c and 6d review minor, and the 6c/6d deferred fixes that are not Later: the reminder counting expenses, purging receipts of deleted expenses, a streaming receipts zip, EXIF orientation, the add-for-others project picker, the client dialog's warning about invoices, date fields after midnight, the attachment failure telling an admin;
- the cost-only recalculation (`rate_recalc_job.kinds`);
- the full ISO 4217 currency list (searchable);
- one static currency list in core;
- the relabel measured on the perf seed;
- the 31-day recurring catch-up.

**Branch 4:**
- every 7a and 7b review minor;
- a menu Split on bars (keyboard and touch);
- the Calendar band following the person shown;
- a removed member's assignments (future ones deleted with the member's other scope, past ones kept as "(former member)");
- Team tab group and project filters;
- prefetching the adjacent range;
- the forecast and report fixes;
- the publish-email flake's diagnostics.

**Branch 5:**
- the e2e coverage backfill (entry list, timer settings with `page.clock`, Phase 0 gaps, 375px layouts);
- re-proving the 26 carried-over ticks;
- the weak timer-bar test;
- the two flakes' diagnostics;
- local `pnpm e2e` on a production build (ruling 16).

## Non-goals

- New features beyond what an entry's fix needs.
- Phase 8 work.
