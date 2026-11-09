import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { waitForApp } from "./helpers/app";
import { runDailyJob } from "./helpers/approvals";
import { barPercent, openBudget, setEstimate } from "./helpers/budgets";
import { addTaskViaUi, createProjectViaUi, projectRow } from "./helpers/catalog";
import { waitForEmail } from "./helpers/mail";
import { billableOn, setWorkspaceRate } from "./helpers/money";
import { openSettings, saveSettings } from "./helpers/settings";
import { addTeammate } from "./helpers/team";
import { addManualEntry, pickProject, pickTask } from "./helpers/tracker";

/**
 * Estimates, budgets and alerts (Phase 6b). Progress is the project's whole,
 * raw time (or billable amount), never rounded; who sees a bar follows the
 * permission matrix.
 */

const progressbar = (scope: Locator | Page) => scope.getByRole("progressbar");

test.describe("estimates, budgets and alerts", () => {
  test("a time estimate shows a bar on the Budget tab, the list and the header", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await createProjectViaUi(page, freshUser.slug, "Website");
    await trackerPage();
    await pickProject(page, "Website");
    await addManualEntry(page, { description: "Wireframes", start: "00:05", duration: "2" });

    await openBudget(page, freshUser.slug, "Website");
    await setEstimate(page, { kind: "Time", amount: "10" });
    const bar = page.getByTestId("budget-progress").getByRole("progressbar");
    expect(await barPercent(bar)).toBe(20);
    await expect(page.getByTestId("budget-progress")).toContainText("2:00:00 of 10:00:00");
    // The header carries the bar too.
    expect(await barPercent(page.getByTestId("project-progress").getByRole("progressbar"))).toBe(
      20,
    );

    await page.goto(`/w/${freshUser.slug}/projects`);
    await waitForApp(page);
    expect(await barPercent(progressbar(projectRow(page, "Website")))).toBe(20);
  });

  test("a money estimate resets monthly and fills with billable amounts", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await setWorkspaceRate(page, freshUser.slug, "50");
    await createProjectViaUi(page, freshUser.slug, "Retainer");
    await trackerPage();
    await pickProject(page, "Retainer");
    await billableOn(page);
    await addManualEntry(page, { description: "Call", start: "00:05", duration: "1" });

    await openBudget(page, freshUser.slug, "Retainer");
    await setEstimate(page, { kind: "Money", amount: "200", period: "Every month" });
    const progress = page.getByTestId("budget-progress");
    expect(await barPercent(progress.getByRole("progressbar"))).toBe(25);
    await expect(progress).toContainText("$50.00 of $200.00");
    await expect(progress).toContainText("Resets monthly");
  });

  test("a budget alert email arrives after the daily job, once", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await createProjectViaUi(page, freshUser.slug, "Launch");
    await trackerPage();
    await pickProject(page, "Launch");
    await addManualEntry(page, { description: "Prep", start: "00:05", duration: "1" });
    await openBudget(page, freshUser.slug, "Launch");
    await setEstimate(page, { kind: "Time", amount: "1" });

    const first = await runDailyJob(page.request, freshUser.slug, new Date());
    expect(first.budgets).toBeGreaterThanOrEqual(1);
    const mail = await waitForEmail(freshUser.email, {
      subject: /Launch has passed 100% of its estimate/,
    });
    expect(mail.Text).toContain("Budgets are checked once a day");
    // The same day again: every threshold was already sent.
    const again = await runDailyJob(page.request, freshUser.slug, new Date());
    expect(again.budgets).toBe(0);
  });

  test("a task estimate shows on the Tasks tab and the Budget tab", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await createProjectViaUi(page, freshUser.slug, "Website");
    await addTaskViaUi(page, freshUser.slug, "Website", "Design");
    const row = page.getByRole("row", { name: /Design/ });
    await row.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const dialog = page.getByRole("dialog", { name: "Rename task" });
    await dialog.getByRole("textbox", { name: "Estimate (hours)" }).fill("2");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("row", { name: /Design/ })).toContainText("2:00:00");

    await trackerPage();
    await pickTask(page, "Website", "Design");
    await addManualEntry(page, { description: "Mockups", start: "00:05", duration: "1" });
    await openBudget(page, freshUser.slug, "Website");
    const tasks = page.getByRole("table", { name: "Tasks with estimates" });
    const design = tasks.getByRole("row", { name: /Design/ });
    await expect(design).toContainText("2:00:00");
    expect(await barPercent(design.getByRole("progressbar"))).toBe(50);
  });

  test("a member sees a time bar only when the team's time is shown, never a money bar", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    await createProjectViaUi(page, freshUser.slug, "Website");
    await createProjectViaUi(page, freshUser.slug, "App");
    await openBudget(page, freshUser.slug, "Website");
    await setEstimate(page, { kind: "Time", amount: "10" });
    await openBudget(page, freshUser.slug, "App");
    await setEstimate(page, { kind: "Money", amount: "500" });

    const mel = await addTeammate(page, browser, baseURL, freshUser.slug, "Mel Member", "Member");
    await mel.page.goto(`/w/${freshUser.slug}/projects`);
    await waitForApp(mel.page);
    await expect(projectRow(mel.page, "Website")).toBeVisible();
    await expect(mel.page.getByRole("progressbar")).toHaveCount(0);

    await openSettings(page, freshUser.slug);
    await page
      .getByRole("checkbox", { name: "Members see everyone's time (durations only)" })
      .check();
    await saveSettings(page);

    await mel.page.reload();
    await waitForApp(mel.page);
    await expect(mel.page.getByRole("progressbar")).toHaveCount(1);
    await expect(projectRow(mel.page, "Website").getByRole("progressbar")).toBeVisible();
    await expect(projectRow(mel.page, "App").getByRole("progressbar")).toHaveCount(0);
    await mel.context.close();
  });
});
