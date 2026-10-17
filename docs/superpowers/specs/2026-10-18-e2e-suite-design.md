# Test-driven end-to-end suite — design

Date: 2026-10-18. Status: draft for review.

## Goal

Build up, a few tests at a time, an automated end-to-end suite that proves every user-facing function of TimeKeep keeps working, and make new features test-first from Phase 2 onward.

Success means:

- `docs/E2E_COVERAGE.md` lists every user-facing function, each either ticked with the test that covers it or marked as a gap.
- Every ticked test has been seen to fail once when the behaviour it guards was broken.
- The suite is green locally against Docker and on every Vercel preview deployment, with no retries.
- From Phase 2 on, a feature's coverage lines and failing end-to-end tests exist before its app code.

## Decisions already made

| Topic | Decision |
| --- | --- |
| Starting point | Backfill Phases 0–1 first, then test-first for every new phase. |
| Structure | Plain Playwright specs per feature area, shared fixtures, and a coverage list checked in CI (no Gherkin). |
| Granularity | One coverage line per user action or observable behaviour. |
| Where it runs | Locally against Docker (`pnpm e2e`) and on every Vercel preview (`e2e-preview.yml`), as built on 2026-10-15. |

## 1. Coverage list

- **File:** `docs/E2E_COVERAGE.md`, grouped by feature area as users see the app:
  - Auth
  - Workspaces and team
  - Profile and settings
  - Time Tracker: timer bar, manual mode, entry list, row actions, timer helpers
  - Tenant isolation
- **Line format:** one line per function. A ticked line names its spec file and test title; an unticked line says `gap`.
  ```
  - [x] Start, reload and stop a timer — `tracker.spec.ts` › "start, reload and stop a timer"
  - [ ] Create a project inline from the picker — gap
  ```
- **Sources:** the PRD, the phase prompts in the prompt pack, and what the UI exposes today.
- **Check script:** `apps/web/e2e/check-coverage.ts`.
  - It runs `playwright test --list`.
  - It fails if a ticked line names a spec or test title that does not exist.
  - It prints counts of ticked lines and gaps.
  - It runs in CI right after lint.
- **What the check cannot prove:** that a ticked test really exercises its function. The "fail once" step in section 3 covers that.

## 2. Fixtures

A new `apps/web/e2e/fixtures.ts` extends Playwright's `test`, and specs import `test` from it.

- **`freshUser`:** a new account with its own personal workspace, signed in.
  - It signs up over HTTP through Better Auth's email sign-up endpoint, using a `uniqueEmail()` address on `@e2e.test`.
  - It reads the verification email with `e2e/helpers/mail.ts` (Mailpit locally, captured email on previews).
  - It opens the verification link with the browser context's request client, which signs the user in, so the page starts authenticated.
  - It resolves the user's workspace slug from the post-verification redirect.
  - It provides `{ email, password, slug }` to the test.
  - Each test gets its own user, so tests are independent and can run in any order.
- **`demoUser(role)`:** signs in a seeded demo account (`owner`, `admin`, `manager`, `member1`, `member2`) over HTTP. Used only where the shared `demo` workspace is the point: role checks and tenant isolation.
- **`trackerPage`:** opens `/w/<slug>/tracker` for the fixture's user and waits for `section[aria-label="Timer"][data-hydrated="true"]`.
- **Remote mode:** the fixtures use the same base URL and Vercel bypass headers as `playwright.config.ts`.
- **Cleanup:**
  - On previews, the existing `db:e2e-cleanup` step removes fixture users.
  - Locally, a Playwright `globalTeardown` runs the same cleanup against the local database, guarded so it only ever targets a local host.
- **The form-based sign-up** stays covered by exactly one test, the existing "sign up, verify email, land in a personal workspace" test in `auth.spec.ts`.

## 3. The loop for each step

1. **Pick gaps.** Choose 3 to 6 related unticked lines.
2. **Write the tests,** using the fixtures.
3. **Prove each test can fail.**
   - Temporarily break the behaviour the test guards.
   - Run the test and confirm it fails for the expected reason.
   - Restore the code.
   - A test that cannot be made to fail is rewritten, not ticked.
4. **Run it twice.** The full suite must be green locally against Docker, then on a preview deployment through the workflow, both with no retries.
5. **Tick and commit.** Tick the lines and commit. The commit message records, for each new test, which change made it fail.

## 4. Order and rules

**Backfill order, riskiest first:**

1. **Tracker refactor:** move `tracker.spec.ts` off its ordered chain (`describe.serial` with one shared user) onto independent tests using `freshUser` and `trackerPage`. Coverage stays the same; this step also introduces the fixtures and the coverage list.
2. **Timer bar:** project picker (search, inline create, clear), tag picker (multi-select, inline create), billable toggle, description autocomplete filling project, tags and billable, the N and Esc shortcuts, and the S shortcut from another page.
3. **Entry list:**
   - manual mode where the end is before the start (rolls to the next day);
   - duplicate;
   - bulk delete with Undo;
   - loading older weeks;
   - inline edits of description, project, tags, billable, start, end and date;
   - an entry crossing midnight listed under its start day.
4. **Timer settings:**
   - the account Timer section: save and reload;
   - the idle prompt, using Playwright's clock control (`page.clock`) instead of real waiting;
   - Pomodoro and reminder notices, also with the controlled clock.
5. **Phase 0 gaps:** cancelling a pending invitation, changing a member's role, avatar upload rejected for a non-image file or one over the size limit, and workspace switching.
6. **Small screens:** the tracker, account and settings pages at 375px wide, checking that no content overflows horizontally.

**Rules, recorded in `CLAUDE.md`:**

- **Test-first from Phase 2.** Each new feature adds its unticked coverage lines and failing end-to-end tests before any app code. The existing "No feature merges without tests" invariant is extended accordingly.
- **Coverage check in CI.** `check-coverage.ts` runs in `ci.yml`, so a stale or misnamed test reference fails the build.
- **Speed budget.** The suite must finish within 10 minutes on a Vercel preview. If it would exceed that, the slowest tests move to a nightly workflow instead of being deleted.

## Out of scope

- Visual regression testing (screenshot comparison).
- Load or performance testing.
- Testing Google sign-in end to end (it needs real Google accounts).
- Production email delivery (blocked on a verified Resend domain).

## Risks

- **Fixture sign-up depends on email.** If mail capture or Mailpit breaks, every test fails at setup.
  - Mitigation: the fixture's error names the missing email.
  - The auth spec still tests the email path directly.
- **Clock-controlled tests** can disagree with server time.
  - Mitigation: only client-side timers (idle, Pomodoro, reminders) are clock-controlled.
  - Server-written times are asserted as relative values.
- **More tests on previews share one demo tenant.**
  - Mitigation: only role and isolation tests use `demoUser`.
  - Everything else uses its own fresh user.
  - The workflow still runs one preview at a time.
