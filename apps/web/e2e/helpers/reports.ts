import { expect, type Page } from "@playwright/test";

import { waitForApp } from "./app";

/** Locators and actions shared by the report specs. */

export type ReportKind = "summary" | "detailed" | "weekly";

/** The overall total of the current report, as the shell shows it. */
export const reportTotal = (page: Page) => page.getByTestId("report-total");

export async function openReport(page: Page, slug: string, kind: ReportKind, query = "") {
  await page.goto(`/w/${slug}/reports/${kind}${query ? `?${query}` : ""}`);
  await waitForApp(page);
  await expect(reportTotal(page)).toBeVisible();
}

/** Opens the range menu and picks a preset by its label ("Last week", "Custom…"). */
export async function setPreset(page: Page, label: string) {
  await page.getByRole("button", { name: /^Range:/ }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}

/** Opens a filter ("Projects", "Tags", …) and toggles one of its options. */
export async function toggleFilter(page: Page, filter: string, option: string) {
  await page.getByRole("button", { name: new RegExp(`^${filter}:`) }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await page.keyboard.press("Escape");
}

/** Sets the grouping slots in order ("Client", "Project", …); unset slots stay as they are. */
export async function setGroupBy(page: Page, labels: string[]) {
  for (const [i, label] of labels.entries()) {
    await page.getByRole("combobox", { name: `Group by ${i + 1}` }).click();
    await page.getByRole("option", { name: label, exact: true }).click();
  }
}

/** A row of the grouped table by its label cell. */
export const groupRow = (page: Page, label: string) =>
  page.getByRole("row").filter({ has: page.getByRole("cell", { name: label, exact: true }) });

/** The duration the tracker's week section shows ("Week total: 1:30:00" → "1:30:00"). */
export async function trackerWeekTotal(page: Page): Promise<string> {
  // The value sits next to the label; read their common parent.
  const text = await page
    .getByText(/^Week total/)
    .first()
    .locator("..")
    .textContent();
  const match = text?.match(/(\d+:\d{2}(?::\d{2})?|\d+\.\d{2})/);
  if (!match) throw new Error(`No week total in "${text}"`);
  return match[1]!;
}

/** A Detailed report row by the entry's description. */
export const detailedRow = (page: Page, description: string) =>
  page.getByRole("row", { name: `Entry ${description}`, exact: true });
