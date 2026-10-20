import { expect, test } from "./fixtures";
import { block, dragBlock, openCalendar, scrollToMinutes, SLOT_PX } from "./helpers/calendar";
import { createProjectViaUi } from "./helpers/catalog";
import { cell, dayLabel, typeCell } from "./helpers/timesheet";
import { addManualEntry, entry, pickProject, waitForSaves } from "./helpers/tracker";

/**
 * Phase 2 acceptance: one entry, three views. Each view shows the same
 * description, project, tag and time, and an edit in any view is seen in the
 * others.
 */
test("an entry edited in the timesheet changes in the tracker and the calendar", async ({
  page,
  freshUser,
  trackerPage,
}) => {
  const today = dayLabel(new Date(), freshUser.timezone);
  await createProjectViaUi(page, freshUser.slug, "Website");
  await trackerPage();
  await pickProject(page, "Website");
  await addManualEntry(page, { description: "Site work", start: "09:00", duration: "1" });

  // Timesheet: same entry, one hour.
  await page.goto(`/w/${freshUser.slug}/timesheet`);
  await expect(page.locator('[role="grid"][data-hydrated="true"]')).toBeVisible();
  await expect(cell(page, "Website · Site work", today)).toHaveValue("1:00:00");

  // Timesheet edit: two hours.
  await typeCell(page, "Website · Site work", today, "2");
  await expect(cell(page, "Website · Site work", today)).toHaveValue("2:00:00");
  await waitForSaves(page);

  // Tracker sees the longer entry.
  await trackerPage();
  const row = entry(page, "Site work");
  await expect(row.getByRole("textbox", { name: "Duration" })).toHaveValue("2:00:00");
  await expect(row.getByRole("textbox", { name: "End time" })).toHaveValue("11:00");
  await expect(row.getByRole("button", { name: /^Project:/ })).toHaveAccessibleName(
    "Project: Website",
  );

  // Calendar sees it too, and moves it to 13:00.
  await openCalendar(page, freshUser.slug, "day");
  await scrollToMinutes(page, 8 * 60);
  const b = block(page, "Site work, Website, 2:00:00");
  await expect(b).toHaveCSS("top", "576px"); // 09:00
  await dragBlock(page, b, 0, 4 * 4 * SLOT_PX);
  await waitForSaves(page);
  await expect(block(page, "Site work, Website, 2:00:00")).toHaveCSS("top", "832px"); // 13:00

  // The timesheet still sums two hours; the tracker shows the new start.
  await page.goto(`/w/${freshUser.slug}/timesheet`);
  await expect(page.locator('[role="grid"][data-hydrated="true"]')).toBeVisible();
  await expect(cell(page, "Website · Site work", today)).toHaveValue("2:00:00");
  await trackerPage();
  await expect(entry(page, "Site work").getByRole("textbox", { name: "Start time" })).toHaveValue(
    "13:00",
  );
});
