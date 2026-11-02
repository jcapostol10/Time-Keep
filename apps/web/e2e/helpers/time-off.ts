import { expect, type Page } from "@playwright/test";
import { addDaysToKey, localDateKey, periodOf, previousPeriod } from "@timekeep/core";

import { waitForApp } from "./app";
import { openSettings, saveSettings } from "./settings";

/** Time off, holidays, attendance and targets (Phase 5b): pages, dialogs and dates. */

export type TimeOffTab = "requests" | "calendar" | "balances" | "policies" | "holidays";

export async function openTimeOff(page: Page, slug: string, tab: TimeOffTab = "requests") {
  await page.goto(`/w/${slug}/time-off?tab=${tab}`);
  await waitForApp(page);
  await expect(page.getByRole("heading", { name: "Time off", level: 1 })).toBeVisible();
}

/**
 * A Monday and Tuesday in the current calendar year: next week's, or last
 * week's when next week starts the next year (balances count this year only).
 */
export function timeOffDays(tz: string, now = new Date()) {
  const rule = { period: "WEEKLY" as const, timezone: tz, weekStart: 1 as const };
  const current = periodOf(now, rule);
  const year = localDateKey(now, tz).slice(0, 4);
  const next = addDaysToKey(current.start, 7);
  const monday = next.startsWith(year) ? next : previousPeriod(current, rule).start;
  return { monday, tuesday: addDaysToKey(monday, 1), weekStart: monday };
}

/** Last week's Monday-to-Sunday and its Wednesday (the attendance specs' days). */
export function lastWeek(tz: string, now = new Date()) {
  const rule = { period: "WEEKLY" as const, timezone: tz, weekStart: 1 as const };
  const last = previousPeriod(periodOf(now, rule), rule);
  return { ...last, wednesday: addDaysToKey(last.start, 2), thursday: addDaysToKey(last.start, 3) };
}

export async function createPolicyViaUi(
  page: Page,
  slug: string,
  opts: {
    name: string;
    unit?: "Days" | "Hours";
    accrual?: "No allowance" | "Yearly" | "Monthly";
    allowance?: string;
    requiresApproval?: boolean;
    allowNegative?: boolean;
  },
) {
  await openTimeOff(page, slug, "policies");
  await page.getByRole("button", { name: "Add policy" }).click();
  const dialog = page.getByRole("dialog", { name: "New policy" });
  await dialog.getByRole("textbox", { name: "Name" }).fill(opts.name);
  await dialog.getByRole("radio", { name: opts.unit ?? "Days" }).check();
  await dialog.getByRole("radio", { name: opts.accrual ?? "Yearly" }).check();
  if (opts.allowance !== undefined) {
    await dialog.getByRole("textbox", { name: "Allowance" }).fill(opts.allowance);
  }
  const approval = dialog.getByRole("switch", { name: "Requires approval" });
  if ((await approval.getAttribute("aria-checked")) !== String(opts.requiresApproval ?? true)) {
    await approval.click();
  }
  if (opts.allowNegative)
    await dialog.getByRole("switch", { name: "Allow negative balance" }).click();
  await dialog.getByRole("button", { name: "Save policy" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("row", { name: new RegExp(opts.name) })).toBeVisible();
}

export async function requestTimeOffViaUi(
  page: Page,
  slug: string,
  opts: { policy: string; start: string; end: string; halfDay?: boolean; note?: string },
) {
  await openTimeOff(page, slug, "requests");
  await page.getByRole("button", { name: "Request time off" }).click();
  const dialog = page.getByRole("dialog", { name: "Request time off" });
  await dialog.getByRole("combobox", { name: "Policy" }).click();
  await page.getByRole("option", { name: opts.policy, exact: true }).click();
  await dialog.getByLabel("Start date").fill(opts.start);
  await dialog.getByLabel("End date").fill(opts.end);
  if (opts.halfDay) await dialog.getByRole("radio", { name: "Half day" }).check();
  if (opts.note) await dialog.getByRole("textbox", { name: "Note" }).fill(opts.note);
  await dialog.getByRole("button", { name: "Request", exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** A row of the Requests tab: `section` is "My time off", "To review" or "Decided". */
export const requestRowIn = (page: Page, section: string, text: RegExp | string) =>
  page.getByRole("table", { name: section }).getByRole("row").filter({ hasText: text });

export async function importHolidaysViaUi(
  page: Page,
  slug: string,
  opts: { country: string; year: number; untick?: string },
): Promise<number> {
  await openTimeOff(page, slug, "holidays");
  await page.getByRole("button", { name: "Import public holidays" }).click();
  const dialog = page.getByRole("dialog", { name: "Import public holidays" });
  await dialog.getByRole("combobox", { name: "Country" }).selectOption(opts.country);
  await dialog.getByRole("spinbutton", { name: "Year" }).fill(String(opts.year));
  await dialog.getByRole("button", { name: "Show holidays" }).click();
  const list = dialog.getByRole("list", { name: "Holidays to import" });
  await expect(list.getByRole("listitem").first()).toBeVisible();
  if (opts.untick) await list.getByRole("checkbox", { name: opts.untick, exact: true }).uncheck();
  const ticked = await list.getByRole("checkbox", { checked: true }).count();
  await dialog.getByRole("button", { name: /^Import \d+ holidays?$/ }).click();
  await expect(dialog).toBeHidden();
  return ticked;
}

/** Owners and admins: set who approves (periods and time off) in Settings. */
export async function setApprovers(page: Page, slug: string, label: string) {
  await openSettings(page, slug);
  await page.getByRole("combobox", { name: "Who approves" }).click();
  await page.getByRole("option", { name: label }).click();
  await saveSettings(page);
}
