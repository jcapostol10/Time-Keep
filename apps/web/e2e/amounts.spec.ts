import { readFile } from "node:fs/promises";

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { waitForApp } from "./helpers/app";
import { setRateIn, waitForRecalc } from "./helpers/rates";
import { openReport } from "./helpers/reports";
import { addManualEntry, timer } from "./helpers/tracker";

/** A workspace default of 50.00 an hour, then one billable hour today. */
async function oneBillableHour(page: Page, slug: string, trackerPage: () => Promise<unknown>) {
  await page.goto(`/w/${slug}/settings`);
  await waitForApp(page);
  await setRateIn(
    page,
    page
      .getByRole("region", { name: "Billable rate" })
      .getByRole("button", { name: "Change rate" }),
    { amount: "50", apply: "All entries, past and future" },
  );
  await waitForRecalc(page);
  await trackerPage();
  const billable = timer(page).getByRole("button", { name: "Billable", exact: true });
  if ((await billable.getAttribute("aria-pressed")) !== "true") await billable.click();
  await addManualEntry(page, { description: "Billable work", start: "00:05", duration: "1" });
}

test.describe("amounts", () => {
  test("Summary and Detailed show the amount to the owner and not to a member", async ({
    page,
    freshUser,
    trackerPage,
    browser,
  }) => {
    await oneBillableHour(page, freshUser.slug, trackerPage);
    await openReport(page, freshUser.slug, "summary");
    await expect(page.getByRole("columnheader", { name: "Amount" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: /^Total/ })).toContainText("$50.00");
    await openReport(page, freshUser.slug, "detailed");
    await expect(page.getByRole("columnheader", { name: "Amount" })).toBeVisible();
    await expect(page.getByRole("row", { name: /Billable work/ })).toContainText("$50.00");

    // A member never sees an amount column.
    const context = await browser.newContext();
    const member = await context.newPage();
    const { signIn } = await import("./helpers/app");
    await signIn(member, "member2@demo.test");
    // Demo time covers the last two weeks.
    await openReport(member, "demo", "summary", "preset=last-week");
    await expect(member.getByRole("columnheader", { name: "Duration" })).toBeVisible();
    await expect(member.getByRole("columnheader", { name: "Amount" })).toHaveCount(0);
    await context.close();
  });

  test("a CSV export carries the Amount column", async ({ page, freshUser, trackerPage }) => {
    await oneBillableHour(page, freshUser.slug, trackerPage);
    await openReport(page, freshUser.slug, "summary");
    await page.getByRole("button", { name: "Export" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: "CSV" }).click(),
    ]);
    const text = await readFile((await download.path())!, "utf8");
    expect(text).toContain("Project,Duration,Billable,Entries,Amount (USD)");
    expect(text).toContain("No project,1:00:00,1:00:00,1,50.00");
  });
});
