import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { rowAction } from "./helpers/catalog";
import { addManualEntry, entry, tagsButton } from "./helpers/tracker";

/** The Tags page (admins): create, rename, archive, delete, with usage counts. */

const tagRow = (page: Page, name: string) =>
  page.getByRole("row").filter({
    has: page.getByRole("cell", { name: new RegExp(`^${name}( Archived)?$`) }),
  });

async function createTagViaUi(page: Page, slug: string, name: string) {
  if (!page.url().includes(`/w/${slug}/tags`)) await page.goto(`/w/${slug}/tags`);
  await page.getByRole("button", { name: "New tag" }).click();
  const dialog = page.getByRole("dialog", { name: "New tag" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create tag" }).click();
  await expect(dialog).toBeHidden();
  await expect(tagRow(page, name)).toBeVisible();
}

/** Selects an existing tag in the timer bar. */
async function selectTag(page: Page, name: string) {
  await tagsButton(page).click();
  await page.getByRole("combobox", { name: "Search tags" }).fill(name);
  await page.getByRole("option", { name, exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(tagsButton(page)).toHaveAccessibleName(`Tags: ${name}`);
}

test.describe("tags", () => {
  test("create and rename a tag", async ({ page, freshUser }) => {
    await createTagViaUi(page, freshUser.slug, "design");
    await expect(
      tagRow(page, "design").getByRole("cell", { name: "0", exact: true }),
    ).toBeVisible();

    await rowAction(page, tagRow(page, "design"), "Rename");
    const dialog = page.getByRole("dialog", { name: "Rename tag" });
    await dialog.getByLabel("Name").fill("visual");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
    await expect(tagRow(page, "visual")).toBeVisible();
    await expect(tagRow(page, "design")).toHaveCount(0);
  });

  test("an archived tag stays on entries but cannot be added", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await createTagViaUi(page, freshUser.slug, "urgent");
    await trackerPage();
    await selectTag(page, "urgent");
    await addManualEntry(page, { description: "Tagged work", start: "00:05", duration: "1" });

    await page.goto(`/w/${freshUser.slug}/tags`);
    await rowAction(page, tagRow(page, "urgent"), "Archive");
    await expect(tagRow(page, "urgent")).toHaveCount(0);
    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Archived" }).click();
    await expect(tagRow(page, "urgent")).toContainText("Archived");

    await trackerPage();
    await expect(
      entry(page, "Tagged work").getByRole("button", { name: /^Tags:/ }),
    ).toHaveAccessibleName("Tags: urgent");
    await tagsButton(page).click();
    await page.getByRole("combobox", { name: "Search tags" }).fill("urgent");
    await expect(page.getByRole("option", { name: "urgent", exact: true })).toHaveCount(0);
  });

  test("delete a tag in use", async ({ page, freshUser, trackerPage }) => {
    await createTagViaUi(page, freshUser.slug, "review");
    await trackerPage();
    await selectTag(page, "review");
    await addManualEntry(page, { description: "Reviewed work", start: "00:05", duration: "1" });

    await page.goto(`/w/${freshUser.slug}/tags`);
    await expect(
      tagRow(page, "review").getByRole("cell", { name: "1", exact: true }),
    ).toBeVisible();
    await rowAction(page, tagRow(page, "review"), "Delete");
    const confirm = page.getByRole("alertdialog", { name: "Delete tag?" });
    await expect(confirm).toContainText("1 entry");
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(confirm).toBeHidden();
    await expect(tagRow(page, "review")).toHaveCount(0);

    await trackerPage();
    await expect(
      entry(page, "Reviewed work").getByRole("button", { name: /^Tags:/ }),
    ).toHaveAccessibleName("Tags: none");
  });
});
