# UI foundation: the owner's brief (2026-11-18)

Verbatim from the owner. This is the binding spec for `docs/superpowers/plans/2026-11-18-ui-foundation.md`.

This is a UI refresh, not a feature change: no behaviour, data or permission changes. Create branch feat/ui-foundation.

Design direction (owner-approved): TimeKeep's identity comes from punch clocks and time cards. One bold element (the running timer, done in Prompt 2); everything else quiet and disciplined. Avoid the stock shadcn look.

1. Baseline first. Write apps/web/e2e/visual/snapshots.spec.ts (excluded from the normal e2e run, `pnpm e2e:visual`) that signs in as owner@demo.test on the seeded demo workspace and saves full-page screenshots of: tracker (idle and with a running timer), timesheet, calendar week, dashboard Me and Team, reports Summary and Detailed, projects list, a project detail, team, settings, approvals, invoices list, and the sign-in page. Each at 1440×900 and 375×812, in light and dark, into apps/web/e2e/visual/__screenshots__/before/. Run it before any style change and commit the screenshots.

2. Type. Replace Geist with IBM Plex Sans (400, 500, 600) for the UI and IBM Plex Sans Condensed (600) as --font-display, both through next/font/google. Confirm tabular figures render in both (font-feature-settings "tnum"); if Condensed lacks them, say so and stop. Set a type scale in packages/ui/src/styles/globals.css: 12 / 13 / 14 (body) / 16 / 20 / 28, display 32 and 48 for clocks and totals; line-height 1.5 body, 1.2 headings. Page titles 20/600, not 24+. Remove every text-[11px]; nothing below 12px.

3. Colour tokens (keep shadcn token names so components work):
   - light: background #F6F7F9, card #FFFFFF, foreground #1E2430, muted-foreground #5B6472 (must pass 4.5:1 on both background and card), border #DCE0E6, primary #0F6E66, primary-foreground #FFFFFF, ring #0F6E66.
   - dark: background #12161C, card #181D24, foreground #E6E9EE, muted-foreground #A3ABB7 (4.5:1 on card), border rgba(255,255,255,0.09), primary #3FB8AC, primary-foreground #0B1F1D.
   - New token --live: #D9910B light / #F0B23A dark, with --live-foreground. It means "time is running" and is used ONLY for the running timer, the calendar now-line and the live dot on Team activity. Add a test or lint check that greps for --live outside those components.
   - Charts: keep 5 chart tokens but make chart-1 the primary and drop the purple/pink; re-check every chart in both themes.
   Write scripts/check-contrast.ts that reads the tokens and fails CI below WCAG AA for text pairs.

4. Radius and depth. Radius 6px for controls, 10px for dialogs and popovers, 0 for table rows. Remove shadow-xs from bars and cards in the app (keep shadows on popovers and dialogs only). Use spacing and a single border to separate regions, not stacked bordered cards.

5. Shell (components/shell):
   - Sidebar section labels in sentence case 12px/500 muted ("Track", "Analyze", "Manage"), no uppercase or letter-spacing. Active item: 2px primary bar on the left plus foreground text, no filled pill.
   - Main content: left-aligned to the sidebar with 32px gutter (16px under 768px) and max-width 1200px, not centred in the remaining space. Wide tables (reports, timesheet, team) may use the full width.
   - Top bar: workspace switcher left; on the right, help, theme and avatar as today, but if a timer is running show a compact amber "0:42:10 · description" chip that links to the tracker (read from the existing tracker cache/channel; no new fetching).
   - Page header component: title, optional one-line description, actions on the right; consistent across every page.

6. Empty states (components/empty-state.tsx): no icon circle. A title that says what to do and a primary button that does it (e.g. tracker: "Track your first entry" + "Start timer" that focuses the description; projects: "Create a project"). Update every caller with real copy in sentence case.

7. Quality floor: visible focus ring (2px ring token, offset 2px) on every interactive element; prefers-reduced-motion respected; nothing overflows at 375px.

8. Re-run the visual snapshots into __screenshots__/after/ and write docs/UI.md with the tokens, type scale, the --live rule and before/after pairs for five screens. Run lint, typecheck, test, e2e: all green (update selectors only where copy changed, and say which).

Plan first and wait for approval. Commit after each numbered step.
