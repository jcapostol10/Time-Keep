# Backlog

Known gaps and deferred fixes that are not part of a phase checklist. When an item is fixed, move it to **Done** with the date and the commit. Add new deferred findings here as they come up (code-review minors, things a test run exposed, setup left for later).

## Needs the owner

- [ ] **Production email:** verify a sending domain in Resend. Until then, production can only email the Resend account owner, so sign-up verification, password reset and invites fail for everyone else.
- [ ] **Production is behind Vercel Authentication.** Deployment protection covers every deployment, production included, so anyone not signed in to the Vercel team gets a Vercel login page instead of TimeKeep. Fine while it is private; before real customers use it, switch protection to "Standard" (previews only) or add a custom domain outside protection. The e2e workflow only targets previews, so it is unaffected.

## App

- [ ] The workspace slug lock (`pg_advisory_xact_lock` in `createWorkspace`) covers the base slug only, not neighbouring suffixed slugs, so two sign-ups with different base names can still race for the same suffixed slug. Rare; the unique index turns it into an error, not bad data.

## E2E suite

- [ ] Backfill the rest of `docs/E2E_COVERAGE.md`, in this order: entry list (week paging, inline time/date edits, bulk delete), timer settings with `page.clock` (idle, Pomodoro, reminders), Phase 0 gaps, 375px layouts.
- [ ] Re-prove the 26 coverage ticks carried over from Phases 0–1: break each guarded behaviour once and watch its test fail.
- [ ] `freshUser` (`e2e/fixtures.ts`): when waiting for the verification email fails, the error drops the underlying cause.
- [ ] `freshUser` reads the workspace slug from the `Location` header of the `/` redirect. It breaks if that redirect changes; read it from an API instead.
- [ ] Tests add manual entries at early times (00:05, 00:10) in Asia/Manila. A run that straddles Manila midnight can put them on different days.
- [ ] `fixtures.spec.ts` "two tests get different fresh users" depends on test order.
- [ ] Remote runs use `retries: 2`, which hides flaky tests unless someone reads the report. Fail the job on flaky tests, or report them in the job summary.
- [ ] A `test.skip()` call inside a test body is invisible to `playwright test --list`, so `e2e:coverage` still counts that test as covered.

## Coverage check (`apps/web/scripts/coverage-check.ts`)

- [ ] The "run as a script" check compares `process.argv[1]` without resolving symlinks, so running it through a symlinked path silently does nothing.
- [ ] Tests are keyed by spec file name only; two specs with the same name in different folders would collide.
- [ ] `parseCoverage` has no test for trailing spaces after the closing quote.

## Docs

- [ ] Add `pnpm --filter @timekeep/web e2e:coverage` to the commands table in `CLAUDE.md`.

## Done

- [x] Google sign-in on production. Done 2026-10-20: Vercel Production has `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (the local OAuth client, marked sensitive); the owner added the production redirect URI and origin in Google Cloud Console; production (`17ff9c6`) renders "Continue with Google" and starts OAuth at accounts.google.com with redirect_uri `https://time-keep-nine.vercel.app/api/auth/callback/google`.
- [x] PROGRESS marked the e2e foundation done before the Vercel preview run was green. Resolved 2026-10-18: preview run 39128237619 passed 30/30 in 3.9 min on `2862a53`.
