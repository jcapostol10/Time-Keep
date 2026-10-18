# E2E suite foundation + timer bar backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the suite's foundation (coverage list with a CI check, signed-in fixtures, local cleanup), move the tracker spec onto independent tests, and backfill the timer bar.

**Architecture:** A pure parser in `apps/web/scripts/coverage-check.ts` compares `docs/E2E_COVERAGE.md` against `playwright test --list`. `apps/web/e2e/fixtures.ts` extends Playwright's `test` with `freshUser`, `demoUser` and `trackerPage`, signing in over HTTP. Specs import `test` from the fixtures. Every backfilled test is proved to fail once by temporarily breaking the behaviour it guards.

**Tech Stack:** Playwright 1.64, Vitest, Better Auth endpoints, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-18-e2e-suite-design.md` (backfill steps 1 and 2 of section 4; sections 1–3 in full)

## Global Constraints

- Fresh users use `uniqueEmail()` on `@e2e.test`; nothing else in the suite creates users.
- Only role and isolation tests use `demoUser`.
- Remote runs (`E2E_BASE_URL` set) must keep working: fixtures use the configured `baseURL` and the context's bypass headers; no traces remotely.
- Every new or moved test is proved to fail once (break → run → see the expected failure → restore) before its coverage line is ticked; the commit message records the break used.
- Done means: full local suite green against Docker with no retries, then green on a Vercel preview through `e2e-preview.yml` with no retries.
- Suite time on a preview stays under 10 minutes.

## Review Focus

- A coverage line whose test title contains `›`, quotes or trailing spaces must still match exactly (Task 1 tests).
- A spec or test that is renamed while ticked must fail the check, not pass silently (Task 1 tests).
- The local teardown must never run cleanup against a non-local database (Task 2 test).
- A fixture whose verification email never arrives must fail with a message naming the address, not a 30-second generic timeout (Task 2).
- Independent tracker tests must not depend on the time of day; any test that creates entries sets explicit times or relies only on its own user's data (Task 3).

---

### Task 1: Coverage list and its CI check

**Files:**
- Create: `apps/web/scripts/coverage-check.ts`, `apps/web/scripts/coverage-check.test.ts`, `docs/E2E_COVERAGE.md`
- Modify: `apps/web/vitest.config.ts` (include `scripts/**/*.test.ts`), `apps/web/package.json` (script `e2e:coverage`), `.github/workflows/ci.yml` (step after Lint)

**Interfaces:**
- Produces:
  - `parseCoverage(markdown: string): CoverageLine[]` where `CoverageLine = { line: number; ticked: boolean; text: string; spec?: string; title?: string }`.
  - `parseListedTests(listOutput: string): Set<string>`, keyed `` `${specFile}::${testTitle}` `` (the last `›` segment of each list line).
  - `findStale(lines: CoverageLine[], listed: Set<string>): CoverageLine[]`, ticked lines whose key is missing.
  - CLI: `pnpm --filter @timekeep/web e2e:coverage` runs `playwright test --list`, prints `covered N / total M (gaps G)`, and exits 1 listing every stale line.

- [ ] **Step 1: Write failing tests** in `coverage-check.test.ts`:
  - `parseCoverage` reads ``- [x] Start a timer — `tracker.spec.ts` › "start, reload and stop a timer"`` as `{ ticked: true, spec: "tracker.spec.ts", title: "start, reload and stop a timer" }`.
  - `- [ ] Create a project inline — gap` parses as `{ ticked: false }` with no spec.
  - Non-list lines and headings are ignored.
  - A title containing `›` and `"` (written as `\"`) round-trips.
  - `parseListedTests` reads `  [chromium] › tracker.spec.ts:36:7 › time tracker › start, reload and stop a timer` into the key `tracker.spec.ts::start, reload and stop a timer`, and handles `e2e\` or `e2e/` path prefixes.
  - `findStale` returns a ticked line whose title was renamed, and ignores gaps.
- [ ] **Step 2:** Run `pnpm --filter @timekeep/web exec dotenv -e ../../.env -- vitest run scripts/coverage-check.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the three functions and a `main()` that runs only when the file is executed directly (spawn `pnpm exec playwright test --list`, read `../../docs/E2E_COVERAGE.md`).
- [ ] **Step 4: Write `docs/E2E_COVERAGE.md`.** List every user-facing function of Phases 0–1, with one line per action or behaviour, grouped as in the spec. Tick the 18 functions covered today, naming their current spec and title; everything else is `gap`.
- [ ] **Step 5:** Run the tests (PASS) and `pnpm --filter @timekeep/web e2e:coverage` (exit 0, prints the counts). Rename one ticked title in a scratch copy and confirm the CLI exits 1 naming it; then restore.
- [ ] **Step 6:** Add the CI step `pnpm --filter @timekeep/web e2e:coverage` after Lint in `ci.yml`. Commit `e2e: coverage list and its CI check`.

### Task 2: Fixtures and local cleanup

**Files:**
- Create: `apps/web/e2e/fixtures.ts`, `apps/web/e2e/fixtures.spec.ts`, `apps/web/e2e/global-teardown.ts`, `apps/web/scripts/local-db-guard.ts`, `apps/web/scripts/local-db-guard.test.ts`
- Modify: `apps/web/playwright.config.ts` (`globalTeardown` only when not remote)

**Interfaces:**
- Consumes: `uniqueEmail`, `DEMO_PASSWORD` from `e2e/helpers/app.ts`; `waitForEmail`, `extractAppLink` from `e2e/helpers/mail.ts`.
- Produces (from `e2e/fixtures.ts`): `export const test` and `export { expect }` with fixtures:
  - `freshUser: { email: string; password: string; name: string; slug: string }`. Its page context is already signed in.
  - `demoUser: (who: "owner" | "admin" | "manager" | "member1" | "member2") => Promise<void>` signs the page's context in as `${who}@demo.test`.
  - `trackerPage: (slug?: string) => Promise<Page>` opens `/w/<slug ?? freshUser.slug>/tracker` and waits for `section[aria-label="Timer"][data-hydrated="true"]`.
- Produces (from `scripts/local-db-guard.ts`): `isLocalDatabaseUrl(url: string): boolean`.

- [ ] **Step 1: Write failing tests.**
  - `local-db-guard.test.ts`:
    - `isLocalDatabaseUrl` is true for `localhost`, `127.0.0.1` and `::1`;
    - it is false for a Supabase pooler URL and for `db.example.com`.
  - `fixtures.spec.ts`:
    - "freshUser starts signed in on its own workspace": `trackerPage()` shows heading "Time Tracker", and the URL contains `/w/${freshUser.slug}/tracker`;
    - "demoUser signs in as the requested role": `demoUser("admin")`, open `/w/demo/settings`, the "Workspace name" field is enabled (admins can edit);
    - "two tests get different fresh users": a module-level variable records the first test's email, and the second test asserts its own differs.
- [ ] **Step 2:** Run both and confirm they fail (modules missing).
- [ ] **Step 3: Implement.**
  - `freshUser`:
    - POST `/api/auth/sign-up/email` with `{ name, email, password: DEMO_PASSWORD, timezone: "Asia/Manila" }` through `page.request`.
    - `waitForEmail(email, { subject: /verify/i })`.
    - `page.request.get(extractAppLink(message))`, which follows redirects and sets the session cookie on the context.
    - Read the slug from `page.goto("/")`'s final URL (`/w/<slug>/tracker`).
    - On a missing email, rethrow as `Error("freshUser: no verification email for <email>")`.
  - `demoUser`: POST `/api/auth/sign-in/email`.
  - `global-teardown.ts`:
    - if `E2E_BASE_URL` is set, or `isLocalDatabaseUrl(DATABASE_URL)` is false, log and return;
    - otherwise spawn `pnpm db:e2e-cleanup` from the repo root.
- [ ] **Step 4:** Run the tests until they pass.
- [ ] **Step 5: Prove they can fail.**
  - Temporarily skip the verification GET in `freshUser`: the first spec must fail on the sign-in redirect.
  - Temporarily make `demoUser` sign in as `member1`: the admin test must fail on a disabled field.
  - Restore both.
- [ ] **Step 6:** Run the full local suite (green; teardown logs its cleanup counts). Commit `e2e: signed-in fixtures and local cleanup`.

### Task 3: Independent tracker tests

**Files:**
- Modify: `apps/web/e2e/tracker.spec.ts` (rewrite), `docs/E2E_COVERAGE.md` (update test names)
- Create: `apps/web/e2e/helpers/tracker.ts`

**Interfaces:**
- Consumes: `test`, `freshUser` and `trackerPage` from Task 2.
- Produces (from `e2e/helpers/tracker.ts`):
  - `timer(page)`, `today(page)`, `entry(page, description)`, the same locators as today;
  - `addManualEntry(page, { description: string; start: string; duration: string }): Promise<void>`, which uses Manual mode, waits for `[data-saving="false"]`, and returns to Timer mode;
  - `waitForSaves(page)`.

- [ ] **Step 1: Rewrite `tracker.spec.ts`** without `describe.serial` or `beforeAll`. Each test uses `freshUser` and `trackerPage`, and creates the entries it needs with `addManualEntry` at explicit early start times (`00:05`, `00:10`, …), so ordering never depends on the clock. Keep the seven behaviours and their assertions:
  - start/reload/stop;
  - manual 1.5 → 1:30:00;
  - inline duration edit persists;
  - continue + grouping;
  - delete + undo;
  - double Enter/S starts once;
  - two tabs.
- [ ] **Step 2:** Run `playwright test e2e/tracker.spec.ts` twice in a row, plus with `--repeat-each=2`. Expected: all green and independent.
- [ ] **Step 3: Prove each test can fail.** Break each guarded behaviour once, run that test, see it fail, restore:
  - `startTimer` no longer stops the running entry;
  - `parseDuration` returns minutes for bare numbers;
  - `editDuration` no longer saves;
  - `continueEntry` drops the project;
  - the Undo toast action no longer calls restore;
  - the in-flight guard in `begin()` is removed;
  - the BroadcastChannel post is removed.
- [ ] **Step 4:** Update the coverage lines to the new titles. Run `e2e:coverage` (exit 0) and the full suite. Commit `e2e: independent tracker tests on fresh users` with the break list in the body.

### Task 4: Timer bar backfill

**Files:**
- Create: `apps/web/e2e/timer-bar.spec.ts`
- Modify: `docs/E2E_COVERAGE.md`

**Interfaces:**
- Consumes: Task 2 fixtures and Task 3 helpers.

- [ ] **Step 1: Write the tests** (each uses `freshUser` and `trackerPage`):
  - "create a project inline and start a timer on it": open the project picker, type `Website`, choose `Create project "Website"`. The trigger reads `Project: Website`. Start, then stop; the entry row's project button reads `Project: Website`.
  - "search the project picker and clear the project": create `Alpha` and `Beta`, search `bet`, and only `Beta` is listed; pick it, then choose `No project`; the trigger reads `Project: none`.
  - "pick several tags, including one created inline": create tags `design` and `review`, select both, close the picker. The trigger reads `Tags: design, review`. Start and stop; the entry row shows both.
  - "the billable toggle is saved with the entry": press `Billable` (it becomes pressed), start and stop; the row's `Billable` is pressed.
  - "autocomplete fills project, tags and billable from a recent entry": create an entry `Design review` with project `Website`, tag `design` and billable on, via the timer. In a cleared bar, type `Desi` and pick the suggestion; the project, tags and billable controls all show those values.
  - "N focuses the description and Esc leaves it": click the page body, press `n`, and the Description field is focused; press `Escape`, and it is not.
  - "S starts and stops the timer from another page": go to `/w/<slug>/team`, press `s`, and the title matches `^0:00:\d\d`; press `s` again, and the title is back to the page title.
- [ ] **Step 2:** Run them. Expected: green (they cover existing behaviour).
- [ ] **Step 3: Prove each test can fail.** Break one behaviour per test, see it fail, restore:
  - `createProjectAction` returns an error;
  - `CommandInput` search is ignored (the filter is removed);
  - `TagPicker.commit` keeps only the first tag;
  - `startTimer` ignores `billable`;
  - `DescriptionInput.pick` drops `tagIds`;
  - the `n` branch in `useKeyboardShortcuts` is removed;
  - the shortcut listener is limited to the tracker page.
- [ ] **Step 4:** Tick the seven coverage lines. Run `e2e:coverage` and the full suite. Commit `e2e: timer bar backfill` with the break list.

### Task 5: Rules, docs and the two-environment gate

**Files:**
- Modify: `CLAUDE.md` (invariant 6 and the Conventions e2e bullet), `docs/PROGRESS.md`

- [ ] **Step 1: `CLAUDE.md`.**
  - Invariant 6 adds: "From Phase 2, a feature starts with unticked lines in `docs/E2E_COVERAGE.md` and failing e2e tests before app code."
  - The e2e conventions bullet names the fixtures (`freshUser`, `demoUser`, `trackerPage`), the coverage check, the prove-it-fails rule and the 10-minute preview budget.
- [ ] **Step 2:** `docs/PROGRESS.md` gets an "E2E suite" section with the covered/total counts from `e2e:coverage`.
- [ ] **Step 3:** Run the full local gate (`pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`) and `e2e:coverage`.
- [ ] **Step 4:** Push the branch and wait for `e2e-preview.yml`. Expected: green with no flaky tests, under 10 minutes.
- [ ] **Step 5:** Fast-forward `main` and push. Commit `docs: e2e suite rules and coverage`.
