import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { createProjectViaUi } from "./helpers/catalog";
import { addManualEntry, entry, waitForSaves } from "./helpers/tracker";

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
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toBeHidden();
    await waitForSaves(page);

    for (const description of ["Row A", "Row B", "Row C"]) {
      const row = entry(page, description);
      await expect(row.getByRole("button", { name: "Project: Alpha" })).toBeVisible();
      await expect(row.getByRole("button", { name: "Tags: urgent" })).toBeVisible();
    }
  });
});
