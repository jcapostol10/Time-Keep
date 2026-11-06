import { readFile } from "node:fs/promises";

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { waitForApp } from "./helpers/app";
import { createProjectViaUi } from "./helpers/catalog";
import {
  billableOn,
  createClientIn,
  openProjectRates,
  setCostRate,
  setWorkspaceRate,
  totalRow,
} from "./helpers/money";
import { setRateIn, waitForRecalc } from "./helpers/rates";
import { groupRow, openReport } from "./helpers/reports";
import { openSettings, saveSettings } from "./helpers/settings";
import { addTeammate, memberRow, openTeam } from "./helpers/team";
import { addManualEntry, pickProject } from "./helpers/tracker";

/**
 * Cost, profit and currencies (Phase 6a). Every workspace here bills at
 * $50.00 an hour by default and its owner costs $30.00 an hour, so one
 * billable hour earns $50.00, costs $30.00 and leaves $20.00.
 */

async function ownerRates(page: Page, slug: string, name: string) {
  await setWorkspaceRate(page, slug, "50");
  await setCostRate(page, slug, name, "30");
}

async function billableHour(page: Page, description: string, start: string, project?: string) {
  if (project) await pickProject(page, project);
  await billableOn(page);
  await addManualEntry(page, { description, start, duration: "1" });
}

const tracker = async (page: Page, slug: string) => {
  await page.goto(`/w/${slug}/tracker`);
  await expect(page.locator('section[aria-label="Timer"][data-hydrated="true"]')).toBeVisible();
};

test.describe("cost, profit and currencies", () => {
  test("a cost rate shows cost and profit to an admin", async ({
    page,
    freshUser,
    trackerPage,
  }) => {
    await ownerRates(page, freshUser.slug, freshUser.name);
    // The Team page lists the cost rate beside the billable one.
    await openTeam(page, freshUser.slug);
    await expect(page.getByRole("columnheader", { name: "Cost rate" })).toBeVisible();
    await expect(memberRow(page, freshUser.name)).toContainText("$30.00 / h");

    await trackerPage();
    await billableHour(page, "Client call", "00:05");
    await openReport(page, freshUser.slug, "summary");
    await expect(page.getByRole("columnheader", { name: "Cost", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Profit", exact: true })).toBeVisible();
    await expect(totalRow(page)).toContainText("$50.00");
    await expect(totalRow(page)).toContainText("$30.00");
    await expect(totalRow(page)).toContainText("$20.00");

    await openReport(page, freshUser.slug, "detailed");
    const row = page.getByRole("row", { name: /Client call/ });
    await expect(row).toContainText("$30.00");
    await expect(row).toContainText("$20.00");
  });

  test("a member sees no cost or profit", async ({
    page,
    freshUser,
    trackerPage,
    browser,
    baseURL,
  }) => {
    await ownerRates(page, freshUser.slug, freshUser.name);
    await trackerPage();
    await billableHour(page, "Client call", "00:05");
    const member = await addTeammate(
      page,
      browser,
      baseURL,
      freshUser.slug,
      "Mel Member",
      "Member",
    );
    await tracker(member.page, freshUser.slug);
    await addManualEntry(member.page, { description: "My work", start: "00:05", duration: "1" });

    await openReport(member.page, freshUser.slug, "summary");
    await expect(member.page.getByRole("columnheader", { name: "Duration" })).toBeVisible();
    for (const name of ["Amount", "Cost", "Profit"]) {
      await expect(member.page.getByRole("columnheader", { name, exact: true })).toHaveCount(0);
    }
    // No Profit tab, no Profit page, and the route refuses.
    await expect(member.page.getByRole("link", { name: "Profit", exact: true })).toHaveCount(0);
    const res = await member.page.request.get(`/api/w/${freshUser.slug}/reports/profit`);
    expect(res.status()).toBe(403);
    await member.page.goto(`/w/${freshUser.slug}/reports/profit`);
    await expect(member.page.getByText(/not found/i).first()).toBeVisible();
    await member.context.close();
  });

  test("the setting opens cost to managers", async ({ page, freshUser, browser, baseURL }) => {
    await setWorkspaceRate(page, freshUser.slug, "50");
    const manager = await addTeammate(
      page,
      browser,
      baseURL,
      freshUser.slug,
      "Mia Manager",
      "Manager",
    );
    await setCostRate(page, freshUser.slug, "Mia Manager", "20");
    await tracker(manager.page, freshUser.slug);
    await billableOn(manager.page);
    await addManualEntry(manager.page, { description: "Planning", start: "00:05", duration: "1" });

    // Amounts, as before; no cost until the workspace says so.
    await openReport(manager.page, freshUser.slug, "summary");
    await expect(totalRow(manager.page)).toContainText("$50.00");
    await expect(manager.page.getByRole("columnheader", { name: "Cost", exact: true })).toHaveCount(
      0,
    );
    await expect(manager.page.getByRole("link", { name: "Profit", exact: true })).toHaveCount(0);

    await openSettings(page, freshUser.slug);
    await page.getByRole("switch", { name: "Managers see cost and profit" }).click();
    await saveSettings(page);

    await openReport(manager.page, freshUser.slug, "summary");
    await expect(
      manager.page.getByRole("columnheader", { name: "Cost", exact: true }),
    ).toBeVisible();
    await expect(totalRow(manager.page)).toContainText("$20.00");
    await expect(totalRow(manager.page)).toContainText("$30.00");
    await expect(manager.page.getByRole("link", { name: "Profit", exact: true })).toBeVisible();
    await manager.context.close();
  });

  test("a EUR client's amounts stay in EUR", async ({ page, freshUser, trackerPage }) => {
    await setWorkspaceRate(page, freshUser.slug, "50");
    await createClientIn(page, freshUser.slug, "Acme", "EUR");
    await expect(page.getByRole("row", { name: /^Acme\b/ })).toContainText("EUR");
    await createProjectViaUi(page, freshUser.slug, "Euro site", { client: "Acme" });
    // The project's rate is in its client's currency, and the dialog says so.
    await openProjectRates(page, freshUser.slug, "Euro site");
    const change = page
      .getByRole("region", { name: "Project rate" })
      .getByRole("button", { name: "Change rate" });
    await change.click();
    await expect(page.getByRole("dialog").getByLabel("Hourly rate (EUR)")).toBeVisible();
    await page.keyboard.press("Escape");
    await setRateIn(page, change, { amount: "40", apply: "New entries only" });
    await expect(page.getByRole("region", { name: "Project rate" })).toContainText("€40.00 / h");

    await trackerPage();
    await billableHour(page, "Local work", "00:05");
    await billableHour(page, "Euro work", "01:10", "Euro site");

    // One hour in each currency: never one sum.
    await openReport(page, freshUser.slug, "summary");
    await expect(totalRow(page)).toContainText("$50.00");
    await expect(totalRow(page)).toContainText("€40.00");
    await expect(groupRow(page, "Euro site")).toContainText("€40.00");
    await expect(groupRow(page, "Euro site")).not.toContainText("$50.00");
    await openReport(page, freshUser.slug, "detailed");
    await expect(page.getByRole("row", { name: /Euro work/ })).toContainText("€40.00");
  });

  test("a EUR project needs its own rate", async ({ page, freshUser, trackerPage }) => {
    await setWorkspaceRate(page, freshUser.slug, "50");
    await createClientIn(page, freshUser.slug, "Acme", "EUR");
    await createProjectViaUi(page, freshUser.slug, "Euro site", { client: "Acme" });
    await trackerPage();
    await billableHour(page, "Euro work", "00:05", "Euro site");

    // $50.00 an hour is not €50.00 an hour: without a rate in EUR the hour is unrated.
    await openReport(page, freshUser.slug, "summary");
    await expect(page.getByText(/1 billable entry has no rate/)).toBeVisible();
    await expect(totalRow(page)).not.toContainText("50.00");

    await openProjectRates(page, freshUser.slug, "Euro site");
    await expect(
      page.getByText(
        "Set a project rate: member and workspace rates are in USD and are not converted.",
      ),
    ).toBeVisible();
    await setRateIn(
      page,
      page
        .getByRole("region", { name: "Project rate" })
        .getByRole("button", { name: "Change rate" }),
      { amount: "40", apply: "All entries, past and future" },
    );
    await waitForRecalc(page);
    await openReport(page, freshUser.slug, "summary");
    await expect(totalRow(page)).toContainText("€40.00");
  });

  test("the Profit tab ranks projects", async ({ page, freshUser, trackerPage }) => {
    await ownerRates(page, freshUser.slug, freshUser.name);
    await createProjectViaUi(page, freshUser.slug, "Alpha");
    await createProjectViaUi(page, freshUser.slug, "Beta");
    await openProjectRates(page, freshUser.slug, "Beta");
    await setRateIn(
      page,
      page
        .getByRole("region", { name: "Project rate" })
        .getByRole("button", { name: "Change rate" }),
      { amount: "100", apply: "New entries only" },
    );
    await trackerPage();
    await billableHour(page, "Alpha work", "00:05", "Alpha");
    await billableHour(page, "Beta work", "01:10", "Beta");

    await openReport(page, freshUser.slug, "summary");
    await page.getByRole("link", { name: "Profit", exact: true }).click();
    await expect(page).toHaveURL(/\/reports\/profit/);
    await waitForApp(page);
    // Beta earns $100.00 for the same $30.00 hour: it comes first, whatever the alphabet says.
    const rows = page.getByRole("table", { name: "Profit" }).getByRole("row");
    await expect(rows.nth(1)).toContainText("Beta");
    await expect(rows.nth(1)).toContainText("$70.00");
    await expect(rows.nth(1)).toContainText("70%");
    await expect(rows.nth(2)).toContainText("Alpha");
    await expect(rows.nth(2)).toContainText("$20.00");
    await expect(rows.nth(2)).toContainText("40%");
    await expect(totalRow(page)).toContainText("$90.00");
  });

  test("the export carries cost for an admin", async ({ page, freshUser, trackerPage }) => {
    await ownerRates(page, freshUser.slug, freshUser.name);
    await trackerPage();
    await billableHour(page, "Client call", "00:05");
    await openReport(page, freshUser.slug, "summary");
    await page.getByRole("button", { name: "Export" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: "CSV" }).click(),
    ]);
    const text = await readFile((await download.path())!, "utf8");
    expect(text).toContain(
      "Project,Duration,Billable,Entries,Amount (USD),Cost (USD),Profit (USD)",
    );
    expect(text).toContain("No project,1:00:00,1:00:00,1,50.00,30.00,20.00");
  });
});
