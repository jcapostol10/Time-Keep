# Backlog

Known gaps and deferred fixes that are not part of a phase checklist. When an item is fixed, move it to **Done** with the date and the commit. Add new deferred findings here as they come up (code-review minors, things a test run exposed, setup left for later).

## Needs the owner

- [ ] **Production email:** verify a sending domain in Resend. Until then, production can only email the Resend account owner, so sign-up verification, password reset and invites fail for everyone else.
- [ ] **Production is behind Vercel Authentication.** Deployment protection covers every deployment, production included, so anyone not signed in to the Vercel team gets a Vercel login page instead of TimeKeep. Fine while it is private; before real customers use it, switch protection to "Standard" (previews only) or add a custom domain outside protection. The e2e workflow only targets previews, so it is unaffected.

## App

- [ ] After a server action that calls `revalidatePath`, the client components also call `router.refresh()`, so each change renders twice; the second render can close a menu that was just opened (the e2e `rowAction` helper retries for this). Drop the redundant refresh where the action already revalidates.
- [ ] Timesheet rows added by hand live only for the page visit (templates persist); consider keeping them per week in local storage.
- [ ] Calendar moves and resizes are not optimistic: the block jumps back until the refetch lands (fast locally, visible on a slow connection). Timesheet cells likewise show the old value until the refetch lands. Patch the range query before the write.
- [ ] The Tags page's "New tag" never reports a duplicate: it is find-or-create, so an existing name toasts "created", drops the chosen colour, and may return an archived tag the list hides. The page should refuse a duplicate like clients and projects do (the picker's inline create keeps find-or-create).
- [ ] `/tracker-options` calls `listTags`, which computes usage counts the picker discards, on every entry write. Add a flag to skip the counts there.
- [ ] `dateRangeSchema` has no maximum span, so the range route will return a user's entries for any period. Cap it (a year).
- [ ] Calendar blocks have `role=button` and `tabIndex=0` but no Enter/Space handler, so they cannot be opened from the keyboard.
- [ ] The calendar loads entries whose start falls in the week, so an entry begun late on the previous week's last day is not drawn on the first day. Fetch from one day earlier; `blockOnDay` already clips.
- [ ] Members see every client name in the projects-page filter, including archived clients and clients whose projects are all private to them.
- [ ] ArrowLeft and ArrowRight move between timesheet cells even mid-text, so the caret cannot move within "1:30". Move between cells only when the caret is at the edge.
- [ ] Copy last week has no duplicate guard (copying twice doubles every entry) and one archived project or done task aborts the whole copy without saying which entry.
- [ ] Small cleanups: `reassignProjectEntries` and `softDeleteProjectEntries` do not set `updatedAt`; `createTask` inserts the task and its assignees outside a transaction; `copyWeek` divides by `86_400_000` (rounded, so safe, but against the convention's spirit).
- [ ] `profile.ts` and `team.ts` still return any `Error`'s message to the user (Better Auth messages are user-facing there, so they were left out of `userErrorMessage`); audit them and unify.

## E2E suite

- [ ] CI (`ci.yml`) runs only on pull requests and pushes to `main`, so a branch pushed without a PR gets no `pnpm install --frozen-lockfile` before Vercel builds it; the first Phase 2 preview failed on a lockfile that still listed a dependency reverted from `packages/ui/package.json` (`ERR_PNPM_OUTDATED_LOCKFILE`). Open the PR before relying on the preview, or run CI on every push.
- [ ] Against the dev server, three workers occasionally close an open picker mid-test (Next recompiles routes on demand and pushes updates); the production-server run (see the CLAUDE.md commands) is stable. Consider making `pnpm e2e` build and start a production server locally.
- [ ] The suite runs spec files with 3 workers to stay under 10 minutes on a preview; the demo-account specs are read-mostly (profile.spec renames member2 and restores it). If a new spec writes to the demo tenant, check it against the others or give it its own project in the Playwright config.
- [ ] Backfill the rest of `docs/E2E_COVERAGE.md`, in this order: entry list (week paging, inline time/date edits, bulk delete), timer settings with `page.clock` (idle, Pomodoro, reminders), Phase 0 gaps, 375px layouts.
- [ ] Re-prove the 26 coverage ticks carried over from Phases 0–1: break each guarded behaviour once and watch its test fail.

## Coverage check (`apps/web/scripts/coverage-check.ts`)

Nothing open.

## Docs

Nothing open.

## Done

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
