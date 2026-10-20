import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { createProjectViaUi } from "./helpers/catalog";
import {
  cell,
  dateKey,
  dayLabel,
  daysAgo,
  dayTotal,
  grid,
  rowTotal,
  typeCell,
} from "./helpers/timesheet";
import {
  addManualEntry,
  addManualEntryOn,
  entry,
  pickProject,
  waitForSaves,
} from "./helpers/tracker";

/** The weekly grid: one row per project/task/description, one column per day. */

async function openTimesheet(page: Page, slug: string) {
  await page.goto(`/w/${slug}/timesheet`);
  await expect(page.locator('[role="grid"][data-hydrated="true"]')).toBeVisible();
}

async function addRow(page: Page, opts: { project?: string; description?: string }) {
  await page.getByRole("button", { name: "Add new row" }).click();
  const dialog = page.getByRole("dialog", { name: "Add row" });
  if (opts.project) {
    await dialog.getByRole("button", { name: /^Project:/ }).click();
    await page.getByRole("combobox", { name: "Search projects" }).fill(opts.project);
    await page.getByRole("option", { name: opts.project, exact: true }).click();
  }
  if (opts.description) await dialog.getByLabel("Description").fill(opts.description);
  await dialog.getByRole("button", { name: "Add row" }).click();
  await expect(dialog).toBeHidden();
}

test.describe("timesheet", () => {
  test("the week's entries show as rows with totals", async ({ page, freshUser, trackerPage }) => {
    const today = dayLabel(new Date(), freshUser.timezone);
    await createProjectViaUi(page, freshUser.slug, "Website");
    await trackerPage();
    await pickProject(page, "Website");
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await addManualEntry(page, { description: "Email", start: "02:05", duration: "0.5" });

    await openTimesheet(page, freshUser.slug);
    await expect(cell(page, "Website · Site work", today)).toHaveValue("1:00:00");
    await expect(cell(page, "No project · Email", today)).toHaveValue("0:30:00");
    await expect(rowTotal(page, "Website · Site work")).toHaveText("1:00:00");
    await expect(dayTotal(page, today)).toHaveText("1:30:00");
    await expect(page.getByTestId("grand-total")).toHaveText("1:30:00");
  });

  test("typing in an empty cell creates an entry at 09:00", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    const today = dayLabel(new Date(), freshUser.timezone);
    await createProjectViaUi(page, freshUser.slug, "Website");
    await openTimesheet(page, freshUser.slug);
    await addRow(page, { project: "Website", description: "Grid work" });
    await typeCell(page, "Website · Grid work", today, "1.5");
    await expect(cell(page, "Website · Grid work", today)).toHaveValue("1:30:00");
    await waitForSaves(page);

    await trackerPage();
    const row = entry(page, "Grid work");
    await expect(row.getByRole("textbox", { name: "Start time" })).toHaveValue("09:00");
    await expect(row.getByRole("textbox", { name: "Duration" })).toHaveValue("1:30:00");
    await expect(row.getByRole("button", { name: /^Project:/ })).toHaveAccessibleName(
      "Project: Website",
    );
  });

  test("a second cell on the same day starts after the day's last entry", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    const today = dayLabel(new Date(), freshUser.timezone);
    await trackerPage();
    await addManualEntry(page, { description: "First", start: "00:05", duration: "1" });
    await openTimesheet(page, freshUser.slug);
    await addRow(page, { description: "Second" });
    await typeCell(page, "No project · Second", today, "0.5");
    await expect(cell(page, "No project · Second", today)).toHaveValue("0:30:00");
    await waitForSaves(page);

    await trackerPage();
    await expect(entry(page, "Second").getByRole("textbox", { name: "Start time" })).toHaveValue(
      "01:05",
    );
  });

  test("increasing a cell extends its entry", async ({ page, freshUser, trackerPage }) => {
    const today = dayLabel(new Date(), freshUser.timezone);
    await trackerPage();
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await openTimesheet(page, freshUser.slug);
    await typeCell(page, "No project · Site work", today, "2");
    await expect(cell(page, "No project · Site work", today)).toHaveValue("2:00:00");
    await waitForSaves(page);

    await trackerPage();
    await expect(entry(page, "Site work").getByRole("textbox", { name: "Duration" })).toHaveValue(
      "2:00:00",
    );
  });

  test("lowering a cell below its other entries opens the list", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    const today = dayLabel(new Date(), freshUser.timezone);
    await trackerPage();
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await addManualEntry(page, { description: "Site work", start: "02:05", duration: "0.5" });
    await openTimesheet(page, freshUser.slug);
    await expect(cell(page, "No project · Site work", today)).toHaveValue("1:30:00");

    await typeCell(page, "No project · Site work", today, "0.75");
    const dialog = page.getByRole("dialog", { name: "Entries in this cell" });
    await expect(dialog.getByRole("textbox", { name: "Duration" })).toHaveCount(2);
    const first = dialog.getByRole("textbox", { name: "Duration" }).first();
    await first.fill("0.25");
    await first.press("Enter");
    await expect(first).toHaveValue("0:15:00");
    await page.keyboard.press("Escape");
    await expect(cell(page, "No project · Site work", today)).toHaveValue("0:45:00");
  });

  test("clearing a cell deletes its entries", async ({ page, freshUser, trackerPage }) => {
    const today = dayLabel(new Date(), freshUser.timezone);
    await trackerPage();
    await addManualEntry(page, { description: "Gone", start: "00:05", duration: "1" });
    await openTimesheet(page, freshUser.slug);
    await typeCell(page, "No project · Gone", today, "");
    // The row only existed because of that entry, so it goes with it.
    await expect(cell(page, "No project · Gone", today)).toHaveCount(0);
    await waitForSaves(page);

    await trackerPage();
    await expect(entry(page, "Gone")).toHaveCount(0);
  });

  test("invalid input reverts the cell", async ({ page, freshUser, trackerPage }) => {
    const today = dayLabel(new Date(), freshUser.timezone);
    await trackerPage();
    await addManualEntry(page, { description: "Site work", start: "00:05", duration: "1" });
    await openTimesheet(page, freshUser.slug);

    await typeCell(page, "No project · Site work", today, "abc");
    await expect(page.getByText(/Enter a duration/)).toBeVisible();
    await expect(cell(page, "No project · Site work", today)).toHaveValue("1:00:00");
    await typeCell(page, "No project · Site work", today, "1000h");
    await expect(cell(page, "No project · Site work", today)).toHaveValue("1:00:00");
  });

  test("add a new row", async ({ page, freshUser }) => {
    const today = dayLabel(new Date(), freshUser.timezone);
    await createProjectViaUi(page, freshUser.slug, "Website");
    await openTimesheet(page, freshUser.slug);
    await addRow(page, { project: "Website" });
    await expect(cell(page, "Website", today)).toHaveValue("");
    await expect(rowTotal(page, "Website")).toHaveText("0:00:00");
  });

  test("copy last week with time", async ({ page, freshUser, trackerPage }) => {
    const lastWeekDay = daysAgo(7);
    const todayLabel = dayLabel(new Date(), freshUser.timezone);
    await trackerPage();
    await addManualEntryOn(page, {
      description: "Weekly sync",
      date: dateKey(lastWeekDay, freshUser.timezone),
      start: "10:00",
      duration: "0.5",
    });

    await openTimesheet(page, freshUser.slug);
    await page.getByRole("button", { name: "Copy last week" }).click();
    const dialog = page.getByRole("dialog", { name: "Copy last week" });
    await dialog.getByRole("radio", { name: "Rows and time" }).click();
    await dialog.getByRole("button", { name: "Copy" }).click();
    await expect(dialog).toBeHidden();
    await expect(cell(page, "No project · Weekly sync", todayLabel)).toHaveValue("0:30:00");

    await trackerPage();
    await expect(
      entry(page, "Weekly sync").getByRole("textbox", { name: "Start time" }),
    ).toHaveValue("10:00");
  });

  test("save and apply a template", async ({ page, freshUser }) => {
    const today = dayLabel(new Date(), freshUser.timezone);
    await openTimesheet(page, freshUser.slug);
    await addRow(page, { description: "Planning" });
    await addRow(page, { description: "Support" });
    await page.getByRole("button", { name: "Templates" }).click();
    await page.getByRole("menuitem", { name: "Save as template…" }).click();
    const dialog = page.getByRole("dialog", { name: "Save as template" });
    await dialog.getByLabel("Name").fill("Usual week");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await expect(page.locator('[role="grid"][data-hydrated="true"]')).toBeVisible();
    await expect(cell(page, "No project · Planning", today)).toHaveCount(0);
    await page.getByRole("button", { name: "Templates" }).click();
    await page.getByRole("menuitem", { name: "Apply Usual week" }).click();
    await expect(cell(page, "No project · Planning", today)).toBeVisible();
    await expect(cell(page, "No project · Support", today)).toBeVisible();
  });

  test("move between cells with the keyboard", async ({ page, freshUser }) => {
    const today = dayLabel(new Date(), freshUser.timezone);
    const tomorrow = dayLabel(daysAgo(-1), freshUser.timezone);
    await openTimesheet(page, freshUser.slug);
    await addRow(page, { description: "A" });
    await addRow(page, { description: "B" });
    const a = cell(page, "No project · A", today);
    await a.focus();
    await page.keyboard.press("ArrowDown");
    await expect(cell(page, "No project · B", today)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(a).toBeFocused();
    // Within the week, the next day is to the right; at the week's end it stays.
    const todayIndex = (await grid(page).locator("thead [data-day]").allInnerTexts()).findIndex(
      (t) => t.startsWith(today),
    );
    await page.keyboard.press("ArrowRight");
    if (todayIndex < 6) await expect(cell(page, "No project · A", tomorrow)).toBeFocused();
    else await expect(a).toBeFocused();
  });

  test("navigate weeks", async ({ page, freshUser }) => {
    await openTimesheet(page, freshUser.slug);
    const label = page.getByTestId("period-label");
    const thisWeek = await label.innerText();
    await page.getByRole("button", { name: "Previous week" }).click();
    await expect(label).not.toHaveText(thisWeek);
    await expect(page).toHaveURL(/week=\d{4}-\d{2}-\d{2}/);
    await page.getByRole("button", { name: "Today" }).click();
    await expect(label).toHaveText(thisWeek);
  });
});
