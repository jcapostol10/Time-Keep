import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addTeammate } from "./helpers/team";
import { entry, entryOrGroup } from "./helpers/tracker";

/**
 * Importing time entries from a CSV (Phase 4b): columns matched by header,
 * every row checked first, then the ready ones written through the entry
 * service. The email column follows the permission to add time for others.
 */

/** Today's date in `timezone`, the zone the dialog reads the file's times in. */
function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Opens the dialog, uploads `csv` and runs the check. */
async function checkImport(page: Page, csv: string) {
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import time entries" });
  await dialog.getByLabel("CSV file").setInputFiles({
    name: "entries.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });
  await dialog.getByRole("button", { name: "Check" }).click();
  const check = dialog.getByRole("region", { name: "Import check" });
  await expect(check).toBeVisible();
  return { dialog, check };
}

test.describe("import", () => {
  test("import entries from a CSV: check, then import", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await trackerPage();
    const date = todayIn(freshUser.timezone);
    const csv = [
      "Date,Start,End,Description,Project,Tags,Billable",
      `${date},00:05,01:05,Imported one,Alpha,urgent,yes`,
      `${date},01:10,02:10,Imported two,Alpha,,no`,
      `${date},02:15,03:15,Imported three,,,`,
      `${date},03:20,oops,Broken,,,`,
    ].join("\n");
    const { dialog, check } = await checkImport(page, csv);
    await expect(check).toContainText("3 entries ready, 1 with errors");
    await expect(check).toContainText("Will create: 1 project, 1 tag");
    await expect(check).toContainText("Line 5: invalid end time");

    await dialog.getByRole("button", { name: "Import 3 entries" }).click();
    await expect(dialog).toBeHidden();
    await expect(entryOrGroup(page, "Imported one")).toBeVisible();
    await expect(entryOrGroup(page, "Imported two")).toBeVisible();
    await expect(entryOrGroup(page, "Imported three")).toBeVisible();
    await expect(
      entry(page, "Imported one").getByRole("button", { name: /^Project:/ }),
    ).toHaveAccessibleName("Project: Alpha");
    await expect(entryOrGroup(page, "Broken")).toHaveCount(0);
  });

  test("a member cannot import time for someone else", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const mia = await addTeammate(page, browser, baseURL, freshUser.slug, "Mia Member", "Member");
    await mia.page.goto(`/w/${freshUser.slug}/tracker`);
    await expect(
      mia.page.locator('section[aria-label="Timer"][data-hydrated="true"]'),
    ).toBeVisible();
    const date = todayIn(mia.user.timezone);
    const csv = [
      "Date,Start,End,Description,Email",
      `${date},00:05,01:05,For the owner,${freshUser.email}`,
      `${date},01:10,02:10,Own time,`,
    ].join("\n");
    const { dialog, check } = await checkImport(mia.page, csv);
    await expect(check).toContainText("1 entry ready, 1 with errors");
    await expect(check).toContainText(`Line 2: you cannot add time for ${freshUser.email}`);
    await expect(dialog.getByRole("button", { name: "Import 1 entry" })).toBeEnabled();
    await mia.context.close();
  });
});
