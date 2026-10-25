# Backlog

Known gaps and deferred fixes that are not part of a phase checklist. When an item is fixed, move it to **Done** with the date and the commit. Add new deferred findings here as they come up (code-review minors, things a test run exposed, setup left for later).

## Needs the owner

- [ ] **Production email:** verify a sending domain in Resend and set `MAIL_FROM` to an address on it (Vercel → Production env, then redeploy). Until then, production can only email the Resend account owner, so sign-up verification, password reset and invites fail for everyone else. On our side (2026-10-22): production refuses to boot with a placeholder sender, a failed send tells the person what happened instead of a bare 500, and Profile settings has "Send me a test email" to check the sender.
- [ ] **Production is behind Vercel Authentication.** Deployment protection covers every deployment, production included, so anyone not signed in to the Vercel team gets a Vercel login page instead of TimeKeep. Fine while it is private; before real customers use it, switch protection to "Standard" (previews only) or add a custom domain outside protection. The e2e workflow only targets previews, so it is unaffected.
- [ ] **Export bucket:** create the private `timekeep-exports` bucket in Supabase Storage and set `S3_EXPORT_BUCKET=timekeep-exports` in Vercel's production and preview env, plus `EXPORT_JOB_THRESHOLD=5` on previews only. Until then large exports fail on that deployment, and the preview's export-job e2e test fails.

## App

- [ ] Export jobs run inside the web function after the response (`after()`, within the 300 s budget). Once a worker host exists, enqueue `runExportJob(db, jobId)` on pg-boss instead (decision 1 of the Phase 3 design); the function is already one call, but `apps/worker` cannot import the web app's `server-only` storage and mail modules, so they need a shared package first.
- [ ] `sign-up-form.tsx` maps `USER_ALREADY_EXISTS` to the email field, but Better Auth 1.7.7 emits `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`; moot while `requireEmailVerification` answers a duplicate sign-up with a generic success (predates Phase 2). A refused password-reset send also looks like success, by Better Auth's design, which keeps account existence private.
- [ ] After a server action that calls `revalidatePath`, the client components also call `router.refresh()`, so each change renders twice; the second render can close a menu that was just opened (the e2e `rowAction` helper retries for this). Drop the redundant refresh where the action already revalidates.
- [ ] Timesheet rows added by hand live only for the page visit (templates persist); consider keeping them per week in local storage.
- [ ] Calendar moves and resizes are not optimistic: the block jumps back until the refetch lands (fast locally, visible on a slow connection). Timesheet cells likewise show the old value until the refetch lands. Patch the range query before the write.
- [ ] Calendar blocks have `role=button` and `tabIndex=0` but no Enter/Space handler, so they cannot be opened from the keyboard.
- [ ] The calendar loads entries whose start falls in the week, so an entry begun late on the previous week's last day is not drawn on the first day. Fetch from one day earlier; `blockOnDay` already clips.
- [ ] Members see every client name in the projects-page filter, including archived clients and clients whose projects are all private to them.
- [ ] ArrowLeft and ArrowRight move between timesheet cells even mid-text, so the caret cannot move within "1:30". Move between cells only when the caret is at the edge.
- [ ] Copy last week has no duplicate guard (copying twice doubles every entry) and one archived project or done task aborts the whole copy without saying which entry.
- [ ] The one-year Summary over the perf seed takes about 760 ms locally, with the series aggregate on one Postgres worker (the planner estimates one group per row for any expression on `start`). If production reports approach a second, add the day-level rollup table the Phase 3 design keeps as the last resort, maintained by the entry service.
- [ ] The PDF integration test skips when no local Chrome is found, so CI never prints a PDF; only the preview e2e run exercises `@sparticuz/chromium`. Consider installing Playwright's Chromium in the CI job.
- [ ] The Detailed report keeps tags and the date read-only (edit them in the tracker), and its sort is per visit, not in the URL.
- [ ] The `export_report` enum value `project-status` is unused: the Status tab exports the Summary grouped by task then person.
- [ ] Phase 3 review minors (2026-10-25):
  - `report-route.ts` and the export route answer non-access errors with a bare 500 and no `console.error`, so a Postgres error in production is invisible. Log before responding.
  - The Detailed route accepts any `cursorValue`; a malformed one reaches Postgres and returns 500. Validate it (ISO instant or integer) and answer 400.
  - `expireExportJobs` marks a running job timed out by `createdAt`, so a job retried more than 15 minutes after creation can be flagged failed mid-build (it heals when the build finishes). Track `startedAt`.
  - Cascade deletes (user or workspace removal, e2e cleanup) delete `export_job` rows but leave their files in the export bucket. Add a 7-day lifecycle rule on the bucket.
  - PDF export jobs record a row count of 0, so the Exports list and the email say "0 rows".
  - Filter changes use `history.replaceState`, so Back leaves the reports instead of undoing a filter. Consider `pushState` for discrete changes.
  - The Users filter lists active members only, while a former member's time still shows in team reports.
  - The e2e "a member cannot widen the Users filter by URL" uses a made-up id; a real other member's id is the stronger guard.
  - Test gaps: SQL tests for the week and month group keys, New York's fall-back date, "this year" on 1 January, the 4 MB streaming cap and the share page's 413.
  - Migration 0007 created `time_entry_workspace_start_idx` without `CONCURRENTLY` (not possible inside a Drizzle migration transaction). Fine at today's size; large indexes later need a separate non-transactional step.
  - In the 375px filter sheet, Escape after picking from a filter closes the picker but not the sheet; the close button works.

## E2E suite

- [ ] `ci.yml` skips its pull_request job for same-repository PRs (the push already ran). GitHub counts a skipped job as a passing required check, so if branch protection is ever added, require the push run's check explicitly; none exists today.
- [ ] Against the dev server, three workers occasionally close an open picker mid-test (Next recompiles routes on demand and pushes updates); the production-server run (see the CLAUDE.md commands) is stable. Consider making `pnpm e2e` build and start a production server locally.
- [ ] The suite runs spec files with 3 workers to stay under 10 minutes on a preview; the demo-account specs are read-mostly (profile.spec renames member2 and restores it). If a new spec writes to the demo tenant, check it against the others or give it its own project in the Playwright config.
- [ ] Backfill the rest of `docs/E2E_COVERAGE.md`, in this order: entry list (week paging, inline time/date edits, bulk delete), timer settings with `page.clock` (idle, Pomodoro, reminders), Phase 0 gaps, 375px layouts.
- [ ] Re-prove the 26 coverage ticks carried over from Phases 0–1: break each guarded behaviour once and watch its test fail.
- [ ] Locally the `freshUser` fixture once timed out waiting for the verification email in Mailpit ("archive and unarchive a client", passed on retry, 2026-10-25). If it recurs, lengthen `waitForEmail`'s timeout for sign-up or check Mailpit under three workers.
- [ ] Against the local production server, a Playwright `page.request` call occasionally fails with `ECONNRESET` (seen once in "two tabs never show two running timers", passed on retry): Node closes an idle keep-alive socket just as the client reuses it. Consider raising `keepAliveTimeout` for `next start` in the Playwright web server, or retrying idempotent GETs in the helper.

## Coverage check (`apps/web/scripts/coverage-check.ts`)

Nothing open.

## Docs

Nothing open.

## Done

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
