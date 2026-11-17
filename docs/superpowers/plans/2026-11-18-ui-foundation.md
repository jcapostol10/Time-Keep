# UI foundation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native execution) to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give TimeKeep a quiet, disciplined look drawn from punch clocks and time cards, without changing behaviour, data or permissions. This covers tokens, type, radius, shell, page header, empty states and a quality floor, measured against before/after screenshots.

**Architecture:** The theme lives in `packages/ui/src/styles/globals.css`. Components keep shadcn token names, so most screens change through tokens alone. Some edits are mechanical sweeps (type classes, shadows, radius, focus). The rest is a small set of targeted component edits (shell, `PageHeader`, `EmptyState`, top-bar timer chip). Guard tests stop regressions: the type scale, `--live` usage, contrast and 375px overflow.

**Tech stack:** Tailwind v4 (`@theme inline`), shadcn/ui in `packages/ui`, `next/font/google`, Playwright (a separate visual config), Vitest, Node 22 type-stripping for the contrast script.

**Spec:** `docs/superpowers/specs/2026-11-18-ui-foundation-brief.md` (the owner's brief, verbatim).

## Global constraints

- No behaviour, data or permission changes. Copy changes only in empty states (step 6), and the e2e selectors that change because of them are listed in the final message.
- The tokens use the brief's exact hex values. Light theme: background `#F6F7F9`, card `#FFFFFF`, foreground `#1E2430`, muted-foreground `#5B6472`, border `#DCE0E6`, primary `#0F6E66`, primary-foreground `#FFFFFF`, ring `#0F6E66`. Dark theme: background `#12161C`, card `#181D24`, foreground `#E6E9EE`, muted-foreground `#A3ABB7`, border `rgba(255,255,255,0.09)`, primary `#3FB8AC`, primary-foreground `#0B1F1D`. Live: `#D9910B` light, `#F0B23A` dark. Owner ruling (2026-11-18): the calendar now-line uses `--live-line`, a darker amber `#B07400` in light (3.67:1 on background, 3.93:1 on card), `#F0B23A` in dark; the chip and dot keep `--live`.
- Owner ruling (2026-11-18): screenshots are JPEG at quality 85, not PNG, to keep the public repo small.
- Type scale: 12 / 13 / 14 (body) / 16 / 20 / 28, plus display 32 and 48. Body line-height is 1.5 and headings 1.2. Page titles are 20/600. Nothing renders below 12px.
- Radius: controls 6px, dialogs and popovers 10px, table rows 0. Shadows stay only on popovers, dropdowns, selects, tooltips, dialogs and sheets.
- `--live` is used only by the running timer (timer bar and top-bar chip), the calendar now-line and the live dot on Team activity.
- Every page still works at 375px. One commit per numbered step. The full gate (`format:check`, `lint`, `typecheck`, `test`, `e2e` on a production build) passes at the end.
- Dark mode stays the `.dark` class from `next-themes`.

## Decisions I made (the owner can overrule)

1. **Font sizes are a closed scale.** The default Tailwind font sizes are cleared (`--text-*: initial`) and replaced with `xs` 12, `meta` 13, `sm` 14 (body, shadcn's default text class), `base` 16, `xl` 20, `2xl` 28, `display` 32 and `display-lg` 48. Once cleared, `text-lg`, `text-3xl` and similar classes generate nothing, so all of their 75 uses are moved onto the scale. A test then fails on any off-scale or arbitrary `text-[Npx]` class.
2. **The focus ring is a CSS outline.** A base rule gives every focusable element `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px }`. The components' own `focus-visible:ring-[3px]` rules are removed so rings don't double up. An outline also covers links, table cells and custom buttons, which a per-component ring misses.
3. **Wide pages opt out of the width limit with a data attribute.** The content column is `max-w-[1200px]`, left-aligned. Reports, the timesheet and the team page put `data-layout="wide"` on their root. The column uses `has-[[data-layout=wide]]:max-w-none`, so no state is passed from page to layout.
4. **Tokens the brief doesn't fix:** the secondary, muted, accent, destructive, input, popover and sidebar colours, plus chart-2 to chart-5. I set these myself in step 3, in hex, and `check-contrast.ts` checks them. The sidebar uses the background colour with a single right border. Charts: chart-1 is the primary, and the others are steel blue, olive, brick and slate. None is amber, so a chart is never read as "live", and none is purple or pink.
5. **Cards use 10px radius**, the same as dialogs. They lose their shadow and keep one border. Where a card sits inside another card (settings, dashboard, project tabs), the inner border goes and spacing separates the two.
6. **Empty states with an action are page-level only.** They cover a page's main list when it has no rows: tracker, projects, clients, tags, invoices, kiosks, tasks tab, groups tab, expenses, time-off requests. Empty results from a filter ("No projects match") and small notes inside cards or dialogs stay as one line of muted text, because there is no single action that fixes them.
7. **The demo timer is cleaned up.** The visual spec starts a timer for the demo owner on the local database only, then stops and deletes that entry. The demo tenant is left as it was found.

## Review focus

1. **Dark-mode charts and status colours.** Raw palette classes (`bg-emerald-500`, `text-red-600`, …) outside the tokens may now clash with the new surfaces. The after-snapshots are reviewed for this, in both themes.
2. **The width limit on wide pages.** The 1200px column must not clip the reports, timesheet or team tables. The 375px overflow test covers mobile, and the 1440 snapshots cover desktop.
3. **Off-scale classes in `packages/ui`.** Classes such as `text-lg` in `DialogTitle` and `SheetTitle` silently lose their size once the scale is cleared. The type-scale test reads `packages/ui/src` as well as `apps/web/src`.
4. **The top-bar chip.** It must not re-render the whole shell every second. It lives in its own component that alone reads `useTrackerClock()`, and it is hidden while hydration is unknown, so the server and client render the same markup.
5. **Copy changes in e2e.** Any spec that asserts on the old empty-state titles is updated, and the final message lists each one.

---

### Task 1: Visual baseline (brief step 1)

**Files:**
- Create: `apps/web/playwright.visual.config.ts`, `apps/web/e2e/visual/snapshots.spec.ts`, `apps/web/e2e/visual/__screenshots__/before/*`
- Modify: `apps/web/playwright.config.ts` (add `"**/visual/**"` to `testIgnore`), `apps/web/package.json` (`"e2e:visual": "dotenv -e ../../.env -- playwright test -c playwright.visual.config.ts"`), the root `package.json` (`"e2e:visual": "pnpm --filter @timekeep/web e2e:visual"`)

- [ ] **The config.** `testDir: "./e2e/visual"`, 1 worker, local `webServer` the same as the main config. The output set comes from `VISUAL_SET` (`before` | `after`, default `after`).
- [ ] **The spec.** Sign in once as `owner@demo.test` over HTTP and save the storage state. For each viewport (`{1440,900}`, `{375,812}`) and each colour scheme (`page.emulateMedia({ colorScheme })` with `defaultTheme="system"`), visit each screen, wait for `main[data-hydrated="true"]` and network idle, and save a full-page `<screen>-<w>-<scheme>.jpg` (`type: "jpeg", quality: 85`). The screens are: tracker-idle, tracker-running, timesheet, calendar-week, dashboard-me, dashboard-team, reports-summary, reports-detailed, projects, project-detail (the first project in the list), team, settings, approvals, invoices and sign-in (signed out). For tracker-running, start a timer from the timer bar, shoot, then stop it and delete the entry in a `finally` block.
- [ ] **Exclusion check.** Run `pnpm --filter @timekeep/web exec playwright test --list | grep -c visual`. Expected: `0`.
- [ ] **Run it.** Run `VISUAL_SET=before pnpm e2e:visual`. Expected: 60 files in `before/`. Open three of them and check they show the right screens.
- [ ] **Commit:** `visual: baseline screenshots before the UI refresh`.

### Task 2: Type (brief step 2)

**Files:** `apps/web/src/app/layout.tsx`, `packages/ui/src/styles/globals.css`, every file with an off-scale class, `apps/web/src/ui-scale.test.ts` (new)

- [ ] **Failing test first.** Write `ui-scale.test.ts`. It globs `apps/web/src/**/*.tsx` and `packages/ui/src/**/*.tsx` and fails on `text-(lg|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b` or `text-\[\d+px\]`, printing each `file:line`. Run it. Expected: FAIL, listing about 40 sites (the 4 `text-[11px]` among them).
- [ ] **Fonts.** In `layout.tsx`, `IBM_Plex_Sans({ weight: ["400","500","600"], variable: "--font-plex-sans" })` and `IBM_Plex_Sans_Condensed({ weight: ["600"], variable: "--font-plex-condensed" })`. In `@theme`, `--font-sans` and `--font-display` point at them, and `--font-mono` becomes `ui-monospace, monospace` (Geist Mono is dropped; it had two uses).
- [ ] **The tabular-figures gate.** Render `0123456789` and `1111111111` in both faces with `tnum` on, in a scratch Playwright check against the dev server. Expected: equal widths in each face. **If Condensed fails, stop and report to the owner** (brief step 2).
- [ ] **The scale.** In `@theme`: `--text-*: initial`, then the eight sizes from decision 1, each with its `--line-height` (1.5 up to 16, 1.2 from 20). Remap the uses: `text-lg` becomes `text-base` in running text, or `text-xl` for titles; `text-2xl` page titles become `text-xl font-semibold`; `text-3xl` clocks and totals become `text-display font-display`; `text-[11px]` becomes `text-xs`. `PageHeader`'s h1 becomes `text-xl font-semibold`, and `tracking-tight` is dropped.
- [ ] **Verify.** Run `pnpm --filter @timekeep/web exec vitest run src/ui-scale.test.ts`. Expected: PASS. Then run `pnpm typecheck && pnpm lint`. Expected: clean.
- [ ] **Commit:** `type: IBM Plex Sans and Condensed on a closed 12–48 scale`.

### Task 3: Colour tokens (brief step 3)

**Files:** `globals.css`, `scripts/check-contrast.ts` (new, root), the root `package.json` (`"contrast:check": "node scripts/check-contrast.ts"`), `.github/workflows/ci.yml`, `apps/web/src/live-token.test.ts` (new), `components/calendar/now-line.tsx`, `components/dashboard/dashboard-view.tsx` (the live dot), every chart file (`summary-charts.tsx`, `dashboard-view.tsx`, `budget-tab.tsx`, `status-tab.tsx`)

- [ ] **Failing contrast check first.** `check-contrast.ts` parses `:root` and `.dark` from `globals.css` (hex and `rgba()` blended over the background). It checks these text pairs at 4.5:1:
  - foreground and muted-foreground on background, card, popover and muted;
  - primary on background and card;
  - primary-foreground/primary, secondary-foreground/secondary, accent-foreground/accent, destructive on background and card, destructive-foreground/destructive, sidebar-foreground/sidebar and live-foreground/live. Graphics at 3:1 (exit 1 below): live-line on background and card, ring on background.
  It exits 1 and prints every pair below AA. Run it against today's oklch file. Expected: FAIL ("unparsed token"), because it reads hex only.
- [ ] **Tokens.** Write both themes in hex, using the brief's values plus decision 4. Add `--live`, `--live-foreground` (`#1E1400` light, `#2A1C00` dark), `--live-line` (`#B07400` light, `#F0B23A` dark), and `--color-live` / `--color-live-foreground` / `--color-live-line` in `@theme`. Run `pnpm contrast:check`. Expected: PASS, printing each pair's ratio.
- [ ] **Failing `--live` guard.** `live-token.test.ts` greps `apps/web/src` and `packages/ui/src` for `(bg|text|border|fill|stroke|ring|outline)-live(-line|-foreground)?\b|var\(--live` and allows only `components/shell/timer-chip.tsx`, `components/tracker/timer-bar.tsx`, `components/calendar/now-line.tsx` and `components/dashboard/live-dot.tsx`. Its self-check plants a use in a temporary fixture string and expects the matcher to flag it. Then move the now-line from `red-500` to `live-line` (line and dot) and the Team activity dot from `bg-primary` to `live`, extracting `live-dot.tsx`. Run the test. Expected: PASS.
- [ ] **Charts.** Make sure every chart reads `var(--chart-N)` with no hardcoded hex. Check each in both themes on the dev server (dashboard, Summary, Budget, Status).
- [ ] **CI.** Add a `pnpm contrast:check` step to `ci.yml` before lint. Run `pnpm format:check && pnpm --filter @timekeep/web exec vitest run src/live-token.test.ts`. Expected: clean.
- [ ] **Commit:** `tokens: the owner's palette, --live for running time, contrast check in CI`.

### Task 4: Radius and depth (brief step 4)

**Files:** `globals.css` (`--radius: 6px`; `--radius-sm` 4px, `--radius-md` 6px, `--radius-lg` 10px, `--radius-xl` 10px), and in `packages/ui/src/components/` `button`, `input`, `textarea`, `select`, `checkbox`, `radio-group`, `switch`, `tabs`, `card`, `popover`, `dropdown-menu`, `select` (content), `tooltip`. Also `tracker/timer-bar.tsx`, `calendar/calendar-block.tsx`, `calendar/calendar-page-client.tsx`, `time-off/import-holidays-dialog.tsx`, and any card-in-card found by grepping `<Card` inside `CardContent`.

- [ ] **Failing guard.** Extend `ui-scale.test.ts` with a `shadow-(xs|sm)\b` check outside `dialog`, `sheet`, `popover`, `dropdown-menu`, `select`, `tooltip`, `command` and `alert-dialog`. Run it. Expected: FAIL, listing about 13 files.
- [ ] **Shadows and radius.** Remove those shadows. Overlay content (popover, dropdown, select, tooltip) goes from `rounded-md` to `rounded-lg`, and dialog and sheet stay `rounded-lg` (10px). Strip the radius from row-level elements in tables and entry lists. Flatten nested cards.
- [ ] **Verify.** Run the guard. Expected: PASS. Then run `pnpm typecheck`.
- [ ] **Commit:** `depth: one border, no card shadows; 6px controls, 10px overlays`.

### Task 5: The shell and page header (brief step 5)

**Files:** `components/shell/sidebar-nav.tsx`, `app-shell.tsx`, `components/shell/timer-chip.tsx` (new), `components/page-header.tsx`, every page that renders its own h1 (`projects/[projectId]/layout.tsx`, `invoice-editor.tsx`, `shared-report.tsx`) or no header, and `data-layout="wide"` on the reports, timesheet and team page roots. Tests: `e2e/shell.spec.ts` (new), `docs/E2E_COVERAGE.md`.

- [ ] **Failing e2e first.** `shell.spec.ts` covers two behaviours:
  - (a) *a running timer shows a chip in the top bar that links to the tracker*: `freshUser`, start a timer on the timesheet page, expect `getByRole("link", { name: /0:00:0\d · / })`, click it, and expect the tracker URL. Then stop it and expect the chip to be gone.
  - (b) *the active nav item is marked*: `aria-current="page"` on Timesheet.

  Add an unticked coverage line for (a). Run it. Expected: (a) FAIL.
- [ ] **Sidebar.** Group labels are `text-xs font-medium text-muted-foreground`, with no uppercase and no tracking. An item is `relative` with `text-muted-foreground hover:text-foreground`. The active item is `text-foreground` with a `before:` 2px `bg-primary` bar on the left. There are no fills.
- [ ] **Main column.** `px-4 md:px-8 py-6`, and the inner div is `w-full max-w-[1200px] has-[[data-layout=wide]]:max-w-none`, with no `mx-auto`.
- [ ] **The chip.** `TimerChip` reads `useTracker().running` and `useTrackerClock().elapsedSeconds`. It renders a `Link` to `workspaceRoutes.tracker(slug)` with `bg-live text-live-foreground rounded-md px-2 text-meta font-medium tabular-nums`, showing `formatClock(elapsed) · description` ("(no description)" when empty). The description is truncated at `max-w-48`, and only the clock shows under `sm`. It renders nothing until hydrated.
- [ ] **The page header.** Make every workspace page use `PageHeader`: title `text-xl font-semibold`, at most one line of description (`text-sm text-muted-foreground`), and actions on the right that wrap under the title at 375px. Replace the three ad-hoc h1s. Pages with no header get one, with the same title as their nav label.
- [ ] **Verify.** Run `pnpm --filter @timekeep/web e2e -- shell.spec.ts`. Expected: PASS. Tick the coverage line after a deliberate break (no chip rendered) was seen to fail, and run `e2e:coverage`.
- [ ] **Commit:** `shell: quiet sidebar, left-aligned 1200px column, running-timer chip, one page header`.

### Task 6: Empty states (brief step 6)

**Files:** `components/empty-state.tsx` and its callers: `tracker/entry-list.tsx`, `projects/projects-table.tsx`, `clients/clients-table.tsx`, `tags/tags-table.tsx`, `invoices/invoice-table.tsx`, `kiosk/kiosks-page-client.tsx`, `projects/tasks-tab.tsx`, `team/groups-tab.tsx`, the expenses list, `time-off/requests-tab.tsx`, `app/not-found.tsx` and `coming-soon.tsx`. Tests: the existing e2e specs that assert the old copy, plus one new tracker case.

- [ ] **Failing e2e first.** In `tracker.spec.ts`, add *empty tracker offers to start the first entry*: with a `freshUser`, expect the heading "Track your first entry". Clicking "Start timer" focuses the timer bar's description input (`toBeFocused()`) and starts nothing (no chip). Run it. Expected: FAIL.
- [ ] **The component.** New props: `{ title: string; description?: string; action?: React.ReactNode; className?: string }`. No icon. A left-aligned block in a single dashed border: `py-12`, title `text-base font-semibold`, description `text-sm text-muted-foreground max-w-prose`.
- [ ] **Callers.** Each caller gets its copy and its action, wired to the existing create dialog or handler. The copy, in sentence case:

  | Page | Title | Description | Button |
  | --- | --- | --- | --- |
  | Tracker | Track your first entry | Type what you're working on and start the timer, or add time you already worked. | Start timer (calls `focusDescription()`) |
  | Projects | Create a project | Projects group your time by client and work. | Create project |
  | Clients | Add a client | | Add client |
  | Tags | Create a tag | | Create tag |
  | Invoices | Create an invoice | | Create invoice |
  | Kiosks | Add a kiosk | | Add kiosk |
  | Tasks | Add a task | | Add task |
  | Groups | Create a group | | Create group |
  | Expenses | Record an expense | | Record expense |
  | Time off | Request time off | | Request time off |

  A viewer who may not create gets the title as a statement with no button (for example "No projects yet" for a member), so permissions stay as they are. `not-found` and `coming-soon` keep their meaning, without the icon.
- [ ] **Selectors.** Update the e2e specs that asserted the old titles (find them with `grep -rn "No .* yet" apps/web/e2e`) and record each in the ledger. Run the touched specs. Expected: PASS.
- [ ] **Commit:** `empty states: say what to do and offer the button that does it`.

### Task 7: The quality floor (brief step 7)

**Files:** `globals.css` (base focus rule; a `@media (prefers-reduced-motion: reduce)` block that zeroes `animation-duration`, `transition-duration` and `scroll-behavior` on `*`), the `focus-visible:ring*` classes removed from `packages/ui/src/components/*`, `e2e/ui-floor.spec.ts` (new), `docs/E2E_COVERAGE.md`

- [ ] **Failing e2e first.** `ui-floor.spec.ts`, signed in as the demo owner (read-only), has three tests:
  - (a) *every main page fits 375px*: for the 14 signed-in screens of Task 1 at 375×812, expect `document.documentElement.scrollWidth <= 375`.
  - (b) *keyboard focus is visible*: on the tracker, tab five times, and for each focused element expect computed `outline-width` `2px` with `outline-style` not `none`.
  - (c) *reduced motion*: with `reducedMotion: "reduce"`, open the user menu and expect the menu content's computed `animation-duration` to be `0s` or `1e-05s`.

  Add the coverage lines. Run it. Expected: (b) and (c) FAIL, and (a) passes or fails with named pages.
- [ ] **Implement.** Add the focus outline and the reduced-motion block, remove the ring classes, and fix any page that (a) names.
- [ ] **Verify.** Run the spec. Expected: PASS. Tick the lines after the deliberate breaks (outline removed, motion block removed) were seen to fail.
- [ ] **Commit:** `quality floor: 2px focus outline everywhere, reduced motion, nothing wider than 375px`.

### Task 8: After snapshots, docs and the gate (brief step 8)

**Files:** `apps/web/e2e/visual/__screenshots__/after/*`, `docs/UI.md` (new), `CLAUDE.md` (the UI convention line: fonts, scale, tokens, the `--live` rule, `PageHeader`, `EmptyState`, `data-layout="wide"`, `pnpm e2e:visual`, `pnpm contrast:check`), `docs/BACKLOG.md` (any deferred finding)

- [ ] **Snapshots.** Run `VISUAL_SET=after pnpm e2e:visual`. Expected: 60 files. Review tracker, dashboard, reports Summary, projects and settings in both themes and both widths, and fix anything that reads wrong before writing the docs.
- [ ] **`docs/UI.md`.** It records the token table (both themes, with contrast ratios from `contrast:check`), the type scale, radius and depth, the `--live` rule and its guard, layout (1200px, wide pages), the empty-state pattern, and five before/after pairs (tracker, dashboard, reports Summary, projects, settings; light 1440, plus one at 375 dark), as relative image links.
- [ ] **The gate.** Run `pnpm format:check && pnpm contrast:check && pnpm lint && pnpm typecheck && pnpm test`, then build and run e2e (`CI=1 AUTH_RATE_LIMIT_ENABLED=false`). Expected: all green.
- [ ] **Commit:** `docs: UI.md with tokens, scale, the --live rule and before/after pairs`.

Then comes the final whole-branch review: a fresh reviewer on Opus with the brief, this plan and the ledger's rulings, followed by one fix pass, then the merge to `main`.
