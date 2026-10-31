import { type APIRequestContext, expect, type Page } from "@playwright/test";
import {
  addDaysToKey,
  formatPeriod,
  type Period,
  periodOf,
  previousPeriod,
  zonedDateTimeToInstant,
} from "@timekeep/core";

import { waitForApp } from "./app";
import { openSettings, saveSettings } from "./settings";

/** Approvals and lock dates (Phase 5a): settings, the period bar, the Approvals page. */

/** The secret Playwright gives the servers it starts; `/api/test/run-daily` needs it. */
export const LOCAL_E2E_SECRET = "local-e2e-secret-for-test-hooks";

const REMOTE_URL = process.env.E2E_BASE_URL?.replace(/\/$/, "");

/** The weekly periods of a workspace in `tz` (Monday weeks): this one and the one before. */
export function weeks(tz: string, now = new Date()) {
  const rule = { period: "WEEKLY" as const, timezone: tz, weekStart: 1 as const };
  const current = periodOf(now, rule);
  const last = previousPeriod(current, rule);
  return {
    current,
    last,
    /** Wednesday of last week: inside it whatever the zone of whoever adds the entry. */
    lastWednesday: addDaysToKey(last.start, 2),
  };
}

export const periodName = (p: Period) => `Period ${formatPeriod(p)}`;

/** The period's group in the period bar (timesheet or tracker). */
export const periodGroup = (page: Page, p: Period) =>
  page.getByRole("group", { name: periodName(p), exact: true });

/** Noon on `dateKey` in `tz`, as an instant. */
export const noonOn = (dateKey: string, tz: string) =>
  zonedDateTimeToInstant({ date: dateKey, hours: 12, minutes: 0 }, tz);

export async function enableApproval(page: Page, slug: string) {
  await openSettings(page, slug);
  await page.getByRole("switch", { name: "Require approval" }).click();
  await saveSettings(page);
}

export async function setRollingLock(page: Page, slug: string, days: number) {
  await openSettings(page, slug);
  await page.getByRole("radio", { name: "Older than a number of days" }).click();
  await page.getByRole("spinbutton", { name: "Days" }).fill(String(days));
  await saveSettings(page);
}

export async function openTimesheetWeek(page: Page, slug: string, dayKey: string) {
  await page.goto(`/w/${slug}/timesheet?week=${dayKey}`);
  await expect(page.locator('main[data-hydrated="true"]')).toBeVisible();
}

/** Submits `p` from the timesheet week that contains it. */
export async function submitPeriod(page: Page, slug: string, p: Period) {
  await openTimesheetWeek(page, slug, p.start);
  const group = periodGroup(page, p);
  await group.getByRole("button", { name: "Submit for approval" }).click();
  await expect(group).toContainText("Pending approval");
}

export async function openApprovals(page: Page, slug: string, tab = "pending") {
  await page.goto(`/w/${slug}/approvals?tab=${tab}`);
  await waitForApp(page);
}

/** The Approvals table row of `name`'s request for `p`. */
export const requestRow = (page: Page, name: string, p: Period) =>
  page.getByRole("row", { name: new RegExp(`${name}.*${formatPeriod(p)}`) });

/** Runs the daily job for one workspace at `now` (e2e hook; never in production). */
export async function runDailyJob(request: APIRequestContext, slug: string, now: Date) {
  const res = await request.get(
    `/api/test/run-daily?slug=${encodeURIComponent(slug)}&now=${encodeURIComponent(now.toISOString())}`,
    {
      headers: {
        "x-e2e-secret": process.env.E2E_SECRET ?? (REMOTE_URL ? "" : LOCAL_E2E_SECRET),
      },
    },
  );
  expect(res.ok(), `run-daily answered ${res.status()}`).toBe(true);
}
