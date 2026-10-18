import { expect, type Page } from "@playwright/test";

/** Locators and actions shared by the tracker specs. */

export const timer = (page: Page) => page.getByRole("region", { name: "Timer" });
export const today = (page: Page) => page.getByRole("region", { name: "Today" });
export const entry = (page: Page, description: string) =>
  today(page).getByRole("group", { name: `Entry ${description}`, exact: true });

/** Waits until every save has reached the server (the UI shows changes optimistically). */
export async function waitForSaves(page: Page) {
  await expect(page.locator('[data-saving="false"]')).toHaveCount(1);
}

/**
 * Adds a stopped entry for today through Manual mode, then switches back to
 * Timer mode. Use early, explicit start times (00:05, 00:10, …) so the list
 * order never depends on when the test runs.
 */
export async function addManualEntry(
  page: Page,
  opts: { description: string; start: string; duration: string },
) {
  await timer(page).getByRole("button", { name: "Manual mode" }).click();
  await timer(page).getByRole("combobox", { name: "Description" }).fill(opts.description);
  const start = timer(page).getByRole("textbox", { name: "Start time" });
  await start.fill(opts.start);
  await start.press("Tab");
  const duration = timer(page).getByRole("textbox", { name: "Duration" });
  await duration.fill(opts.duration);
  await duration.press("Tab");
  await timer(page).getByRole("button", { name: "Add" }).click();
  await expect(entry(page, opts.description).first()).toBeVisible();
  await waitForSaves(page);
  await timer(page).getByRole("button", { name: "Timer mode" }).click();
}
