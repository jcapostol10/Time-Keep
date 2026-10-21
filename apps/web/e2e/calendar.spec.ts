import { expect, test } from "./fixtures";
import {
  block,
  calendar,
  dayColumn,
  dayPoint,
  drag,
  dragBlock,
  openCalendar,
  scrollToMinutes,
  SLOT_PX,
} from "./helpers/calendar";
import { createProjectViaUi } from "./helpers/catalog";
import { dateKey } from "./helpers/timesheet";
import { addManualEntry, entry, pickProject, timer, waitForSaves } from "./helpers/tracker";

/** Day and week views: entries as blocks, drag to create, move and resize. */

test.describe("calendar", () => {
  test("entries show as blocks in week and day view", async ({ page, freshUser, trackerPage }) => {
    await createProjectViaUi(page, freshUser.slug, "Website");
    await trackerPage();
    await pickProject(page, "Website");
    await addManualEntry(page, { description: "Site work", start: "09:00", duration: "1" });

    await openCalendar(page, freshUser.slug, "week");
    const b = block(page, "Site work, Website, 1:00:00");
    await expect(b).toBeVisible();
    await expect(b).toHaveAttribute("data-color", /^#[0-9a-f]{6}$/i);
    await expect(page.locator("[data-day]")).toHaveCount(7);

    await page
      .getByRole("radiogroup", { name: "View" })
      .getByRole("radio", { name: "Day" })
      .click();
    await expect(page).toHaveURL(/view=day/);
    await expect(block(page, "Site work, Website, 1:00:00")).toBeVisible();
    await expect(page.locator("[data-day]")).toHaveCount(1);
  });

  test("drag to create an entry", async ({ page, freshUser, trackerPage }) => {
    const today = dateKey(new Date(), freshUser.timezone);
    await openCalendar(page, freshUser.slug, "week");
    await scrollToMinutes(page, 8 * 60);
    await drag(page, await dayPoint(page, today, 9 * 60), await dayPoint(page, today, 10 * 60));

    const dialog = page.getByRole("dialog", { name: "New entry" });
    await expect(dialog.getByRole("textbox", { name: "Start time" })).toHaveValue("09:00");
    await expect(dialog.getByRole("textbox", { name: "End time" })).toHaveValue("10:00");
    await dialog.getByRole("combobox", { name: "Description" }).fill("Dragged");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(dialog).toBeHidden();
    await expect(block(page, "Dragged, No project, 1:00:00")).toBeVisible();
    await waitForSaves(page);

    await trackerPage();
    const row = entry(page, "Dragged");
    await expect(row.getByRole("textbox", { name: "Start time" })).toHaveValue("09:00");
    await expect(row.getByRole("textbox", { name: "Duration" })).toHaveValue("1:00:00");
  });

  test("move and resize an entry by dragging", async ({ page, freshUser, trackerPage }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Site work", start: "09:00", duration: "1" });
    await openCalendar(page, freshUser.slug, "day");
    await scrollToMinutes(page, 8 * 60);

    // Four hours down: 09:00 → 13:00.
    await dragBlock(page, block(page, "Site work, No project, 1:00:00"), 0, 4 * 4 * SLOT_PX);
    await waitForSaves(page);
    // 13:00 is 780 minutes: 832px down the column.
    await expect(block(page, "Site work, No project, 1:00:00")).toHaveCSS("top", "832px");

    // Pull the bottom edge down by half an hour: 14:00 → 14:30.
    const handle = block(page, "Site work, No project, 1:00:00").locator('[data-resize="end"]');
    const box = await handle.boundingBox();
    if (!box) throw new Error("no end handle");
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await drag(page, from, { x: from.x, y: from.y + 2 * SLOT_PX });
    await waitForSaves(page);
    await expect(block(page, "Site work, No project, 1:30:00")).toBeVisible();

    await trackerPage();
    const row = entry(page, "Site work");
    await expect(row.getByRole("textbox", { name: "Start time" })).toHaveValue("13:00");
    await expect(row.getByRole("textbox", { name: "End time" })).toHaveValue("14:30");
  });

  test("click a block to edit it", async ({ page, freshUser, trackerPage }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Site work", start: "09:00", duration: "1" });
    await openCalendar(page, freshUser.slug, "day");
    await scrollToMinutes(page, 8 * 60);

    await block(page, "Site work, No project, 1:00:00").click();
    const dialog = page.getByRole("dialog", { name: "Edit entry" });
    await dialog.getByRole("combobox", { name: "Description" }).fill("Edited work");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(block(page, "Edited work, No project, 1:00:00")).toBeVisible();

    await block(page, "Edited work, No project, 1:00:00").click();
    await page
      .getByRole("dialog", { name: "Edit entry" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(block(page, /Edited work/)).toHaveCount(0);
  });

  test("the running timer shows as a block", async ({ page, freshUser, trackerPage }) => {
    await trackerPage();
    await timer(page).getByRole("combobox", { name: "Description" }).fill("Live work");
    await timer(page).getByRole("button", { name: "Start" }).click();
    await expect(timer(page).getByRole("button", { name: "Stop" })).toBeVisible();

    await openCalendar(page, freshUser.slug, "day");
    const running = calendar(page).locator("[data-running]");
    await expect(running).toBeVisible();
    await expect(running).toContainText("Live work");
    await expect(running).toContainText("Running");
  });

  test("overlapping entries sit side by side", async ({ page, freshUser, trackerPage }) => {
    await trackerPage();
    await addManualEntry(page, { description: "A", start: "09:00", duration: "1" });
    await addManualEntry(page, { description: "B", start: "09:30", duration: "1" });
    await openCalendar(page, freshUser.slug, "day");

    const a = block(page, "A, No project, 1:00:00");
    const b = block(page, "B, No project, 1:00:00");
    await expect(a).toHaveAttribute("data-columns", "2");
    await expect(b).toHaveAttribute("data-columns", "2");
    await expect(a).toHaveAttribute("data-column", "0");
    await expect(b).toHaveAttribute("data-column", "1");
  });

  test("drags past the edges of the day stay inside it", async ({ page, freshUser }) => {
    const today = dateKey(new Date(), freshUser.timezone);
    await openCalendar(page, freshUser.slug, "day");
    const dialog = page.getByRole("dialog", { name: "New entry" });

    // Up past 00:00: from 01:00 to well above the grid.
    await scrollToMinutes(page, 0);
    const top = await dayPoint(page, today, 60);
    await drag(page, top, { x: top.x, y: Math.max(0, top.y - 200) });
    await expect(dialog.getByRole("textbox", { name: "Start time" })).toHaveValue("00:00");
    await expect(dialog.getByRole("textbox", { name: "End time" })).toHaveValue("01:00");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Down past 24:00: from 23:00 to well below the column.
    await scrollToMinutes(page, 23 * 60);
    const bottom = await dayPoint(page, today, 23 * 60);
    await drag(page, bottom, { x: bottom.x, y: bottom.y + 300 });
    await expect(dialog.getByRole("textbox", { name: "Start time" })).toHaveValue("23:00");
    await expect(dialog.getByRole("textbox", { name: "End time" })).toHaveValue("00:00");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Sideways out of the column (over the sidebar) keeps the day.
    await scrollToMinutes(page, 8 * 60);
    const from = await dayPoint(page, today, 9 * 60);
    const to = await dayPoint(page, today, 10 * 60);
    await drag(page, from, { x: 5, y: to.y });
    await expect(dialog.getByRole("textbox", { name: "Start time" })).toHaveValue("09:00");
    await expect(dialog.getByRole("textbox", { name: "End time" })).toHaveValue("10:00");
    await page.keyboard.press("Escape");
  });

  test("a block dropped where it no longer fits the day is pulled back inside it", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Late", start: "20:00", duration: "1" });
    await openCalendar(page, freshUser.slug, "day");
    await scrollToMinutes(page, 20 * 60);
    // Dropped with the pointer at 23:45 (grabbed at its middle, so a 23:15 start),
    // where an hour no longer fits: the latest start that does is 23:00.
    await dragBlock(page, block(page, "Late, No project, 1:00:00"), 0, 13 * SLOT_PX);
    await waitForSaves(page);
    await expect(block(page, "Late, No project, 1:00:00")).toHaveCSS("top", `${23 * 4 * SLOT_PX}px`);

    await trackerPage();
    const row = entry(page, "Late");
    await expect(row.getByRole("textbox", { name: "Start time" })).toHaveValue("23:00");
    await expect(row.getByRole("textbox", { name: "End time" })).toHaveValue("00:00");
  });

  test("the current time line shows on today", async ({ page, freshUser }) => {
    const today = dateKey(new Date(), freshUser.timezone);
    await openCalendar(page, freshUser.slug, "week");
    await expect(dayColumn(page, today).getByTestId("now-line")).toBeVisible();
    await expect(page.getByTestId("now-line")).toHaveCount(1);
  });

  test("navigate days and weeks", async ({ page, freshUser }) => {
    await openCalendar(page, freshUser.slug, "week");
    const label = page.getByTestId("period-label");
    const thisWeek = await label.innerText();
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(label).not.toHaveText(thisWeek);
    await expect(page).toHaveURL(/date=\d{4}-\d{2}-\d{2}/);
    await page.getByRole("button", { name: "Today" }).click();
    await expect(label).toHaveText(thisWeek);

    await page
      .getByRole("radiogroup", { name: "View" })
      .getByRole("radio", { name: "Day" })
      .click();
    await expect(page).toHaveURL(/view=day/);
    await expect(page.locator("[data-day]")).toHaveCount(1);
    const today = await label.innerText();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(label).not.toHaveText(today);
    await expect(
      dayColumn(page, dateKey(new Date(Date.now() + 86_400_000), freshUser.timezone)),
    ).toBeVisible();
  });
});
