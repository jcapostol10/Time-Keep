import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { overflowingElements, waitForApp } from "./helpers/app";
import { createProjectViaUi } from "./helpers/catalog";
import { openReport, reportTotal } from "./helpers/reports";
import { addTeammate } from "./helpers/team";
import {
  addManualEntry,
  createProject,
  createTag,
  entryOrGroup,
  pickProject,
  timer,
} from "./helpers/tracker";

/**
 * The workspace rules (Phase 4b, Part 4): each test turns one rule on as the
 * owner and checks what a member, or the owner's own tracker and reports, get.
 */

async function openSettings(page: Page, slug: string) {
  await page.goto(`/w/${slug}/settings`);
  await waitForApp(page);
}

async function saveSettings(page: Page) {
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Workspace settings saved")).toBeVisible();
}

/** Picks an option in a labelled select (settings and report filters). */
async function choose(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function openTracker(page: Page, slug: string) {
  await page.goto(`/w/${slug}/tracker`);
  await expect(page.locator('section[aria-label="Timer"][data-hydrated="true"]')).toBeVisible();
}

test.describe("workspace rules", () => {
  test("a hidden page leaves a member's sidebar and answers 403", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const mia = await addTeammate(page, browser, baseURL, freshUser.slug, "Mia Member", "Member");
    await openSettings(page, freshUser.slug);
    await page.getByRole("checkbox", { name: "Hide Reports from members" }).check();
    await saveSettings(page);

    await mia.page.goto(`/w/${freshUser.slug}/tracker`);
    await waitForApp(mia.page);
    const nav = mia.page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Time Tracker" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Reports" })).toHaveCount(0);
    const res = await mia.page.request.get(`/api/w/${freshUser.slug}/reports/summary`);
    expect(res.status()).toBe(403);
    await mia.page.goto(`/w/${freshUser.slug}/reports/summary`);
    await expect(
      mia.page.getByRole("heading", { name: "We couldn't find that page" }),
    ).toBeVisible();
    await mia.context.close();
  });

  test("members see the team's time when the workspace allows it", async ({
    page,
    freshUser,
    browser,
    baseURL,
    trackerPage,
  }) => {
    const mia = await addTeammate(page, browser, baseURL, freshUser.slug, "Mia Member", "Member");
    await trackerPage();
    await addManualEntry(page, { description: "Owner work", start: "00:05", duration: "1" });

    await openReport(mia.page, freshUser.slug, "summary");
    await expect(reportTotal(mia.page)).toHaveText("0:00:00");
    await expect(mia.page.getByRole("button", { name: /^Users:/ })).toHaveCount(0);

    await openSettings(page, freshUser.slug);
    await page
      .getByRole("checkbox", { name: "Members see everyone's time (durations only)" })
      .check();
    await saveSettings(page);

    await openReport(mia.page, freshUser.slug, "summary");
    await expect(reportTotal(mia.page)).toHaveText("1:00:00");
    await expect(mia.page.getByRole("button", { name: /^Users:/ })).toBeVisible();
    await mia.context.close();
  });

  test("who can create opens the pickers' inline create to members", async ({
    page,
    freshUser,
    browser,
    baseURL,
  }) => {
    const mia = await addTeammate(page, browser, baseURL, freshUser.slug, "Mia Member", "Member");
    await openSettings(page, freshUser.slug);
    await choose(page, "Who can create projects", "Everyone");
    await choose(page, "Who can create tags", "Everyone");
    await saveSettings(page);

    await openTracker(mia.page, freshUser.slug);
    await createProject(mia.page, "Zeta");
    await createTag(mia.page, "urgent");
    await expect(mia.page.getByRole("button", { name: /^Tags: urgent/ })).toBeVisible();
    await mia.context.close();
  });

  test("a required project blocks Stop until it is picked", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await createProjectViaUi(page, freshUser.slug, "Alpha");
    await openSettings(page, freshUser.slug);
    await page
      .getByRole("group", { name: "Required fields" })
      .getByRole("checkbox", { name: "Project" })
      .check();
    await saveSettings(page);

    await trackerPage();
    await timer(page).getByRole("combobox", { name: "Description" }).fill("Untagged work");
    await timer(page).getByRole("button", { name: "Start" }).click();
    await expect(timer(page).getByRole("button", { name: "Stop" })).toBeVisible();
    await timer(page).getByRole("button", { name: "Stop" }).click();
    await expect(timer(page).getByRole("alert")).toContainText("Project is required.");
    // The timer keeps running.
    await expect(timer(page).getByRole("button", { name: "Stop" })).toBeVisible();

    await pickProject(page, "Alpha");
    await timer(page).getByRole("button", { name: "Stop" }).click();
    await expect(timer(page).getByRole("button", { name: "Start" })).toBeVisible();
    await expect(entryOrGroup(page, "Untagged work")).toBeVisible();
  });

  test("force timer takes manual entry away from a member", async ({
    page,
    freshUser,
    browser,
    baseURL,
    trackerPage,
  }) => {
    const mia = await addTeammate(page, browser, baseURL, freshUser.slug, "Mia Member", "Member");
    await openTracker(mia.page, freshUser.slug);
    await addManualEntry(mia.page, { description: "Mia work", start: "00:05", duration: "1" });

    await openSettings(page, freshUser.slug);
    await page.getByRole("switch", { name: "Force timer" }).click();
    await saveSettings(page);

    await openTracker(mia.page, freshUser.slug);
    await expect(timer(mia.page).getByRole("button", { name: "Manual mode" })).toHaveCount(0);
    await mia.page.goto(`/w/${freshUser.slug}/timesheet`);
    await expect(mia.page.locator('[role="grid"][data-hydrated="true"]')).toBeVisible();
    await expect(mia.page.getByRole("grid").getByRole("textbox").first()).toHaveAttribute(
      "readonly",
      "",
    );

    // Owners keep manual entry.
    await trackerPage();
    await expect(timer(page).getByRole("button", { name: "Manual mode" })).toBeVisible();
    await mia.context.close();
  });

  test("a break stays out of the Summary unless the Type filter asks", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await openSettings(page, freshUser.slug);
    await page.getByRole("switch", { name: "Allow breaks" }).click();
    await saveSettings(page);

    await trackerPage();
    const breakToggle = timer(page).getByRole("button", { name: "Break", exact: true });
    await breakToggle.click();
    await expect(breakToggle).toHaveAttribute("aria-pressed", "true");
    await addManualEntry(page, { description: "Coffee", start: "00:05", duration: "0.5" });
    await expect(entryOrGroup(page, "Coffee")).toContainText("Break");

    await openReport(page, freshUser.slug, "summary");
    await expect(reportTotal(page)).toHaveText("0:00:00");
    await choose(page, "Type", "All");
    await expect(reportTotal(page)).toHaveText("0:30:00");
  });

  test("rounding rounds the Summary and Raw shows real time", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await openSettings(page, freshUser.slug);
    await choose(page, "Rounding", "Nearest");
    await choose(page, "Rounding step", "15 min");
    await saveSettings(page);

    await trackerPage();
    await addManualEntry(page, { description: "Seven A", start: "00:05", duration: "7m" });
    await addManualEntry(page, { description: "Seven B", start: "00:20", duration: "7m" });

    await openReport(page, freshUser.slug, "summary");
    await expect(reportTotal(page)).toHaveText("0:00:00");
    await page.getByRole("button", { name: "Rounding: Nearest 15 min" }).click();
    await expect(page).toHaveURL(/rounding=off/);
    await expect(reportTotal(page)).toHaveText("0:14:00");
    await page.getByRole("button", { name: "Raw" }).click();
    await expect(reportTotal(page)).toHaveText("0:00:00");
  });

  test("the account and settings pages fit a 375px screen", async ({ page, freshUser }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    // The account page sits outside the workspace shell: wait for its last section.
    await page.goto("/account");
    await expect(page.getByRole("button", { name: "Send me a test email" })).toBeVisible();
    expect(await overflowingElements(page)).toEqual([]);
    await openSettings(page, freshUser.slug);
    await expect(page.getByRole("button", { name: "Save settings" })).toBeVisible();
    expect(await overflowingElements(page)).toEqual([]);
  });
});
