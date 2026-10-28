import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { waitForApp } from "./helpers/app";
import { createProjectViaUi, projectRow, rowAction } from "./helpers/catalog";
import { setRateIn } from "./helpers/rates";
import { detailedRow, openReport } from "./helpers/reports";
import {
  addManualEntry,
  createTag,
  entry,
  pickProject,
  timer,
  today,
  waitForSaves,
} from "./helpers/tracker";

/** Phase 4b power features: bulk edit, split, favourites, templates, the Audit tab. */

/** Picks an existing project in any ProjectPicker inside `scope`. */
async function pickProjectIn(page: Page, scope: ReturnType<Page["getByRole"]>, name: string) {
  await scope.getByRole("button", { name: /^Project:/ }).click();
  await page.getByRole("combobox", { name: "Search projects" }).fill(name);
  await page.getByRole("option", { name, exact: true }).click();
}

test.describe("power features", () => {
  test("bulk edit moves selected entries to a project and tags them", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await createProjectViaUi(page, freshUser.slug, "Alpha");
    await trackerPage();
    await addManualEntry(page, { description: "Row A", start: "00:05", duration: "0.25" });
    await addManualEntry(page, { description: "Row B", start: "00:20", duration: "0.25" });
    await addManualEntry(page, { description: "Row C", start: "00:35", duration: "0.25" });

    await page.getByRole("checkbox", { name: "Select all entries for Today" }).check();
    await page.getByRole("toolbar", { name: "Bulk actions" }).getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit 3 entries" });
    await dialog.getByRole("checkbox", { name: "Change project" }).check();
    await pickProjectIn(page, dialog, "Alpha");
    await dialog.getByRole("checkbox", { name: "Change tags" }).check();
    await dialog.getByRole("combobox", { name: "Tag mode" }).click();
    await page.getByRole("option", { name: "Replace", exact: true }).click();
    await dialog.getByRole("button", { name: /^Tags:/ }).click();
    await page.getByRole("combobox", { name: "Search tags" }).fill("urgent");
    await page.getByRole("option", { name: "Create tag “urgent”" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog.getByRole("button", { name: "Tags: urgent" })).toBeVisible();
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toBeHidden();
    await waitForSaves(page);

    for (const description of ["Row A", "Row B", "Row C"]) {
      const row = entry(page, description);
      await expect(row.getByRole("button", { name: "Project: Alpha" })).toBeVisible();
      await expect(row.getByRole("button", { name: "Tags: urgent" })).toBeVisible();
    }
  });

  test("split an entry at a time", async ({ page, trackerPage }) => {
    await trackerPage();
    await addManualEntry(page, { description: "Long one", start: "00:10", duration: "2" });
    await rowAction(page, entry(page, "Long one"), "Split…");
    const dialog = page.getByRole("dialog", { name: "Split entry" });
    await dialog.getByRole("textbox", { name: "Split at" }).fill("01:10");
    await dialog.getByRole("button", { name: "Split" }).click();
    await expect(dialog).toBeHidden();
    await waitForSaves(page);

    // Two identical halves collapse into a group; expanded, each lasts an hour.
    const group = today(page).getByRole("group", { name: "Group Long one", exact: true });
    await expect(group.getByRole("button", { name: "2 entries" })).toBeVisible();
    await group.getByRole("button", { name: "2 entries" }).click();
    const halves = entry(page, "Long one");
    await expect(halves).toHaveCount(2);
    await expect(halves.nth(0).getByRole("textbox", { name: "Duration" })).toHaveValue("1:00:00");
    await expect(halves.nth(1).getByRole("textbox", { name: "Duration" })).toHaveValue("1:00:00");
  });

  test("pin an entry as a favourite and start it", async ({ page, freshUser, trackerPage }) => {
    await createProjectViaUi(page, freshUser.slug, "Alpha");
    await trackerPage();
    await pickProject(page, "Alpha");
    await createTag(page, "urgent");
    await addManualEntry(page, { description: "Pinned work", start: "00:05", duration: "0.5" });
    await rowAction(page, entry(page, "Pinned work"), "Pin as favourite");

    const strip = page.getByRole("region", { name: "Favourites" });
    await expect(strip).toContainText("Pinned work");
    await strip.getByRole("button", { name: "Start Pinned work" }).click();
    await expect(timer(page).getByRole("button", { name: "Stop" })).toBeVisible();
    await expect(timer(page).getByRole("combobox", { name: "Description" })).toHaveValue(
      "Pinned work",
    );
    await expect(timer(page).getByRole("button", { name: "Project: Alpha" })).toBeVisible();
    await expect(timer(page).getByRole("button", { name: "Tags: urgent" })).toBeVisible();
    await timer(page).getByRole("button", { name: "Stop" }).click();
    await expect(timer(page).getByRole("button", { name: "Start" })).toBeVisible();

    await strip.getByRole("button", { name: "Unpin Pinned work" }).click();
    await expect(page.getByRole("region", { name: "Favourites" })).toHaveCount(0);
  });

  test("a favourite on an archived project is disabled", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await createProjectViaUi(page, freshUser.slug, "Old");
    await trackerPage();
    await pickProject(page, "Old");
    await addManualEntry(page, { description: "Legacy", start: "00:05", duration: "0.5" });
    await rowAction(page, entry(page, "Legacy"), "Pin as favourite");
    await expect(page.getByRole("region", { name: "Favourites" })).toContainText("Legacy");

    await page.goto(`/w/${freshUser.slug}/projects`);
    await waitForApp(page);
    await page.getByRole("checkbox", { name: "Select Old" }).check();
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(projectRow(page, "Old")).toHaveCount(0);

    await trackerPage();
    const start = page
      .getByRole("region", { name: "Favourites" })
      .getByRole("button", { name: "Start Legacy" });
    await expect(start).toBeDisabled();
    await expect(start).toHaveAttribute("title", "This project is archived.");
  });

  test("start a project from a template", async ({ page, freshUser }) => {
    await createProjectViaUi(page, freshUser.slug, "Base");
    await page.getByRole("link", { name: "Base" }).click();
    await page.getByRole("button", { name: "Add task" }).click();
    const taskDialog = page.getByRole("dialog", { name: "New task" });
    await taskDialog.getByLabel("Name").fill("Setup");
    await taskDialog.getByRole("button", { name: "Add task" }).click();
    await expect(page.getByRole("row", { name: /Setup/ })).toBeVisible();
    await page.getByRole("tab", { name: "Rates" }).click();
    await setRateIn(
      page,
      page.getByRole("region", { name: "Project rate" }).getByRole("button", { name: "Change rate" }),
      { amount: "80", apply: "New entries only" },
    );

    await page.goto(`/w/${freshUser.slug}/projects`);
    await waitForApp(page);
    await rowAction(page, projectRow(page, "Base"), "Save as template");
    await expect(page.getByText(/saved as the template/)).toBeVisible();
    await page.getByRole("combobox", { name: "Kind" }).click();
    await page.getByRole("option", { name: "Templates", exact: true }).click();
    await expect(projectRow(page, "Base template")).toBeVisible();

    await page.getByRole("button", { name: "New project" }).click();
    const dialog = page.getByRole("dialog", { name: "New project" });
    await dialog.getByRole("combobox", { name: "Start from template" }).click();
    await page.getByRole("option", { name: "Base template", exact: true }).click();
    await dialog.getByLabel("Name").fill("Client X");
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("combobox", { name: "Kind" }).click();
    await page.getByRole("option", { name: "Projects", exact: true }).click();
    await page.getByRole("link", { name: "Client X" }).click();
    await expect(page.getByRole("row", { name: /Setup/ })).toBeVisible();
    await page.getByRole("tab", { name: "Rates" }).click();
    await expect(page.getByRole("region", { name: "Project rate" })).toContainText("$80.00");

    // The template itself takes no time: the picker does not list it.
    await page.goto(`/w/${freshUser.slug}/tracker`);
    await expect(page.locator('section[aria-label="Timer"][data-hydrated="true"]')).toBeVisible();
    await timer(page).getByRole("button", { name: /^Project:/ }).click();
    await page.getByRole("combobox", { name: "Search projects" }).fill("Base");
    await expect(page.getByRole("option", { name: "Client X", exact: true })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "Base template", exact: true })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "Base", exact: true })).toBeVisible();
  });

  test("the Audit tab lists problem entries and fixes them", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await createProjectViaUi(page, freshUser.slug, "Alpha");
    await trackerPage();
    await addManualEntry(page, { description: "Lost", start: "00:05", duration: "1" });
    await pickProject(page, "Alpha");
    await addManualEntry(page, { description: "Long", start: "01:10", duration: "11" });
    await pickProject(page, "Alpha");
    await addManualEntry(page, { description: "Fine", start: "12:15", duration: "1" });

    await openReport(page, freshUser.slug, "summary");
    await page.getByRole("link", { name: "Audit" }).click();
    await expect(page).toHaveURL(/audit=noProject/);
    await expect(detailedRow(page, "Lost")).toBeVisible();
    await expect(detailedRow(page, "Long")).toBeVisible();
    await expect(detailedRow(page, "Fine")).toHaveCount(0);

    // Fix the lost entry where it was found.
    await detailedRow(page, "Lost").getByRole("checkbox", { name: "Select Lost" }).check();
    await page.getByRole("toolbar", { name: "Selected entries" }).getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit 1 entry" });
    await dialog.getByRole("checkbox", { name: "Change project" }).check();
    await pickProjectIn(page, dialog, "Alpha");
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toBeHidden();
    await expect(detailedRow(page, "Lost")).toHaveCount(0);
    await expect(detailedRow(page, "Long")).toBeVisible();
  });
});
