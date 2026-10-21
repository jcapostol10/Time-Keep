import { expect, type Page } from "@playwright/test";

/** Locators and actions shared by the tracker specs. */

export const timer = (page: Page) => page.getByRole("region", { name: "Timer" });
export const today = (page: Page) => page.getByRole("region", { name: "Today" });
export const entry = (page: Page, description: string) =>
  today(page).getByRole("group", { name: `Entry ${description}`, exact: true });
/** The entry's row, or the group row it collapsed into next to an identical neighbour. */
export const entryOrGroup = (page: Page, description: string) =>
  entry(page, description).or(
    today(page).getByRole("group", { name: `Group ${description}`, exact: true }),
  );

/**
 * The bar clears its draft only once the server has accepted a manual entry,
 * and the row is in the list by then. Waiting on the row alone is not enough:
 * an earlier entry with the same description already shows one, and two of
 * them collapse into a group row.
 */
async function waitForManualAdd(page: Page) {
  await expect(timer(page).getByRole("combobox", { name: "Description" })).toHaveValue("");
}

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
  await waitForManualAdd(page);
  await expect(entryOrGroup(page, opts.description).first()).toBeVisible();
  await waitForSaves(page);
  await timer(page).getByRole("button", { name: "Timer mode" }).click();
}

export const projectButton = (page: Page) => timer(page).getByRole("button", { name: /^Project:/ });
export const tagsButton = (page: Page) => timer(page).getByRole("button", { name: /^Tags:/ });

/** Creates a project from the timer bar's picker and selects it. */
export async function createProject(page: Page, name: string) {
  await projectButton(page).click();
  await page.getByRole("combobox", { name: "Search projects" }).fill(name);
  await page.getByRole("option", { name: `Create project “${name}”` }).click();
  await expect(projectButton(page)).toHaveAccessibleName(`Project: ${name}`);
}

/** Creates a tag from the timer bar's picker, selects it and closes the picker. */
export async function createTag(page: Page, name: string) {
  await tagsButton(page).click();
  await page.getByRole("combobox", { name: "Search tags" }).fill(name);
  await page.getByRole("option", { name: `Create tag “${name}”` }).click();
  await page.keyboard.press("Escape");
}

/** Runs the timer for just over a second with the bar's current details. */
export async function runTimer(page: Page, description: string) {
  await timer(page).getByRole("combobox", { name: "Description" }).fill(description);
  await timer(page).getByRole("button", { name: "Start" }).click();
  await expect(timer(page).getByRole("button", { name: "Stop" })).toBeVisible();
  await page.waitForTimeout(1_100);
  await timer(page).getByRole("button", { name: "Stop" }).click();
  await expect(entry(page, description)).toBeVisible();
  await waitForSaves(page);
}

/** Picks an existing project in the timer bar. */
export async function pickProject(page: Page, name: string) {
  await projectButton(page).click();
  await page.getByRole("combobox", { name: "Search projects" }).fill(name);
  await page.getByRole("option", { name, exact: true }).click();
  await expect(projectButton(page)).toHaveAccessibleName(`Project: ${name}`);
}

/** Picks a task (and so its project) in the timer bar. */
export async function pickTask(page: Page, project: string, task: string) {
  await projectButton(page).click();
  await page.getByRole("combobox", { name: "Search projects" }).fill(task);
  await page.getByRole("option", { name: `${project} › ${task}`, exact: true }).click();
  await expect(projectButton(page)).toHaveAccessibleName(`Project: ${project} › ${task}`);
}

/** Like addManualEntry, on a given local date (YYYY-MM-DD). */
export async function addManualEntryOn(
  page: Page,
  opts: { description: string; date: string; start: string; duration: string },
) {
  await timer(page).getByRole("button", { name: "Manual mode" }).click();
  await timer(page).getByRole("combobox", { name: "Description" }).fill(opts.description);
  await timer(page).getByRole("textbox", { name: "Date" }).fill(opts.date);
  const start = timer(page).getByRole("textbox", { name: "Start time" });
  await start.fill(opts.start);
  await start.press("Tab");
  const duration = timer(page).getByRole("textbox", { name: "Duration" });
  await duration.fill(opts.duration);
  await duration.press("Tab");
  await timer(page).getByRole("button", { name: "Add" }).click();
  await waitForManualAdd(page);
  await waitForSaves(page);
  await timer(page).getByRole("button", { name: "Timer mode" }).click();
}
