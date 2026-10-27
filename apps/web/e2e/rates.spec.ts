import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { waitForApp } from "./helpers/app";
import { createProjectViaUi } from "./helpers/catalog";
import { setRateIn, waitForRecalc } from "./helpers/rates";
import { openReport } from "./helpers/reports";
import { dateKey, daysAgo } from "./helpers/timesheet";
import { addManualEntryOn, pickProject, pickTask, timer } from "./helpers/tracker";

/** A Summary over a few days around `day`, as a query string. */
function around(day: Date): string {
  const from = new Date(day.getTime() - 2 * 86_400_000).toISOString();
  const to = new Date(day.getTime() + 2 * 86_400_000).toISOString();
  return `preset=custom&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

async function billableOn(page: Page) {
  const billable = timer(page).getByRole("button", { name: "Billable", exact: true });
  if ((await billable.getAttribute("aria-pressed")) !== "true") await billable.click();
  await expect(billable).toHaveAttribute("aria-pressed", "true");
}

const totalRow = (page: Page) => page.getByRole("row").filter({ hasText: /^Total/ });

test.describe("rates", () => {
  test("the workspace default rate shows in the history", async ({ page, freshUser }) => {
    await page.goto(`/w/${freshUser.slug}/settings`);
    await waitForApp(page);
    const section = page.getByRole("region", { name: "Billable rate" });
    await expect(section).toContainText("No rate");
    await setRateIn(page, section.getByRole("button", { name: "Change rate" }), {
      amount: "50",
      apply: "New entries only",
    });
    await expect(section).toContainText("$50.00 / h");
    await section.getByRole("button", { name: "Change rate" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("list", { name: "History" })).toContainText("$50.00");
  });

  test("a project rate from today leaves last month's amount alone", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await createProjectViaUi(page, freshUser.slug, "Client work");
    await trackerPage();
    const day = daysAgo(35);
    await pickProject(page, "Client work");
    await billableOn(page);
    await addManualEntryOn(page, {
      description: "Old work",
      date: dateKey(day, freshUser.timezone),
      start: "09:00",
      duration: "2",
    });

    // The workspace default of 50, applied to every entry: 2 h = $100.00.
    await page.goto(`/w/${freshUser.slug}/settings`);
    await waitForApp(page);
    await setRateIn(
      page,
      page
        .getByRole("region", { name: "Billable rate" })
        .getByRole("button", { name: "Change rate" }),
      { amount: "50", apply: "All entries, past and future" },
    );
    await waitForRecalc(page);
    const latestJob = async () =>
      (
        (await (await page.request.get(`/api/w/${freshUser.slug}/rate-recalc`)).json()) as {
          job: { id: string; status: string } | null;
        }
      ).job;
    const applied = await latestJob();
    await openReport(page, freshUser.slug, "summary", around(day));
    await expect(totalRow(page)).toContainText("$100.00");

    // The project's own rate from today: last month's entry keeps its amount.
    await page.goto(`/w/${freshUser.slug}/projects`);
    await page.getByRole("link", { name: "Client work" }).click();
    await page.getByRole("tab", { name: "Rates" }).click();
    const projectRate = page.getByRole("region", { name: "Project rate" });
    await setRateIn(page, projectRate.getByRole("button", { name: "Change rate" }), {
      amount: "80",
      apply: "New entries only",
    });
    // No job re-rates past entries for "New entries only".
    expect(await latestJob()).toEqual(applied);
    await openReport(page, freshUser.slug, "summary", around(day));
    await expect(totalRow(page)).toContainText("$100.00");

    // From a date that covers it: once the job has run, $160.00.
    await page.goBack();
    await setRateIn(page, projectRate.getByRole("button", { name: "Change rate" }), {
      amount: "80",
      apply: "Entries from a date",
      from: dateKey(daysAgo(40), freshUser.timezone),
    });
    await waitForRecalc(page);
    await openReport(page, freshUser.slug, "summary", around(day));
    await expect(totalRow(page)).toContainText("$160.00");
  });

  test("a task rate beats the project rate on a new entry", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await createProjectViaUi(page, freshUser.slug, "Design work");
    await page.getByRole("link", { name: "Design work" }).click();
    await page.getByRole("button", { name: "Add task" }).click();
    const taskDialog = page.getByRole("dialog", { name: "New task" });
    await taskDialog.getByLabel("Name").fill("Logo");
    await taskDialog.getByRole("button", { name: "Add task" }).click();
    await expect(taskDialog).toBeHidden();
    await page.getByRole("tab", { name: "Rates" }).click();
    await setRateIn(
      page,
      page
        .getByRole("region", { name: "Project rate" })
        .getByRole("button", { name: "Change rate" }),
      { amount: "80", apply: "New entries only" },
    );
    await setRateIn(page, page.getByRole("button", { name: "Change rate for Logo" }), {
      amount: "120",
      apply: "New entries only",
    });

    await trackerPage();
    await pickTask(page, "Design work", "Logo");
    await billableOn(page);
    const today = new Date();
    await addManualEntryOn(page, {
      description: "Logo sketches",
      date: dateKey(today, freshUser.timezone),
      start: "00:10",
      duration: "1",
    });
    await openReport(page, freshUser.slug, "summary", around(today));
    await expect(totalRow(page)).toContainText("$120.00");
  });

  test("the rate dialog fits a 375px screen", async ({ page, freshUser }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await page.goto(`/w/${freshUser.slug}/settings`);
    await waitForApp(page);
    await page
      .getByRole("region", { name: "Billable rate" })
      .getByRole("button", { name: "Change rate" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // The dialog is fixed, so the page cannot scroll to what it hides: it must fit itself.
    const box = await dialog.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(375);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
